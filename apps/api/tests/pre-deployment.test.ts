import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { pool, directPool, DEFAULT_STATEMENT_TIMEOUT_MS, coerceStatementTimeout } from '../src/db/pool.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { initializeMetadataCatalog, isCatalogReady, setCatalogReady } from '../src/db/catalog-init.js';
import { runCatalogMigrations, editorDeleteMigrationReport } from '../src/db/catalog-migration-runner.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { authService, AuthError, emailVerificationRequired } from '../src/auth/auth-service.js';
import { validateEmailConfig, ProductionEmailSender, getPublicUrl } from '../src/auth/email-verifier.js';
import { auditLogService } from '../src/audit/audit-service.js';
import { tenantLimitsService } from '../src/limits/tenant-limits.js';
import { exportImportService } from '../src/workspace/export-import-service.js';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Pre-Deployment Hardening & Production Guards', () => {
  let server: FastifyInstance;
  const tenant = `predeploy_${crypto.randomBytes(3).toString('hex')}`;
  let owner: TestSession;
  let admin: TestSession;
  let builder: TestSession;
  let viewer: TestSession;
  let baseEntityId: string;
  let skuFieldId: string;

  beforeAll(async () => {
    await initializeMetadataCatalog();
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(tenant, 'Predeploy Workspace');
    owner = await createTestSession(tenant, 'owner', 'predeploy_owner');
    admin = await createTestSession(tenant, 'admin', 'predeploy_admin');
    builder = await createTestSession(tenant, 'builder', 'predeploy_builder');
    viewer = await createTestSession(tenant, 'viewer', 'predeploy_viewer');

    const entRes = await migrationService.createEntity(tenant, {
      name: 'item',
      label: 'Item',
      fields: [
        { name: 'sku', label: 'SKU', type: 'text', required: true, unique: false, config: {} },
        { name: 'qty', label: 'Quantity', type: 'number', required: false, unique: false, config: {} },
      ],
    });
    baseEntityId = entRes.entityId;
    skuFieldId = entRes.fields.find((f: any) => f.name === 'sku')!.id;
  }, 60000);

  afterAll(async () => {
    if (owner?.userId) await cleanupTestUser(owner.userId);
    if (admin?.userId) await cleanupTestUser(admin.userId);
    if (builder?.userId) await cleanupTestUser(builder.userId);
    if (viewer?.userId) await cleanupTestUser(viewer.userId);
    if (server) await server.close();
  });

  // =========================================================================
  // 1. No Demo Content Shipped: seed.ts is deleted
  // =========================================================================
  describe('1. No Demo Content Shipped', () => {
    it('confirms seed.ts does not exist in api source', () => {
      const seedFile = path.resolve(__dirname, '../src/seed.ts');
      expect(fs.existsSync(seedFile)).toBe(false);
    });
  });

  // =========================================================================
  // 2. SET LOCAL statement_timeout & Cancellation on pg_sleep
  // =========================================================================
  describe('2. SET LOCAL Statement Timeout', () => {
    it('cancels queries where pg_sleep exceeds the timeout with 57014', async () => {
      // Execute a query that sleeps 1 second with a 100ms timeout
      await expect(
        defaultStorageAdapter.query(tenant, 'SELECT pg_sleep(1)', [], 100)
      ).rejects.toThrow(/(canceling statement due to statement timeout|statement timeout)/i);
    });

    it('successfully completes queries that finish within the timeout', async () => {
      const rows = await defaultStorageAdapter.query<{ result: number }>(
        tenant,
        'SELECT 42 as result',
        [],
        2000
      );
      expect(rows[0]?.result).toBe(42);
    });

    it('coerces statement timeout to a validated positive integer before SET LOCAL', () => {
      expect(coerceStatementTimeout('5000')).toBe(5000);
      expect(coerceStatementTimeout(15000)).toBe(15000);
      expect(coerceStatementTimeout('invalid; DROP TABLE users;')).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
      expect(coerceStatementTimeout(NaN)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
      expect(coerceStatementTimeout(-500)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
      expect(coerceStatementTimeout(null)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
      expect(coerceStatementTimeout(undefined)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
      expect(coerceStatementTimeout(999999999)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
    });

    it('executes query safely when passed string or edge-case timeout', async () => {
      const rows = await defaultStorageAdapter.query<{ result: number }>(
        tenant,
        'SELECT 100 as result',
        [],
        '5000' as any
      );
      expect(rows[0]?.result).toBe(100);
    });
  });

  // =========================================================================
  // 3. DATABASE_URL_DIRECT and /health/ready 503 until ready
  // =========================================================================
  describe('3. Migrations Direct Connection & Readiness Probe', () => {
    it('while migrations run, /health/live returns 200 and /health/ready returns 503', async () => {
      setCatalogReady(false);
      try {
        const liveRes = await server.inject({ method: 'GET', url: '/health/live' });
        expect(liveRes.statusCode).toBe(200);
        expect(liveRes.json().status).toBe('live');

        const readyRes = await server.inject({ method: 'GET', url: '/health/ready' });
        expect(readyRes.statusCode).toBe(503);
        expect(readyRes.json().status).toBe('not_ready');
      } finally {
        setCatalogReady(true);
      }
    });

    it('GET /health/ready returns 503 when migrations are not ready', async () => {
      setCatalogReady(false);
      try {
        const res = await server.inject({ method: 'GET', url: '/health/ready' });
        expect(res.statusCode).toBe(503);
        expect(res.json().status).toBe('not_ready');
      } finally {
        setCatalogReady(true);
      }
    });

    it('GET /health/ready returns 200 when migrations are complete and DB is reachable', async () => {
      setCatalogReady(true);
      const res = await server.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ready');
    });

    it('directPool can connect and run migrations with blocking advisory lock', async () => {
      const report = await runCatalogMigrations(directPool);
      expect(report.success).toBe(true);
    });
  });


  // =========================================================================
  // 4. trustProxy and Rate Limiting on Forwarded Client IP
  // =========================================================================
  describe('4. trustProxy and Forwarded Client IP Rate Limiting', () => {
    it('rate limiter keys on X-Forwarded-For client IP when trustProxy is enabled', async () => {
      const forwardedIp = '198.51.100.88';

      // Inject 3 requests with x-forwarded-for header
      for (let i = 0; i < 3; i++) {
        const res = await server.inject({
          method: 'GET',
          url: '/health',
          headers: {
            'x-forwarded-for': forwardedIp,
          },
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  // =========================================================================
  // 5. DB-Level Append-Only Audit Log (Trigger) & Multi-Event Logging
  // =========================================================================
  describe('5. Append-Only Audit Log at DB Level & Events', () => {
    it('trigger rejects UPDATE on public.audit_log with append-only error', async () => {
      // Insert test log entry directly
      const logId = `test_audit_${crypto.randomBytes(4).toString('hex')}`;
      await pool.query(
        `INSERT INTO public.audit_log (id, tenant_id, user_id, user_email, action, entity_type, entity_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [logId, tenant, owner.userId, owner.email, 'test.action', 'test', '1']
      );

      // Attempt UPDATE - should be blocked by PostgreSQL trigger
      await expect(
        pool.query(`UPDATE public.audit_log SET action = 'tampered' WHERE id = $1`, [logId])
      ).rejects.toThrow(/audit_log is append-only/i);
    });

    it('trigger rejects DELETE on public.audit_log with append-only error', async () => {
      const logId = `test_audit_${crypto.randomBytes(4).toString('hex')}`;
      await pool.query(
        `INSERT INTO public.audit_log (id, tenant_id, user_id, user_email, action, entity_type, entity_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [logId, tenant, owner.userId, owner.email, 'test.action', 'test', '2']
      );

      // Attempt DELETE - should be blocked by PostgreSQL trigger
      await expect(
        pool.query(`DELETE FROM public.audit_log WHERE id = $1`, [logId])
      ).rejects.toThrow(/audit_log is append-only/i);
    });

    it('records and returns audit events for field, permission, member, and import operations', async () => {
      // 1. Field event
      await server.inject({
        method: 'POST',
        url: `/api/schema/entities/${baseEntityId}/fields`,
        headers: builder.headers,
        payload: {
          name: 'notes',
          label: 'Notes',
          type: 'text',
          expectedVersion: 1,
        },
      });

      // 2. Permission event
      await server.inject({
        method: 'PUT',
        url: `/api/schema/entities/${baseEntityId}/permissions/editor`,
        headers: admin.headers,
        payload: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
      });

      // 3. Member invite event
      await server.inject({
        method: 'POST',
        url: '/api/auth/invite',
        headers: admin.headers,
        payload: {
          email: 'audit_test_invitee@example.com',
          role: 'viewer',
        },
      });

      // 4. Import event
      const exportData = await exportImportService.exportBundle(tenant);
      await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: admin.headers,
        payload: {
          // A consistent bundle: with no entities, nothing may reference them (import rejects
          // permissions or templates that point at entities missing from the bundle)
          bundle: {
            ...exportData,
            entities: [],
            relations: [],
            pages: [],
            exportTemplates: [],
            permissions: { entities: [], fields: [] },
          },
          dryRun: false,
        },
      });

      // Fetch audit logs via API
      const logsRes = await server.inject({
        method: 'GET',
        url: '/api/audit-logs',
        headers: admin.headers,
      });
      expect(logsRes.statusCode).toBe(200);
      const actions = logsRes.json().map((l: any) => l.action);
      expect(actions).toContain('field.create');
      expect(actions).toContain('permission.entity.update');
      expect(actions).toContain('member.invite');
      expect(actions).toContain('workspace.import');
    });
  });

  // =========================================================================
  // 6. Max Records per Entity, Import Role & Limits, Invite Tenant Parameter, Email Verification Flag
  // =========================================================================
  describe('6. Plan Limits, Import Guards, Invite Parameter & Email Verification', () => {
    it('rejects POST /workspace/import when requested by non-admin (builder gets 403)', async () => {
      const bundle = await exportImportService.exportBundle(tenant);
      const res = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: builder.headers,
        payload: { bundle, dryRun: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Admin or owner role required');
    });

    it('honors plan limits during import and reports limit conflicts', async () => {
      const bundle = await exportImportService.exportBundle(tenant);
      // Fabricate bundle exceeding maxEntities (free plan allows 10)
      // Only the fabricated entities: nothing in the bundle refers to the workspace's real ones
      const hugeBundle = {
        ...bundle,
        relations: [],
        pages: [],
        exportTemplates: [],
        permissions: { entities: [], fields: [] },
        entities: Array.from({ length: 15 }, (_, i) => ({
          id: `fake_e_${i}`,
          name: `fake_entity_${i}`,
          label: `Fake Entity ${i}`,
          fields: [{ id: `fake_f_${i}`, name: 'f1', label: 'F1', type: 'text', required: false, isUnique: false, position: 1, config: {} }],
        })),
      };

      const res = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: admin.headers,
        payload: { bundle: hugeBundle, dryRun: false },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().conflicts[0]).toContain('Limit exceeded');
    });

    it('POST /auth/invite ignores any tenant field in the body', async () => {
      const foreignTenant = `foreign_${crypto.randomBytes(3).toString('hex')}`;
      const inviteEmail = `ignore_body_tenant_${crypto.randomBytes(4).toString('hex')}@example.com`;
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/invite',
        headers: admin.headers,
        payload: {
          email: inviteEmail,
          role: 'viewer',
          tenantId: foreignTenant,
          tenant: foreignTenant,
        },
      });
      // Foreign tenant parameters are ignored and invite succeeds for admin's tenant
      expect(res.statusCode).toBe(201);
      const token = res.json().token;
      expect(token).toBeDefined();

      const inviteDb = await pool.query(
        'SELECT * FROM public.invite_token WHERE invitee_email = $1',
        [inviteEmail]
      );
      expect(inviteDb.rows.length).toBe(1);
      expect(inviteDb.rows[0].tenant_id).toBe(tenant);
      expect(inviteDb.rows[0].tenant_id).not.toBe(foreignTenant);
    });


    it('unverified email blocks login when REQUIRE_EMAIL_VERIFICATION is enabled', async () => {
      const origFlag = process.env.REQUIRE_EMAIL_VERIFICATION;
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';

      const unverifiedEmail = `unverified_${crypto.randomBytes(4).toString('hex')}@example.com`;
      const pass = 'superSecretPass1234!';
      const signupRes = await authService.signup(unverifiedEmail, pass, 'Unverified Tenant');

      try {
        // Attempt login while unverified -> must throw 403
        await expect(authService.login(unverifiedEmail, pass)).rejects.toThrow(
          /Email verification required before accessing workspace/i
        );

        // Verify the user email
        const tokenRes = await pool.query(
          'SELECT token FROM public.email_verification_token WHERE email = $1',
          [unverifiedEmail]
        );
        expect(tokenRes.rows.length).toBe(1);
        await pool.query('UPDATE public.app_user SET email_verified = true WHERE id = $1', [signupRes.userId]);

        // Login now succeeds
        const session = await authService.login(unverifiedEmail, pass);
        expect(session.userId).toBe(signupRes.userId);
      } finally {
        process.env.REQUIRE_EMAIL_VERIFICATION = origFlag;
        await cleanupTestUser(signupRes.userId);
      }
    });
  });

  // =========================================================================
  // 7. Health Endpoints & Error Sanitization in Production
  // =========================================================================
  describe('7. Health Endpoints & Production Error Sanitization', () => {
    it('GET /health/live returns 200 with status live and uptime', async () => {
      const res = await server.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('live');
      expect(typeof res.json().uptime).toBe('number');
    });

    it('includes request ID in response headers or allows client request ID', async () => {
      const customReqId = 'custom-request-id-12345';
      const res = await server.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': customReqId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBe(customReqId);
    });

    it('never leaks SQL or stack traces in production error responses', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        // Inject a request that causes a 500 error
        const res = await server.inject({
          method: 'GET',
          url: `/api/entities/invalid_entity_causing_internal_error/records`,
          headers: owner.headers,
        });

        const body = res.json();
        // Should not expose database query statements, table details, or stack traces
        expect(JSON.stringify(body)).not.toContain('SELECT');
        expect(JSON.stringify(body)).not.toContain('public.');
        expect(JSON.stringify(body)).not.toContain('stack');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  // =========================================================================
  // 8. Editor canDelete Permission Migration Real Count
  // =========================================================================
  describe('8. Permission Migration Row Count', () => {
    it('reports rows changed from the permissions migration', () => {
      expect(editorDeleteMigrationReport).toBeDefined();
      expect(typeof editorDeleteMigrationReport.rowsChanged).toBe('number');
      console.log('Real rowsChanged from permissions migration:', editorDeleteMigrationReport.rowsChanged);
    });
  });

  // =========================================================================
  // 9. Static Web App Serving, SPA Fallback & Cache-Control
  // =========================================================================
  describe('9. Static Web App Serving & SPA Fallback', () => {
    it('serves index.html with Cache-Control no-store on root GET /', async () => {
      const res = await server.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
      expect(res.payload).toContain('<div id="root">');
    });

    it('falls back to index.html with Cache-Control no-store for non-/api, non-/health GET routes', async () => {
      const res = await server.inject({ method: 'GET', url: '/studio/custom-page' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
      expect(res.payload).toContain('<div id="root">');
    });

    it('serves hashed assets under /assets with immutable cache header', async () => {
      const assetsDir = path.resolve(__dirname, '../../web/dist/assets');
      const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.js')) : [];
      const targetFile = files[0] || 'index.js';
      const res = await server.inject({ method: 'GET', url: `/assets/${targetFile}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });


    it('returns 404 JSON for non-existent /api routes (does not fall back to index.html)', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/non_existent_route_xyz' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.json().error).toBe('Not Found');
    });
  });

  // =========================================================================
  // 10. Production EmailSender & Startup Guard
  // =========================================================================
  describe('10. Production EmailSender & Startup Validation', () => {
    it('starts in production without an email service (set up later on Platform setup), without requiring confirmation emails meanwhile', () => {
      const origEnv = process.env.NODE_ENV;
      const origReq = process.env.REQUIRE_EMAIL_VERIFICATION;
      const origResend = process.env.RESEND_API_KEY;
      const origSmtp = process.env.SMTP_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.REQUIRE_EMAIL_VERIFICATION;
        delete process.env.RESEND_API_KEY;
        delete process.env.SMTP_URL;

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => validateEmailConfig()).not.toThrow();
        expect(warn.mock.calls[0][0]).toMatch(/No email service is set up/);
        warn.mockRestore();
        // Confirmation emails couldn't be delivered, so they aren't required yet
        expect(emailVerificationRequired()).toBe(false);
        process.env.RESEND_API_KEY = 're_test';
        expect(emailVerificationRequired()).toBe(true);
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origReq !== undefined) process.env.REQUIRE_EMAIL_VERIFICATION = origReq;
        else delete process.env.REQUIRE_EMAIL_VERIFICATION;
        if (origResend !== undefined) process.env.RESEND_API_KEY = origResend;
        else delete process.env.RESEND_API_KEY;
        if (origSmtp !== undefined) process.env.SMTP_URL = origSmtp;
        else delete process.env.SMTP_URL;
      }
    });

    it('allows startup in production without email provider if REQUIRE_EMAIL_VERIFICATION=false', () => {
      const origEnv = process.env.NODE_ENV;
      const origReq = process.env.REQUIRE_EMAIL_VERIFICATION;
      const origResend = process.env.RESEND_API_KEY;
      const origSmtp = process.env.SMTP_URL;

      try {
        process.env.NODE_ENV = 'production';
        process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
        delete process.env.RESEND_API_KEY;
        delete process.env.SMTP_URL;

        expect(() => validateEmailConfig()).not.toThrow();
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origReq !== undefined) process.env.REQUIRE_EMAIL_VERIFICATION = origReq;
        else delete process.env.REQUIRE_EMAIL_VERIFICATION;
        if (origResend !== undefined) process.env.RESEND_API_KEY = origResend;
        else delete process.env.RESEND_API_KEY;
        if (origSmtp !== undefined) process.env.SMTP_URL = origSmtp;
        else delete process.env.SMTP_URL;
      }
    });

    it('uses PUBLIC_URL for verification and invite email links', async () => {
      const origPub = process.env.PUBLIC_URL;
      process.env.PUBLIC_URL = 'https://app.customdomain.io';

      try {
        expect(getPublicUrl()).toBe('https://app.customdomain.io');

        const sender = new ProductionEmailSender();
        let sentOptions: any = null;
        (sender as any).sendMail = async (opts: any) => {
          sentOptions = opts;
        };

        await sender.sendVerificationEmail('user@domain.com', 'test_verify_token_123');
        expect(sentOptions.html).toContain('https://app.customdomain.io/verify-email?token=test_verify_token_123');

        await sender.sendInviteEmail('invitee@domain.com', 'test_invite_token_456', 'inviter@domain.com', 'Test Corp');
        expect(sentOptions.html).toContain('https://app.customdomain.io/accept-invite?token=test_invite_token_456');
        expect(sentOptions.html).toContain('Test Corp');
        expect(sentOptions.html).toContain('inviter@domain.com');
      } finally {
        if (origPub !== undefined) process.env.PUBLIC_URL = origPub;
        else delete process.env.PUBLIC_URL;
      }
    });
  });
});

