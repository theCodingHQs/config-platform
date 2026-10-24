/**
 * Which server runs live connections and rules: the one holding a Postgres advisory lock. The
 * lock lives as long as its database connection, so when the leader stops, another server takes
 * over within seconds. A single server simply becomes the leader.
 */
import type { Pool, PoolClient } from 'pg';

export interface LeaderLock {
  /** Calls `onChange` whenever this server becomes, or stops being, the leader */
  start(onChange: (isLeader: boolean) => void): void;
  stop(): Promise<void>;
}

/** Any fixed number shared by all servers of this app: "live connections leader" */
const LOCK_KEY = 72_046_101;
const RETRY_MS = 5000;

export class PgLeaderLock implements LeaderLock {
  private client: PoolClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private onChange: (isLeader: boolean) => void = () => undefined;

  constructor(private readonly pool: Pool) {}

  start(onChange: (isLeader: boolean) => void): void {
    this.onChange = onChange;
    void this.tryAcquire();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const client = this.client;
    this.client = null;
    if (client) {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
      client.release();
    }
  }

  private async tryAcquire(): Promise<void> {
    if (this.stopped) return;
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      const res = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
      if (res.rows[0]?.ok) {
        this.client = client;
        client.on('error', () => this.lost(client!));
        this.onChange(true);
        return;
      }
      client.release();
    } catch (err) {
      client?.release(true);
      console.error('[live] leader check failed, retrying:', (err as Error).message);
    }
    this.timer = setTimeout(() => void this.tryAcquire(), RETRY_MS);
    this.timer.unref();
  }

  private lost(client: PoolClient): void {
    if (this.client !== client) return;
    this.client = null;
    client.release(true);
    this.onChange(false);
    this.timer = setTimeout(() => void this.tryAcquire(), RETRY_MS);
    this.timer.unref();
  }
}

/** Always the leader (tests, and when clustering is switched off) */
export class SoloLeaderLock implements LeaderLock {
  start(onChange: (isLeader: boolean) => void): void {
    onChange(true);
  }
  async stop(): Promise<void> {}
}
