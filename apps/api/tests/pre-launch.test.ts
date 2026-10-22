import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer, checkDemoAccountWarning } from '../src/server.js';
import { pool } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { validateEmailConfig } from '../src/auth/email-verifier.js';
import { getSignupMode } from '../src/auth/auth-routes.js';
import { bootstrapOwner } from '../src/scripts/bootstrap-owner.js';
import { checkDbClean } from '../src/scripts/check-db-clean.js';
import { defaultRateLimiter } from '../src/auth/rate-limiter.js';
import { createTestSession } from './test-session-helper.js';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

describe('Pre-Launch Fixes & Verification', () => {
  let server: FastifyInstance;
  // A workspace with a member, so "tenants already exist" checks don't depend on what other
  // test files happened to leave in the database
  const fixtureTenant = `prelaunch_${crypto.randomBytes(3).toString('hex')}`;
  let fixtureUserId: string;

  beforeAll(async () => {
    await initializeMetadataCatalog();
    server = await buildServer();
    await server.ready();
    await defaultStorageAdapter.initTenant(fixtureTenant);
    await pool.query(
      `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, 'Pre-Launch Fixture', 1) ON CONFLICT (id) DO NOTHING`,
      [fixtureTenant]
    );
    fixtureUserId = (await createTestSession(fixtureTenant, 'owner', 'prelaunch_fixture')).userId;
  });

  afterAll(async () => {
    if (server) await server.close();
    await pool.query('DELETE FROM public.tenant_member WHERE user_id = $1', [fixtureUserId]);
    await pool.query('DELETE FROM public.app_user WHERE id = $1', [fixtureUserId]);
    await pool.query('DELETE FROM public.tenant WHERE id = $1', [fixtureTenant]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(fixtureTenant)}" CASCADE`);
  });

  beforeEach(() => {
    (defaultRateLimiter as any).reset?.();
  });

  // Helper to fetch CSRF token for unauthenticated requests
  async function getCsrfHeaders(): Promise<Record<string, string>> {
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/csrf',
    });
    const body = JSON.parse(res.body);
    const token = body.csrfToken;
    return {
      'content-type': 'application/json',
      'x-csrf-token': token,
      cookie: `csrf_token=${token}`,
    };
  }

  // --------------------------------------------------------------------------
  // Item 4: EMAIL_FROM is required in production when provider is configured
  // --------------------------------------------------------------------------
  describe('EMAIL_FROM production enforcement', () => {
    it('fails startup in production when RESEND_API_KEY is configured but EMAIL_FROM is missing', () => {
      const origEnv = process.env.NODE_ENV;
      const origResend = process.env.RESEND_API_KEY;
      const origFrom = process.env.EMAIL_FROM;

      try {
        process.env.NODE_ENV = 'production';
        process.env.RESEND_API_KEY = 're_test_key_123';
        delete process.env.EMAIL_FROM;

        expect(() => validateEmailConfig()).toThrow(
          /EMAIL_FROM environment variable is required in production when an email provider is configured/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origResend !== undefined) process.env.RESEND_API_KEY = origResend;
        else delete process.env.RESEND_API_KEY;
        if (origFrom !== undefined) process.env.EMAIL_FROM = origFrom;
        else delete process.env.EMAIL_FROM;
      }
    });

    it('fails startup in production when SMTP_URL is configured but EMAIL_FROM is missing', () => {
      const origEnv = process.env.NODE_ENV;
      const origSmtp = process.env.SMTP_URL;
      const origFrom = process.env.EMAIL_FROM;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.RESEND_API_KEY;
        process.env.SMTP_URL = 'smtp://user:pass@smtp.mailgun.org:587';
        delete process.env.EMAIL_FROM;

        expect(() => validateEmailConfig()).toThrow(
          /EMAIL_FROM environment variable is required in production when an email provider is configured/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origSmtp !== undefined) process.env.SMTP_URL = origSmtp;
        else delete process.env.SMTP_URL;
        if (origFrom !== undefined) process.env.EMAIL_FROM = origFrom;
        else delete process.env.EMAIL_FROM;
      }
    });

    it('succeeds in production when provider and EMAIL_FROM are both present', () => {
      const origEnv = process.env.NODE_ENV;
      const origResend = process.env.RESEND_API_KEY;
      const origFrom = process.env.EMAIL_FROM;

      try {
        process.env.NODE_ENV = 'production';
        process.env.RESEND_API_KEY = 're_test_key_123';
        process.env.EMAIL_FROM = 'noreply@platform.io';

        expect(() => validateEmailConfig()).not.toThrow();
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origResend !== undefined) process.env.RESEND_API_KEY = origResend;
        else delete process.env.RESEND_API_KEY;
        if (origFrom !== undefined) process.env.EMAIL_FROM = origFrom;
        else delete process.env.EMAIL_FROM;
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 3: SIGNUP_MODE (open | invite_only)
  // --------------------------------------------------------------------------
  describe('SIGNUP_MODE registration enforcement', () => {
    it('defaults to invite_only in production and open in development/test', () => {
      const origEnv = process.env.NODE_ENV;
      const origMode = process.env.SIGNUP_MODE;

      try {
        delete process.env.SIGNUP_MODE;
        process.env.NODE_ENV = 'production';
        expect(getSignupMode()).toBe('invite_only');

        process.env.NODE_ENV = 'development';
        expect(getSignupMode()).toBe('open');

        process.env.NODE_ENV = 'test';
        expect(getSignupMode()).toBe('open');

        // Explicit override in production
        process.env.NODE_ENV = 'production';
        process.env.SIGNUP_MODE = 'open';
        expect(getSignupMode()).toBe('open');

        // Explicit override in development
        process.env.NODE_ENV = 'development';
        process.env.SIGNUP_MODE = 'invite_only';
        expect(getSignupMode()).toBe('invite_only');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origMode !== undefined) process.env.SIGNUP_MODE = origMode;
        else delete process.env.SIGNUP_MODE;
      }
    });

    it('rejects POST /api/auth/signup with 403 when SIGNUP_MODE=invite_only', async () => {
      const origMode = process.env.SIGNUP_MODE;
      const csrfHeaders = await getCsrfHeaders();
      try {
        process.env.SIGNUP_MODE = 'invite_only';

        const res = await server.inject({
          method: 'POST',
          url: '/api/auth/signup',
          headers: csrfHeaders,
          payload: {
            email: `blocked_${crypto.randomBytes(4).toString('hex')}@example.com`,
            password: 'ValidPassword123!',
            tenantName: 'Blocked Tenant',
          },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(body.error).toBe('Forbidden');
        expect(body.message).toMatch(/Public registration is disabled/i);
      } finally {
        if (origMode !== undefined) process.env.SIGNUP_MODE = origMode;
        else delete process.env.SIGNUP_MODE;
      }
    });

    it('allows POST /api/auth/signup when SIGNUP_MODE=open', async () => {
      const origMode = process.env.SIGNUP_MODE;
      const csrfHeaders = await getCsrfHeaders();
      const rand = crypto.randomBytes(4).toString('hex');
      try {
        process.env.SIGNUP_MODE = 'open';

        const res = await server.inject({
          method: 'POST',
          url: '/api/auth/signup',
          headers: csrfHeaders,
          payload: {
            email: `allowed_${rand}@example.com`,
            password: 'ValidPassword123!',
            tenantName: `Allowed Tenant ${rand}`,
          },
        });

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.email).toBe(`allowed_${rand}@example.com`);
        expect(body.tenantId).toBeDefined();

        // Clean up created tenant
        const sName = defaultStorageAdapter.getTenantSchemaName(body.tenantId);
        await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE;`);
        await pool.query('DELETE FROM public.tenant WHERE id = $1', [body.tenantId]);
        await pool.query('DELETE FROM public.app_user WHERE id = $1', [body.id]);
      } finally {
        if (origMode !== undefined) process.env.SIGNUP_MODE = origMode;
        else delete process.env.SIGNUP_MODE;
      }
    });
  });

  // --------------------------------------------------------------------------
  // Item 3: bootstrap:owner script
  // --------------------------------------------------------------------------
  describe('bootstrapOwner script', () => {
    it('refuses to run if any tenant already exists in the database', async () => {
      // The fixture workspace exists
      const existing = await pool.query('SELECT COUNT(*)::int AS count FROM public.tenant');
      expect(existing.rows[0].count).toBeGreaterThan(0);

      await expect(
        bootstrapOwner({
          email: 'boot_fail@example.com',
          password: 'Password1234!',
          tenantName: 'Fail Workspace',
        })
      ).rejects.toThrow(/Bootstrap rejected: tenants already exist in database/i);
    });
  });

  // --------------------------------------------------------------------------
  // Item 2: DELETE /api/workspace/tenant teardown endpoint
  // --------------------------------------------------------------------------
  describe('Workspace Tenant Teardown (admin/owner endpoint)', () => {
    it('rejects teardown for non-owner roles (viewer, builder, admin)', async () => {
      const tempTenant = `teardown_perm_${crypto.randomBytes(3).toString('hex')}`;
      const tenantName = 'Perm Test Workspace';
      await defaultStorageAdapter.initTenant(tempTenant);
      await pool.query(
        `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tempTenant, tenantName]
      );

      const viewer = await createTestSession(tempTenant, 'viewer', 'td_viewer');
      const builder = await createTestSession(tempTenant, 'builder', 'td_builder');
      const admin = await createTestSession(tempTenant, 'admin', 'td_admin');

      for (const session of [viewer, builder, admin]) {
        const res = await server.inject({
          method: 'DELETE',
          url: '/api/workspace/tenant',
          headers: session.headers,
          payload: { confirmName: tenantName, password: 'TestPassword123!' },
        });
        expect(res.statusCode).toBe(403);
      }

      // Cleanup
      const sName = defaultStorageAdapter.getTenantSchemaName(tempTenant);
      await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE;`);
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [tempTenant]);
    });

    it('rejects teardown when confirmName does not match', async () => {
      const tempTenant = `teardown_name_${crypto.randomBytes(3).toString('hex')}`;
      const tenantName = 'Real Workspace Name';
      await defaultStorageAdapter.initTenant(tempTenant);
      await pool.query(
        `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tempTenant, tenantName]
      );

      const owner = await createTestSession(tempTenant, 'owner', 'td_owner_badname');

      const res = await server.inject({
        method: 'DELETE',
        url: '/api/workspace/tenant',
        headers: owner.headers,
        payload: { confirmName: 'Wrong Workspace Name', password: 'TestPassword123!' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toMatch(/Workspace name confirmation does not match/i);

      // Cleanup
      const sName = defaultStorageAdapter.getTenantSchemaName(tempTenant);
      await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE;`);
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [tempTenant]);
    });

    it('rejects teardown when password is incorrect', async () => {
      const tempTenant = `teardown_pw_${crypto.randomBytes(3).toString('hex')}`;
      const tenantName = 'Password Test Workspace';
      await defaultStorageAdapter.initTenant(tempTenant);
      await pool.query(
        `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tempTenant, tenantName]
      );

      const owner = await createTestSession(tempTenant, 'owner', 'td_owner_badpw');

      const res = await server.inject({
        method: 'DELETE',
        url: '/api/workspace/tenant',
        headers: owner.headers,
        payload: { confirmName: tenantName, password: 'WrongPassword999!' },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.message).toMatch(/Invalid password/i);

      // Cleanup
      const sName = defaultStorageAdapter.getTenantSchemaName(tempTenant);
      await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE;`);
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [tempTenant]);
    });

    it('allows owner to teardown tenant with correct confirmName and password', async () => {
      const tempTenant = `teardown_ok_${crypto.randomBytes(3).toString('hex')}`;
      const tenantName = 'Teardown Workspace';
      await defaultStorageAdapter.initTenant(tempTenant);
      await pool.query(
        `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tempTenant, tenantName]
      );

      const owner = await createTestSession(tempTenant, 'owner', 'td_owner_good');
      const schemaName = defaultStorageAdapter.getTenantSchemaName(tempTenant);

      // Verify schema exists prior to teardown
      const schemaBefore = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [schemaName]
      );
      expect(schemaBefore.rows.length).toBe(1);

      // Call teardown endpoint
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/workspace/tenant',
        headers: owner.headers,
        payload: { confirmName: tenantName, password: 'TestPassword123!' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      // Verify schema has been dropped
      const schemaAfter = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [schemaName]
      );
      expect(schemaAfter.rows.length).toBe(0);

      // Verify tenant has been removed from catalog
      const tenantCheck = await pool.query('SELECT id FROM public.tenant WHERE id = $1', [tempTenant]);
      expect(tenantCheck.rows.length).toBe(0);
    });

    it('enforces rate limiting on repeated DELETE /api/workspace/tenant attempts', async () => {
      const tempTenant = `teardown_rate_${crypto.randomBytes(3).toString('hex')}`;
      const tenantName = 'Rate Limit Workspace';
      await defaultStorageAdapter.initTenant(tempTenant);
      await pool.query(
        `INSERT INTO public.tenant (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tempTenant, tenantName]
      );

      const owner = await createTestSession(tempTenant, 'owner', 'td_owner_rate');

      // Send requests up to limit
      for (let i = 0; i < 10; i++) {
        await server.inject({
          method: 'DELETE',
          url: '/api/workspace/tenant',
          headers: owner.headers,
          payload: { confirmName: 'Wrong Name', password: 'TestPassword123!' },
        });
      }

      // 11th request should be rate-limited with 429
      const rateLimitedRes = await server.inject({
        method: 'DELETE',
        url: '/api/workspace/tenant',
        headers: owner.headers,
        payload: { confirmName: tenantName, password: 'TestPassword123!' },
      });

      expect(rateLimitedRes.statusCode).toBe(429);
      const body = JSON.parse(rateLimitedRes.body);
      expect(body.error).toBe('Too Many Requests');

      // Cleanup
      const sName = defaultStorageAdapter.getTenantSchemaName(tempTenant);
      await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE;`);
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [tempTenant]);
    });
  });

  // --------------------------------------------------------------------------
  // Item 4: Database Cleanliness & Demo Warning
  // --------------------------------------------------------------------------
  describe('checkDbClean & Demo Account Warning', () => {
    it('detects flagged demo accounts or default tenants in checkDbClean', async () => {
      const report = await checkDbClean();
      expect(report.tenantCount).toBeGreaterThan(0);
      expect(report.userCount).toBeGreaterThan(0);

      // If test database has default or admin@example.com, report flags it
      const hasDemoAccount = report.users.some((u) => u.email === 'admin@example.com');
      if (hasDemoAccount) {
        expect(report.clean).toBe(false);
        expect(report.flags.some((f) => f.includes('admin@example.com'))).toBe(true);
      }
    });

    it('checkDemoAccountWarning logs a warning in production mode when demo account exists', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        let loggedWarning = '';
        const mockLogger = {
          warn: (msg: string) => {
            loggedWarning = msg;
          },
        };

        const result = await checkDemoAccountWarning(mockLogger);
        if (result) {
          expect(loggedWarning).toMatch(/admin@example\.com detected in production database/i);
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
