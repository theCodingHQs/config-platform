import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { exportImportService } from './export-import-service.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { createRateLimitHook } from '../auth/rate-limiter.js';
import { hasMinRole } from '../auth/auth-types.js';
import { pool } from '../db/pool.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { auditLogService } from '../audit/audit-service.js';
import { WorkspaceThemeConfigSchema, validateAccentContrast } from '@config-platform/schema';
import argon2 from 'argon2';

export async function workspaceRoutes(fastify: FastifyInstance) {
  // GET /workspace/theme - Returns workspace theme configuration and policy
  fastify.get('/workspace/theme', async (req: FastifyRequest) => {
    const { tenantId } = req.session;
    const defaultPreset = process.env.DEFAULT_THEME_PRESET || 'neutral';
    const themeEditing = (process.env.THEME_EDITING || 'enabled').toLowerCase();

    const tenantRes = await pool.query<{ theme_config?: any }>(
      'SELECT theme_config FROM public.tenant WHERE id = $1',
      [tenantId]
    );

    const rawConfig = tenantRes.rows[0]?.theme_config;
    const themeConfig = {
      presetId: rawConfig?.presetId || defaultPreset,
      overrides: rawConfig?.overrides || {},
    };

    return {
      themeConfig,
      themeEditing,
      defaultPreset,
    };
  });

  // PATCH /workspace/theme - Update workspace theme configuration (builder+)
  fastify.patch('/workspace/theme', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, role, email } = req.session;

    if (!hasMinRole(role, 'builder')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Builder role or higher required to configure workspace theme',
      });
    }

    const themeEditing = (process.env.THEME_EDITING || 'enabled').toLowerCase();
    if (themeEditing === 'locked') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Workspace theme editing is locked by platform policy (THEME_EDITING=locked)',
      });
    }

    const parseResult = WorkspaceThemeConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid theme configuration',
        issues: parseResult.error.issues,
      });
    }

    const themeConfig = parseResult.data;

    let contrastWarning: string | undefined;
    if (themeConfig.overrides?.accent) {
      const contrastCheck = validateAccentContrast(themeConfig.overrides.accent);
      if (!contrastCheck.isCompliant) {
        contrastWarning = contrastCheck.warning;
      }
    }

    // Capture beforeState for audit log
    const beforeRes = await pool.query<{ theme_config?: any }>(
      'SELECT theme_config FROM public.tenant WHERE id = $1',
      [tenantId]
    );
    const beforeState = beforeRes.rows[0]?.theme_config || {
      presetId: process.env.DEFAULT_THEME_PRESET || 'neutral',
      overrides: {},
    };

    // Update tenant theme configuration
    await pool.query(
      'UPDATE public.tenant SET theme_config = $1 WHERE id = $2',
      [JSON.stringify(themeConfig), tenantId]
    );

    // Write audit log entry
    await auditLogService.log({
      tenantId,
      userId,
      userEmail: email,
      action: 'tenant.theme_updated',
      entityType: 'tenant',
      entityId: tenantId,
      beforeState: { themeConfig: beforeState },
      afterState: { themeConfig },
    });

    return {
      success: true,
      themeConfig,
      warning: contrastWarning,
    };
  });

  // GET /workspace/usage - Returns usage vs plan limits
  fastify.get('/workspace/usage', async (req: FastifyRequest) => {
    const { tenantId } = req.session;
    return await tenantLimitsService.getUsageReport(tenantId);
  });

  // GET /workspace/export - Export schema and pages as versioned bundle (builder+)
  fastify.get('/workspace/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    if (!hasMinRole(role, 'builder')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Builder role or higher required to export workspace',
      });
    }
    const bundle = await exportImportService.exportBundle(tenantId);
    return bundle;
  });

  // POST /workspace/import - Import versioned bundle (admin+)
  fastify.post('/workspace/import', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    if (!hasMinRole(role, 'admin')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin or owner role required to import workspace',
      });
    }

    const { bundle, dryRun } = (req.body as any) || {};
    if (!bundle) {
      return reply.status(400).send({ error: 'bundle is required' });
    }

    const result = await exportImportService.importBundle(tenantId, bundle, Boolean(dryRun), req.session);
    if (!result.success && !dryRun) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Import failed due to conflicts or limit violations',
        conflicts: result.conflicts,
      });
    }
    return result;
  });

  // DELETE /workspace/tenant - Teardown current tenant and drop schema (owner only)
  // Requires body: { confirmName: string, password: string }
  // Rate-limited and records an audit log before deletion.
  // Interacts with append-only audit trigger via transaction-scoped `SET LOCAL audit.allow_tenant_purge = 'on'`.
  fastify.delete('/workspace/tenant', {
    preHandler: [createRateLimitHook(10, 15 * 60 * 1000), csrfCheckHook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, role } = req.session;
    if (role !== 'owner') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Only the workspace owner can teardown the tenant',
      });
    }

    const { confirmName, password } = (req.body as any) || {};
    if (!confirmName || !password) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'confirmName and password are required to delete the workspace',
      });
    }

    // Verify confirmName matches tenant name
    const tenantRes = await pool.query('SELECT name FROM public.tenant WHERE id = $1', [tenantId]);
    if (tenantRes.rows.length === 0) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Tenant not found' });
    }
    const currentName = tenantRes.rows[0].name;
    if (confirmName !== currentName) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Workspace name confirmation does not match',
      });
    }

    // Verify owner's password
    const userRes = await pool.query('SELECT password_hash FROM public.app_user WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'User not found' });
    }
    const validPassword = await argon2.verify(userRes.rows[0].password_hash, password);
    if (!validPassword) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid password',
      });
    }

    // Write audit log entry before deletion
    await auditLogService.log({
      tenantId,
      userId,
      userEmail: req.session.email,
      action: 'workspace.delete',
      entityType: 'tenant',
      entityId: tenantId,
      beforeState: { tenantName: currentName },
    });

    const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);

    // Drop tenant Postgres schema
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);

    // Scoped transaction teardown:
    // Uses transaction-local `SET LOCAL audit.allow_tenant_purge = 'on'` to permit
    // removing audit rows for this tenant without disabling the trigger globally.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL audit.allow_tenant_purge = 'on';");
      await client.query(`DELETE FROM public.audit_log WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);

      const remaining = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.tenant_member WHERE user_id = $1`,
        [userId]
      );
      if (remaining.rows[0].count === 0) {
        await client.query(`DELETE FROM public.email_verification_token WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM public.app_user WHERE id = $1`, [userId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    reply
      .clearCookie('sid', { path: '/' })
      .clearCookie('csrf_token', { path: '/' })
      .send({ success: true, message: `Tenant ${tenantId} and schema ${schemaName} cleaned up.` });
  });
}
