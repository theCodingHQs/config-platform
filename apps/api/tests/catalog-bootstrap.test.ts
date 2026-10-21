import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/auth-service.js';
import { buildServer } from '../src/server.js';
import { pool, directPool, assertDestructiveTestDbResetAllowed, DEFAULT_TEST_DATABASE_URL } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { bootstrapOwner } from '../src/scripts/bootstrap-owner.js';
import type { FastifyInstance } from 'fastify';

describe('Catalog Auto-Init & Bootstrap Protection Tests', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Ensure safety guard verifies test database before destructive reset
    const testDbUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
    assertDestructiveTestDbResetAllowed(testDbUrl);

    // Completely reset the public schema to ensure an empty database state
    await directPool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // =========================================================================
  // 5(a): Start server against completely empty database, assert catalog tables & /health/ready 200
  // =========================================================================
  describe('5(a): Automatic Catalog Setup on Server Startup', () => {
    it('initializes all catalog tables on start against an empty database and /health/ready returns 200', async () => {
      // 1. Initialize metadata catalog as backend startup does
      await initializeMetadataCatalog(pool);

      // 2. Query information_schema to assert every required catalog table exists
      const tablesRes = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      const tableNames = tablesRes.rows.map((r) => r.table_name);

      // schema_migrations records applied catalog migrations; invites live in invite_token
      const requiredTables = [
        'schema_migrations',
        'app_session',
        'app_user',
        'audit_log',
        'entity_def',
        'entity_permission',
        'export_template',
        'field_def',
        'field_permission',
        'invite_token',
        'page_def',
        'page_nav_folder',
        'tenant',
        'tenant_member',
      ];

      for (const table of requiredTables) {
        expect(tableNames).toContain(table);
      }

      // 3. Build and ready the server
      server = await buildServer();
      await server.ready();

      // 4. Assert /health/ready returns 200
      const healthRes = await server.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toEqual({ status: 'ready' });
    });
  });

  // =========================================================================
  // 5(b): Run bootstrap:owner with env vars on that DB, then log in as owner through API
  // =========================================================================
  describe('5(b): Bootstrap Owner & API Login', () => {
    it('runs bootstrap:owner with env vars and logs in as created owner via /api/auth/login', async () => {
      const ownerEmail = `owner_${Date.now()}@production-workspace.com`;
      const ownerPassword = 'ProductionPassword123!';
      const tenantName = 'Primary Production Workspace';

      const prevEmail = process.env.BOOTSTRAP_EMAIL;
      const prevPass = process.env.BOOTSTRAP_PASSWORD;
      const prevTenant = process.env.BOOTSTRAP_TENANT_NAME;

      try {
        process.env.BOOTSTRAP_EMAIL = ownerEmail;
        process.env.BOOTSTRAP_PASSWORD = ownerPassword;
        process.env.BOOTSTRAP_TENANT_NAME = tenantName;

        // Execute bootstrapOwner
        const bootstrapResult = await bootstrapOwner();
        expect(bootstrapResult.userId).toBeDefined();
        expect(bootstrapResult.tenantId).toBeDefined();
        expect(bootstrapResult.email).toBe(ownerEmail);
        expect(bootstrapResult.tenantName).toBe(tenantName);

        // Verify database records
        const tenantQuery = await pool.query('SELECT name FROM public.tenant WHERE id = $1', [
          bootstrapResult.tenantId,
        ]);
        expect(tenantQuery.rows[0].name).toBe(tenantName);

        const memberQuery = await pool.query(
          'SELECT role FROM public.tenant_member WHERE user_id = $1 AND tenant_id = $2',
          [bootstrapResult.userId, bootstrapResult.tenantId]
        );
        expect(memberQuery.rows[0].role).toBe('owner');

        // Fetch CSRF token for API login
        const csrfRes = await server.inject({
          method: 'GET',
          url: '/api/auth/csrf',
        });
        expect(csrfRes.statusCode).toBe(200);
        const { csrfToken } = csrfRes.json();
        const csrfCookie = csrfRes.cookies.find((c) => c.name === 'csrf_token');

        // Perform login through API: POST /api/auth/login
        const loginRes = await server.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
            cookie: `csrf_token=${csrfCookie?.value || csrfToken}`,
          },
          payload: {
            email: ownerEmail,
            password: ownerPassword,
          },
        });

        expect(loginRes.statusCode).toBe(200);
        const loginData = loginRes.json();
        expect(loginData.email).toBe(ownerEmail);
        expect(loginData.role).toBe('owner');
        expect(loginData.tenantId).toBe(bootstrapResult.tenantId);
        expect(loginData.tenantName).toBe(tenantName);

        // Verify authenticated session allows accessing /api/auth/me
        const sessionCookie = loginRes.cookies.find((c) => c.name === SESSION_COOKIE);
        expect(sessionCookie).toBeDefined();

        const meRes = await server.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: {
            cookie: `${SESSION_COOKIE}=${sessionCookie?.value}`,
          },
        });

        expect(meRes.statusCode).toBe(200);
        const meData = meRes.json();
        expect(meData.email).toBe(ownerEmail);
        expect(meData.role).toBe('owner');
        expect(meData.tenantId).toBe(bootstrapResult.tenantId);
        expect(meData.tenantName).toBe(tenantName);
      } finally {
        process.env.BOOTSTRAP_EMAIL = prevEmail;
        process.env.BOOTSTRAP_PASSWORD = prevPass;
        process.env.BOOTSTRAP_TENANT_NAME = prevTenant;
      }
    });
  });
});
