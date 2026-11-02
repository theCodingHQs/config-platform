/** Each person's favorite pages (public.user_favorite): a page plus the values it was opened with */
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';

export interface Favorite {
  id: string;
  pageId: string;
  /** Values the page was opened with (`{{ params.machine }}`); empty for a plain page */
  params: Record<string, string>;
  /** The person's own name for it; null = show the page's name */
  label: string | null;
}

const COLUMNS = `id, page_id AS "pageId", params, label`;

export const favoriteRepository = {
  async list(tenantId: string, userId: string): Promise<Favorite[]> {
    const res = await pool.query(
      `SELECT ${COLUMNS} FROM public.user_favorite
       WHERE tenant_id = $1 AND user_id = $2 ORDER BY position ASC, created_at ASC`,
      [tenantId, userId]
    );
    return res.rows;
  },

  async pageIsPublished(tenantId: string, pageId: string): Promise<boolean> {
    const res = await pool.query(
      `SELECT 1 FROM public.page_def WHERE tenant_id = $1 AND id = $2 AND published IS NOT NULL`,
      [tenantId, pageId]
    );
    return (res.rowCount ?? 0) > 0;
  },

  /** Adds one unless the person already has that page with those values (then returns theirs) or is at the limit */
  async add(
    tenantId: string,
    userId: string,
    input: { pageId: string; params: Record<string, string>; label: string | null },
    limit: number
  ): Promise<{ favorite: Favorite; created: boolean } | { full: true }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One person's favorites change one at a time, so the limit can't be passed by two clicks at once
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`favorites:${tenantId}:${userId}`]);
      const existing = await client.query(
        `SELECT ${COLUMNS} FROM public.user_favorite
         WHERE tenant_id = $1 AND user_id = $2 AND page_id = $3 AND params = $4::jsonb`,
        [tenantId, userId, input.pageId, JSON.stringify(input.params)]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { favorite: existing.rows[0], created: false };
      }
      const stats = await client.query<{ count: string; next: number }>(
        `SELECT COUNT(*) AS count, COALESCE(MAX(position) + 1, 0) AS next
         FROM public.user_favorite WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      );
      if (Number(stats.rows[0].count) >= limit) {
        await client.query('ROLLBACK');
        return { full: true };
      }
      const inserted = await client.query(
        `INSERT INTO public.user_favorite (id, tenant_id, user_id, page_id, params, label, position)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING ${COLUMNS}`,
        [`fav_${crypto.randomUUID().slice(0, 12)}`, tenantId, userId, input.pageId, JSON.stringify(input.params), input.label, stats.rows[0].next]
      );
      await client.query('COMMIT');
      return { favorite: inserted.rows[0], created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async rename(tenantId: string, userId: string, id: string, label: string | null): Promise<Favorite | null> {
    const res = await pool.query(
      `UPDATE public.user_favorite SET label = $4
       WHERE tenant_id = $1 AND user_id = $2 AND id = $3 RETURNING ${COLUMNS}`,
      [tenantId, userId, id, label]
    );
    return res.rows[0] ?? null;
  },

  async remove(tenantId: string, userId: string, id: string): Promise<boolean> {
    const res = await pool.query(
      `DELETE FROM public.user_favorite WHERE tenant_id = $1 AND user_id = $2 AND id = $3`,
      [tenantId, userId, id]
    );
    return (res.rowCount ?? 0) > 0;
  },
};
