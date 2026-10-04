import crypto from 'node:crypto';
import { pool } from '../db/pool.js';

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: any;
  afterState: any;
  createdAt: string;
}

export class AuditLogService {
  async log(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: any;
    afterState?: any;
  }): Promise<void> {
    const id = `audit_${crypto.randomBytes(8).toString('hex')}`;
    try {
      await pool.query(
        `INSERT INTO public.audit_log (id, tenant_id, user_id, user_email, action, entity_type, entity_id, before_state, after_state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          id,
          params.tenantId,
          params.userId,
          params.userEmail,
          params.action,
          params.entityType,
          params.entityId,
          params.beforeState ? JSON.stringify(params.beforeState) : null,
          params.afterState ? JSON.stringify(params.afterState) : null,
        ]
      );
    } catch (err) {
      console.error('[AUDIT LOG ERROR] Failed to record audit log:', err);
    }
  }

  async getLogs(
    tenantId: string,
    options: { limit?: number; offset?: number; entityType?: string; action?: string } = {}
  ): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    const conditions = ['tenant_id = $1'];
    const values: any[] = [tenantId];
    let idx = 2;

    if (options.entityType) {
      conditions.push(`entity_type = $${idx++}`);
      values.push(options.entityType);
    }

    if (options.action) {
      conditions.push(`action = $${idx++}`);
      values.push(options.action);
    }

    values.push(limit, offset);

    const query = `
      SELECT id, tenant_id AS "tenantId", user_id AS "userId", user_email AS "userEmail",
             action, entity_type AS "entityType", entity_id AS "entityId",
             before_state AS "beforeState", after_state AS "afterState",
             created_at AS "createdAt"
      FROM public.audit_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const res = await pool.query<AuditLogEntry>(query, values);
    return res.rows;
  }
}

export const auditLogService = new AuditLogService();
