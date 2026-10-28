/** Published items (public.shared_item): visible to the workspace that published them, or to every workspace when `everywhere` */
import crypto from 'node:crypto';
import type { SharedItem, SharedItemSummary, SharedKind } from '@config-platform/schema';
import { pool } from '../db/pool.js';

interface Row {
  id: string;
  tenant_id: string;
  kind: SharedKind;
  source_id: string | null;
  name: string;
  description: string;
  version: number;
  everywhere: boolean;
  workspace: string;
  updated_at: Date;
  content?: unknown;
}

const COLUMNS = 's.id, s.tenant_id, s.kind, s.source_id, s.name, s.description, s.version, s.everywhere, t.name AS workspace, s.updated_at';
const VISIBLE = '(s.tenant_id = $1 OR s.everywhere)';

const toSummary = (tenantId: string, r: Row): SharedItemSummary => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  version: r.version,
  everywhere: r.everywhere,
  workspace: r.workspace,
  own: r.tenant_id === tenantId,
  // Which of a workspace's own items it came from is that workspace's business only
  sourceId: r.tenant_id === tenantId ? r.source_id : null,
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
  /** `everyWorkspace` (platform owners only, checked by the caller): every workspace's items, not just the visible ones */
  async list(tenantId: string, kind: SharedKind, everyWorkspace = false): Promise<SharedItemSummary[]> {
    const res = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM public.shared_item s JOIN public.tenant t ON t.id = s.tenant_id
       WHERE (${VISIBLE} OR $3) AND s.kind = $2 ORDER BY s.name, s.id`,
      [tenantId, kind, everyWorkspace],
    );
    return res.rows.map((r) => toSummary(tenantId, r));
  },

  async get(tenantId: string, id: string): Promise<SharedItem | null> {
    const res = await pool.query<Row>(
      `SELECT ${COLUMNS}, s.content FROM public.shared_item s JOIN public.tenant t ON t.id = s.tenant_id WHERE ${VISIBLE} AND s.id = $2`,
      [tenantId, id],
    );
    const r = res.rows[0];
    return r ? { ...toSummary(tenantId, r), content: r.content } : null;
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

  /** Platform owners only (checked by the caller): any workspace's item */
  async setEverywhere(id: string, everywhere: boolean): Promise<boolean> {
    const res = await pool.query('UPDATE public.shared_item SET everywhere = $2 WHERE id = $1', [id, everywhere]);
    return (res.rowCount ?? 0) > 0;
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.shared_item WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },

  async ownerOf(id: string): Promise<string | null> {
    const res = await pool.query<{ tenant_id: string }>('SELECT tenant_id FROM public.shared_item WHERE id = $1', [id]);
    return res.rows[0]?.tenant_id ?? null;
  },

  /** Visuals and other shared items placing this item: names in its own workspace, a count in others */
  async usage(ownerTenantId: string, ref: string): Promise<{ here: string[]; elsewhere: number }> {
    const places = `jsonb_path_exists(%s, '$.** ? (@.kind == "symbol" && @.ref == $ref)', jsonb_build_object('ref', $1::text))`;
    const res = await pool.query<{ tenant_id: string; name: string }>(
      `SELECT tenant_id, name FROM public.visual_def WHERE ${places.replace('%s', 'definition')}
       UNION ALL
       SELECT tenant_id, name FROM public.shared_item WHERE ${places.replace('%s', 'content')}
       ORDER BY name`,
      [ref],
    );
    return {
      here: res.rows.filter((r) => r.tenant_id === ownerTenantId).map((r) => r.name),
      elsewhere: res.rows.filter((r) => r.tenant_id !== ownerTenantId).length,
    };
  },
};
