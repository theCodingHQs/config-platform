import { pool } from '../db/pool.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';

export interface PlanLimits {
  maxEntities: number;
  maxFieldsPerEntity: number;
  maxRecordsPerEntity: number;
  maxPages: number;
  maxMembers: number;
  maxExportRows: number;
  maxConcurrentExports: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxEntities: 10,
    maxFieldsPerEntity: 25,
    maxRecordsPerEntity: 1000,
    maxPages: 10,
    maxMembers: 5,
    maxExportRows: 50000,
    maxConcurrentExports: 2,
  },
  pro: {
    maxEntities: 100,
    maxFieldsPerEntity: 100,
    maxRecordsPerEntity: 100000,
    maxPages: 100,
    maxMembers: 50,
    maxExportRows: 100000,
    maxConcurrentExports: 5,
  },
  enterprise: {
    maxEntities: 1000,
    maxFieldsPerEntity: 500,
    maxRecordsPerEntity: 10000000,
    maxPages: 1000,
    maxMembers: 1000,
    maxExportRows: 500000,
    maxConcurrentExports: 10,
  },
};

export class LimitExceededError extends Error {
  public statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

const tenantExportConcurrency = new Map<string, number>();

export class TenantLimitsService {
  async getTenantPlan(tenantId: string): Promise<{ plan: string; limits: PlanLimits }> {
    const res = await pool.query<{ plan: string }>(
      `SELECT plan FROM public.tenant WHERE id = $1`,
      [tenantId]
    );
    const plan = (res.rows[0]?.plan || 'free').toLowerCase();
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    return { plan, limits };
  }

  async checkEntityLimit(tenantId: string): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.entity_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const current = parseInt(res.rows[0]?.count || '0', 10);
    if (current >= limits.maxEntities) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxEntities} entities (current: ${current}). Upgrade plan to create more.`
      );
    }
  }

  async checkFieldLimit(tenantId: string, entityId: string): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.field_def WHERE tenant_id = $1 AND entity_id = $2`,
      [tenantId, entityId]
    );
    const current = parseInt(res.rows[0]?.count || '0', 10);
    if (current >= limits.maxFieldsPerEntity) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxFieldsPerEntity} fields per entity (current: ${current}).`
      );
    }
  }

  async checkRecordLimit(tenantId: string, entityPhysicalTable: string): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schemaName}"."${entityPhysicalTable}"`
    );
    const current = parseInt(res.rows[0]?.count || '0', 10);
    if (current >= limits.maxRecordsPerEntity) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxRecordsPerEntity} records per entity (current: ${current}).`
      );
    }
  }

  async checkPageLimit(tenantId: string): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.page_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const current = parseInt(res.rows[0]?.count || '0', 10);
    if (current >= limits.maxPages) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxPages} pages (current: ${current}).`
      );
    }
  }

  async checkMemberLimit(tenantId: string): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.tenant_member WHERE tenant_id = $1`,
      [tenantId]
    );
    const current = parseInt(res.rows[0]?.count || '0', 10);
    if (current >= limits.maxMembers) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxMembers} members (current: ${current}).`
      );
    }
  }

  async checkExportLimit(tenantId: string, rowCount: number): Promise<void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    if (rowCount > limits.maxExportRows) {
      throw new LimitExceededError(
        `Export exceeds maximum allowed rows (${limits.maxExportRows.toLocaleString()}). Requested export size is ${rowCount.toLocaleString()} rows. Export aborted.`
      );
    }
  }

  async acquireExportSlot(tenantId: string): Promise<() => void> {
    const { plan, limits } = await this.getTenantPlan(tenantId);
    const current = tenantExportConcurrency.get(tenantId) || 0;
    if (current >= limits.maxConcurrentExports) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxConcurrentExports} concurrent exports. Currently ${current} exports running.`
      );
    }
    tenantExportConcurrency.set(tenantId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = tenantExportConcurrency.get(tenantId) || 1;
      if (count <= 1) {
        tenantExportConcurrency.delete(tenantId);
      } else {
        tenantExportConcurrency.set(tenantId, count - 1);
      }
    };
  }

  async getUsageReport(tenantId: string) {
    const { plan, limits } = await this.getTenantPlan(tenantId);

    const [entityRes, pageRes, memberRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.entity_def WHERE tenant_id = $1`,
        [tenantId]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.page_def WHERE tenant_id = $1`,
        [tenantId]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.tenant_member WHERE tenant_id = $1`,
        [tenantId]
      ),
    ]);

    return {
      tenantId,
      plan,
      limits,
      usage: {
        entities: parseInt(entityRes.rows[0]?.count || '0', 10),
        pages: parseInt(pageRes.rows[0]?.count || '0', 10),
        members: parseInt(memberRes.rows[0]?.count || '0', 10),
      },
    };
  }
}

export const tenantLimitsService = new TenantLimitsService();
