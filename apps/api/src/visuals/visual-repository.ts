/** Saved visuals (public.visual_def): name, the drawing itself (definition), version for safe saving. */
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Visual, VisualInput, VisualSummary } from '@config-platform/schema';
import { pool } from '../db/pool.js';

interface Row {
  id: string;
  name: string;
  definition: Visual['definition'];
  version: number;
  created_at: Date;
  updated_at: Date;
}

const toVisual = (r: Row): Visual => ({
  id: r.id,
  name: r.name,
  definition: r.definition,
  elementCount: r.definition.elements?.length ?? 0,
  version: r.version,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export const visualRepository = {
  async list(tenantId: string): Promise<VisualSummary[]> {
    const res = await pool.query<{ id: string; name: string; element_count: number; version: number; updated_at: Date }>(
      `SELECT id, name, COALESCE(jsonb_array_length(definition->'elements'), 0) AS element_count, version, updated_at
       FROM public.visual_def WHERE tenant_id = $1 ORDER BY name, id`,
      [tenantId],
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name, elementCount: r.element_count, version: r.version, updatedAt: r.updated_at.toISOString() }));
  },

  async ids(tenantId: string, client?: PoolClient): Promise<Set<string>> {
    const res = await (client ?? pool).query<{ id: string }>('SELECT id FROM public.visual_def WHERE tenant_id = $1', [tenantId]);
    return new Set(res.rows.map((r) => r.id));
  },

  async get(tenantId: string, id: string): Promise<Visual | null> {
    const res = await pool.query<Row>(
      'SELECT id, name, definition, version, created_at, updated_at FROM public.visual_def WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    return res.rows[0] ? toVisual(res.rows[0]) : null;
  },

  async create(tenantId: string, userId: string, input: VisualInput): Promise<Visual> {
    const id = `vis_${crypto.randomBytes(6).toString('hex')}`;
    await pool.query(
      'INSERT INTO public.visual_def (id, tenant_id, name, definition, created_by) VALUES ($1, $2, $3, $4, $5)',
      [id, tenantId, input.name, JSON.stringify(input.definition), userId],
    );
    return (await this.get(tenantId, id))!;
  },

  /** Saves only if nobody saved since `expectedVersion`; null when they did (or it's gone) */
  async update(tenantId: string, id: string, input: VisualInput, expectedVersion: number): Promise<Visual | null> {
    const res = await pool.query(
      `UPDATE public.visual_def SET name = $3, definition = $4, version = version + 1, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND version = $5`,
      [tenantId, id, input.name, JSON.stringify(input.definition), expectedVersion],
    );
    return (res.rowCount ?? 0) > 0 ? this.get(tenantId, id) : null;
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.visual_def WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Names of pages (draft or published) showing this visual */
  async pagesUsing(tenantId: string, id: string): Promise<string[]> {
    const res = await pool.query<{ name: string }>(
      `SELECT name FROM public.page_def
       WHERE tenant_id = $1 AND (jsonb_path_exists(draft, '$.** ? (@.visualId == $id)', jsonb_build_object('id', $2::text))
                              OR jsonb_path_exists(published, '$.** ? (@.visualId == $id)', jsonb_build_object('id', $2::text)))
       ORDER BY name`,
      [tenantId, id],
    );
    return res.rows.map((r) => r.name);
  },
};
