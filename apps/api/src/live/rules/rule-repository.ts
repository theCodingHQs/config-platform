/** Saved live rules (public.live_rule): name, enabled, the rule itself (config), last run. */
import crypto from 'node:crypto';
import type { LiveRule, LiveRuleInput, LiveRuleRun } from '@config-platform/schema';
import { pool } from '../../db/pool.js';

export interface StoredRule extends LiveRule {
  tenantId: string;
  createdBy: string | null;
}

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  enabled: boolean;
  config: Omit<LiveRuleInput, 'name' | 'enabled'>;
  created_by: string | null;
  created_by_email: string | null;
  last_run_at: Date | null;
  last_status: LiveRuleRun['status'] | null;
  last_message: string | null;
  created_at: Date;
  updated_at: Date;
}

const toStored = (r: Row): StoredRule => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  enabled: r.enabled,
  ...r.config,
  createdBy: r.created_by,
  createdByEmail: r.created_by_email,
  lastRunAt: r.last_run_at?.toISOString() ?? null,
  lastStatus: r.last_status,
  lastMessage: r.last_message,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = `
  SELECT r.id, r.tenant_id, r.name, r.enabled, r.config, r.created_by, u.email AS created_by_email,
         r.last_run_at, r.last_status, r.last_message, r.created_at, r.updated_at
  FROM public.live_rule r LEFT JOIN public.app_user u ON u.id = r.created_by`;

const configOf = ({ name: _n, enabled: _e, ...config }: LiveRuleInput) => config;

export const ruleRepository = {
  async list(tenantId: string): Promise<StoredRule[]> {
    const res = await pool.query<Row>(`${SELECT} WHERE r.tenant_id = $1 ORDER BY r.name, r.id`, [tenantId]);
    return res.rows.map(toStored);
  },

  async listEnabled(): Promise<StoredRule[]> {
    const res = await pool.query<Row>(`${SELECT} WHERE r.enabled`);
    return res.rows.map(toStored);
  },

  async get(tenantId: string, id: string): Promise<StoredRule | null> {
    const res = await pool.query<Row>(`${SELECT} WHERE r.tenant_id = $1 AND r.id = $2`, [tenantId, id]);
    return res.rows[0] ? toStored(res.rows[0]) : null;
  },

  async create(tenantId: string, userId: string, input: LiveRuleInput): Promise<StoredRule> {
    const id = `lr_${crypto.randomBytes(6).toString('hex')}`;
    await pool.query(
      `INSERT INTO public.live_rule (id, tenant_id, name, enabled, config, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, tenantId, input.name, input.enabled, JSON.stringify(configOf(input)), userId],
    );
    return (await this.get(tenantId, id))!;
  },

  /** Whoever saves a rule becomes the one it runs as (with their permissions) */
  async update(tenantId: string, id: string, userId: string, input: LiveRuleInput): Promise<StoredRule | null> {
    await pool.query(
      `UPDATE public.live_rule SET name = $3, enabled = $4, config = $5, created_by = $6, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, input.name, input.enabled, JSON.stringify(configOf(input)), userId],
    );
    return this.get(tenantId, id);
  },

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM public.live_rule WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  },

  async recordRun(id: string, run: LiveRuleRun): Promise<void> {
    await pool.query(`UPDATE public.live_rule SET last_run_at = $2, last_status = $3, last_message = $4 WHERE id = $1`, [
      id,
      run.at,
      run.status,
      run.message.slice(0, 1000),
    ]);
  },
};
