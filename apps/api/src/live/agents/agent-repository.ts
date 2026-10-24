/** Edge agents (public.live_agent): the token is stored only as a hash. */
import crypto from 'node:crypto';
import type { LiveAgent } from '@config-platform/schema';
import { pool } from '../../db/pool.js';

export interface StoredAgent extends LiveAgent {
  tenantId: string;
}

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  last_seen_at: Date | null;
  online_until: Date | null;
  version: string | null;
  hostname: string | null;
  created_at: Date;
}

const toStored = (r: Row): StoredAgent => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  online: Boolean(r.online_until && r.online_until.getTime() > Date.now()),
  lastSeenAt: r.last_seen_at?.toISOString() ?? null,
  version: r.version,
  hostname: r.hostname,
  createdAt: r.created_at.toISOString(),
});

const COLUMNS = 'id, tenant_id, name, last_seen_at, online_until, version, hostname, created_at';

export const hashAgentToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

export function newAgentToken(): { token: string; tokenHash: string } {
  const token = `la_${crypto.randomBytes(30).toString('base64url')}`;
  return { token, tokenHash: hashAgentToken(token) };
}

/** How long an agent counts as online after its last sign of life */
export const ONLINE_FOR_SECONDS = 75;

export const agentRepository = {
  async list(tenantId: string): Promise<StoredAgent[]> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_agent WHERE tenant_id = $1 ORDER BY name, id`, [tenantId]);
    return res.rows.map(toStored);
  },

  async get(tenantId: string, id: string): Promise<StoredAgent | null> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_agent WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  /** The agent a token belongs to (the token is the agent's only key) */
  async byToken(token: string): Promise<StoredAgent | null> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_agent WHERE token_hash = $1`, [hashAgentToken(token)]);
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  async create(tenantId: string, userId: string, name: string, tokenHash: string): Promise<StoredAgent> {
    const id = `ag_${crypto.randomBytes(6).toString('hex')}`;
    const res = await pool.query<Row>(
      `INSERT INTO public.live_agent (id, tenant_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [id, tenantId, name, tokenHash, userId],
    );
    return toStored(res.rows[0]);
  },

  async setToken(tenantId: string, id: string, tokenHash: string): Promise<boolean> {
    const res = await pool.query('UPDATE public.live_agent SET token_hash = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, id, tokenHash]);
    return (res.rowCount ?? 0) > 0;
  },

  async rename(tenantId: string, id: string, name: string): Promise<StoredAgent | null> {
    const res = await pool.query<Row>(`UPDATE public.live_agent SET name = $3 WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [tenantId, id, name]);
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.live_agent WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Connected (or still connected): online for a while longer, with what it reported */
  async markOnline(id: string, about?: { version: string; hostname: string }): Promise<void> {
    await pool.query(
      `UPDATE public.live_agent SET last_seen_at = NOW(), online_until = NOW() + make_interval(secs => $2),
         version = COALESCE($3, version), hostname = COALESCE($4, hostname) WHERE id = $1`,
      [id, ONLINE_FOR_SECONDS, about?.version?.slice(0, 40) ?? null, about?.hostname?.slice(0, 255) ?? null],
    );
  },

  async markOffline(id: string): Promise<void> {
    await pool.query('UPDATE public.live_agent SET last_seen_at = NOW(), online_until = NULL WHERE id = $1', [id]);
  },

  /** Connections set to run on an agent */
  async connectionCount(tenantId: string, id: string): Promise<number> {
    const res = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM public.live_connection WHERE tenant_id = $1 AND agent_id = $2', [tenantId, id]);
    return res.rows[0]?.n ?? 0;
  },
};
