/**
 * How live events travel between this app's servers: Postgres NOTIFY/LISTEN (no extra
 * infrastructure), or in memory for tests. Text only; LiveBus does the rest.
 */
import type { Pool, PoolClient } from 'pg';

export interface BusTransport {
  publish(text: string): Promise<void>;
  /** Starts delivering every published text (from all servers) to `handler` */
  listen(handler: (text: string) => void): Promise<void>;
  close(): Promise<void>;
}

export const BUS_CHANNEL = 'live_bus';

/** Postgres: one dedicated LISTEN connection (re-made if it drops); NOTIFY through the pool */
export class PgBusTransport implements BusTransport {
  private client: PoolClient | null = null;
  private handler: ((text: string) => void) | null = null;
  private closed = false;

  constructor(
    private readonly listenPool: Pool,
    private readonly notifyPool: Pool,
  ) {}

  async publish(text: string): Promise<void> {
    await this.notifyPool.query('SELECT pg_notify($1, $2)', [BUS_CHANNEL, text]);
  }

  async listen(handler: (text: string) => void): Promise<void> {
    this.handler = handler;
    await this.connect();
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = null;
    if (client) {
      await client.query(`UNLISTEN ${BUS_CHANNEL}`).catch(() => undefined);
      client.release();
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const client = await this.listenPool.connect();
      client.on('notification', (msg) => msg.channel === BUS_CHANNEL && msg.payload && this.handler?.(msg.payload));
      client.on('error', () => this.reconnect(client));
      await client.query(`LISTEN ${BUS_CHANNEL}`);
      this.client = client;
    } catch (err) {
      console.error('[live bus] could not listen, retrying:', (err as Error).message);
      setTimeout(() => void this.connect(), 5000).unref();
    }
  }

  private reconnect(broken: PoolClient): void {
    if (this.client !== broken) return;
    this.client = null;
    broken.release(true);
    setTimeout(() => void this.connect(), 1000).unref();
  }
}

/** Every bus created on the same hub hears every publish: several "servers" in one test */
export class MemoryBusHub {
  private readonly handlers = new Set<(text: string) => void>();

  transport(): BusTransport {
    let mine: ((text: string) => void) | null = null;
    return {
      publish: async (text) => {
        for (const h of [...this.handlers]) h(text);
      },
      listen: async (handler) => {
        mine = handler;
        this.handlers.add(handler);
      },
      close: async () => {
        if (mine) this.handlers.delete(mine);
      },
    };
  }
}
