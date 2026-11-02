/** Published items (public.shared_item): seen and used only in the workspace that published them */
import crypto from 'node:crypto';
import type { SharedItem, SharedItemSummary, SharedKind } from '@config-platform/schema';
import { pool } from '../db/pool.js';

interface Row {
  id: string;
  kind: SharedKind;
  source_id: string | null;
  name: string;
  description: string;
  version: number;
  updated_at: Date;
  content?: unknown;
}

const COLUMNS = 'id, kind, source_id, name, description, version, updated_at';

const toSummary = (r: Row): SharedItemSummary => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  version: r.version,
  sourceId: r.source_id,
  publishedAt: r.updated_at.toISOString(),
});

export interface PublishRow {
  kind: SharedKind;
  sourceId: string;
  name: string;
  description: string;
  content: unknown;
}

export const sharedRepository = {
  async list(tenantId: string, kind: SharedKind): Promise<SharedItemSummary[]> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS} FROM public.shared_item WHERE tenant_id = $1 AND kind = $2 ORDER BY name, id`, [tenantId, kind]);
    return res.rows.map(toSummary);
  },

  async get(tenantId: string, id: string): Promise<SharedItem | null> {
    const res = await pool.query<Row>(`SELECT ${COLUMNS}, content FROM public.shared_item WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    const r = res.rows[0];
    return r ? { ...toSummary(r), content: r.content } : null;
  },

  /** A first release, or the next release of what was published from the same source */
  async publish(tenantId: string, userId: string, item: PublishRow): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO public.shared_item (id, tenant_id, kind, source_id, name, description, content, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, kind, source_id) WHERE source_id IS NOT NULL DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, content = EXCLUDED.content,
             published_by = EXCLUDED.published_by, version = public.shared_item.version + 1, updated_at = NOW()
       RETURNING id`,
      [`shr_${crypto.randomBytes(6).toString('hex')}`, tenantId, item.kind, item.sourceId, item.name, item.description, JSON.stringify(item.content), userId],
    );
    return res.rows[0].id;
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.shared_item WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Names of the workspace's visuals and shared items that place this item */
  async usage(tenantId: string, ref: string): Promise<string[]> {
    const places = `jsonb_path_exists(%s, '$.** ? (@.kind == "symbol" && @.ref == $ref)', jsonb_build_object('ref', $2::text))`;
    const res = await pool.query<{ name: string }>(
      `SELECT name FROM public.visual_def WHERE tenant_id = $1 AND ${places.replace('%s', 'definition')}
       UNION ALL
       SELECT name FROM public.shared_item WHERE tenant_id = $1 AND ${places.replace('%s', 'content')}
       ORDER BY name`,
      [tenantId, ref],
    );
    return res.rows.map((r) => r.name);
  },
};
