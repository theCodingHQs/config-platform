/** Saved live connections (public.live_connection). Settings are stored with secrets encrypted. */
import crypto from 'node:crypto';
import type { LiveConnectionInput, LiveConnectionKind, TagRule } from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { encryptSettings } from './connection-secrets.js';

export interface StoredConnection {
  id: string;
  tenantId: string;
  name: string;
  kind: LiveConnectionKind;
  enabled: boolean;
  /** Secrets encrypted (see connection-secrets) */
  settings: Record<string, any>;
  tags: TagRule[];
  viewRoles: string[];
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  kind: LiveConnectionKind;
  enabled: boolean;
  settings: Record<string, any>;
  tags: TagRule[];
  view_roles: string[];
  created_at: Date;
  updated_at: Date;
}

const toStored = (r: Row): StoredConnection => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  kind: r.kind,
  enabled: r.enabled,
  settings: r.settings,
  tags: r.tags ?? [],
  viewRoles: r.view_roles ?? [],
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const COLUMNS = 'id, tenant_id, name, kind, enabled, settings, tags, view_roles, created_at, updated_at';

export const connectionRepository = {
  async list(tenantId: string): Promise<StoredConnection[]> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_connection WHERE tenant_id = $1 ORDER BY name, id`, [tenantId]);
    return res.rows.map(toStored);
  },

  /** Every enabled connection on this server, to start them all when it starts */
  async listEnabled(): Promise<StoredConnection[]> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_connection WHERE enabled`);
    return res.rows.map(toStored);
  },

  async get(tenantId: string, id: string): Promise<StoredConnection | null> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.live_connection WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  /** `serverSettings` are set by the server, not typed in (e.g. the HTTP push token's hash) */
  async create(tenantId: string, userId: string, input: LiveConnectionInput, serverSettings: Record<string, unknown> = {}): Promise<StoredConnection> {
    const id = `lc_${crypto.randomBytes(6).toString('hex')}`;
    const res = await pool.query<Row>(
      `INSERT INTO public.live_connection (id, tenant_id, name, kind, enabled, settings, tags, view_roles, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
      [id, tenantId, input.name, input.kind, input.enabled, { ...encryptSettings(input.kind, input.settings), ...serverSettings }, JSON.stringify(input.tags), JSON.stringify(input.viewRoles), userId],
    );
    return toStored(res.rows[0]);
  },

  /** The kind can't change (its settings would be meaningless): delete and create instead */
  async update(tenantId: string, previous: StoredConnection, input: LiveConnectionInput): Promise<StoredConnection> {
    const res = await pool.query<Row>(
      `UPDATE public.live_connection
       SET name = $3, enabled = $4, settings = $5, tags = $6, view_roles = $7, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [tenantId, previous.id, input.name, input.enabled, encryptSettings(input.kind, input.settings, previous.settings), JSON.stringify(input.tags), JSON.stringify(input.viewRoles)],
    );
    return toStored(res.rows[0]);
  },

  /** Changes server-set settings only (e.g. a new push token's hash) */
  async mergeServerSettings(tenantId: string, id: string, serverSettings: Record<string, unknown>): Promise<StoredConnection | null> {
    const res = await pool.query<Row>(
      `UPDATE public.live_connection SET settings = settings || $3::jsonb, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [tenantId, id, JSON.stringify(serverSettings)],
    );
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.live_connection WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },
};
