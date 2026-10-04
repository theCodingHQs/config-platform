import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { authService, hashToken, validatePassword } from '../src/auth/auth-service.js';
import { defaultEmailVerifier } from '../src/auth/email-verifier.js';
import { MemoryRateLimiter, createRateLimitHook } from '../src/auth/rate-limiter.js';
import { editorDeleteMigrationReport } from '../src/db/catalog-migration-runner.js';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Part A: Auth Fixes & Tests', () => {
  let server: FastifyInstance;

  const tenantA = `part_a_${crypto.randomBytes(3).toString('hex')}`;
  const tenantB = `part_b_${crypto.randomBytes(3).toString('hex')}`;

  let ownerA: TestSession;
  let adminA: TestSession;
  let builderA: TestSession;
  let editorA: TestSession;
  let viewerA: TestSession;
  let ownerB: TestSession;

  let entityIdA: string;
  let entityIdB: string;
  let fieldIdA: string;
  let pageIdA: string;
  let pageIdB: string;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    // Provision tenants
    await migrationService.provisionTenant(tenantA, 'Tenant Alpha');
    await migrationService.provisionTenant(tenantB, 'Tenant Beta');

    ownerA = await createTestSession(tenantA, 'owner', 'owner_a');
    adminA = await createTestSession(tenantA, 'admin', 'admin_a');
    builderA = await createTestSession(tenantA, 'builder', 'builder_a');
    editorA = await createTestSession(tenantA, 'editor', 'editor_a');
    viewerA = await createTestSession(tenantA, 'viewer', 'viewer_a');
    ownerB = await createTestSession(tenantB, 'owner', 'owner_b');

    // Create entity in Tenant A
    const entResA = await migrationService.createEntity(tenantA, {
      name: 'product',
      label: 'Product',
      fields: [
        { name: 'sku', label: 'SKU', type: 'text', required: true, unique: false, config: {} },
        { name: 'price', label: 'Price', type: 'number', required: false, unique: false, config: {} },
      ],
    });
    entityIdA = entResA.entityId;
    fieldIdA = entResA.fields.find((f: any) => f.name === 'sku')!.id;

    // Create entity in Tenant B
    const entResB = await migrationService.createEntity(tenantB, {
      name: 'invoice',
      label: 'Invoice',
      fields: [
        { name: 'inv_num', label: 'Invoice Number', type: 'text', required: true, unique: false, config: {} },
      ],
    });
    entityIdB = entResB.entityId;

    // Create page in Tenant A
    const pageResA = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: builderA.headers,
      payload: { name: 'Alpha Page', route: '/alpha-page' },
    });
    pageIdA = pageResA.json().id;

    // Create page in Tenant B
    const pageResB = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: ownerB.headers,
      payload: { name: 'Beta Page', route: '/beta-page' },
    });
    pageIdB = pageResB.json().id;
  }, 60000);

  afterAll(async () => {
    if (ownerA?.userId) await cleanupTestUser(ownerA.userId);
    if (adminA?.userId) await cleanupTestUser(adminA.userId);
    if (builderA?.userId) await cleanupTestUser(builderA.userId);
    if (editorA?.userId) await cleanupTestUser(editorA.userId);
    if (viewerA?.userId) await cleanupTestUser(viewerA.userId);
    if (ownerB?.userId) await cleanupTestUser(ownerB.userId);
    if (server) await server.close();
  });

  // =========================================================================
  // 1. Demo credentials, seed account and "Fill Demo" button in production build
  // =========================================================================
  describe('A.1: No Demo Content Shipped', () => {
    it('confirms seed.ts does not exist and no demo files are shipped', () => {
      const seedFile = path.resolve(__dirname, '../src/seed.ts');
      expect(fs.existsSync(seedFile)).toBe(false);
    });

    it('verifies production build of @config-platform/web contains neither demo credentials nor Fill Demo button', () => {
      const distDir = path.resolve(__dirname, '../../web/dist/assets');
      expect(fs.existsSync(distDir)).toBe(true);

      const files = fs.readdirSync(distDir);
      const jsFiles = files.filter((f) => f.endsWith('.js'));
      expect(jsFiles.length).toBeGreaterThan(0);

      for (const jsFile of jsFiles) {
        const content = fs.readFileSync(path.join(distDir, jsFile), 'utf8');
        expect(content).not.toContain('Fill Demo Admin Credentials');
        expect(content).not.toContain('admin@example.com');
      }
    });
  });

  // =========================================================================
  // 2. Cross-tenant write routes all return 404 or 403 and change nothing
  // =========================================================================
  describe('A.2: Cross-Tenant Write Isolation', () => {
    it('POST /entities/:id/records on a foreign entity returns 404 and inserts nothing', async () => {
      // Tenant A editor tries to create a record in Tenant B's entity
      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/${entityIdB}/records`,
        headers: editorA.headers,
        payload: { inv_num: 'HACK-123' },
      });
      expect(res.statusCode).toBe(404);

      // Verify no records inserted in Tenant B
      const checkB = await server.inject({
        method: 'GET',
        url: `/api/entities/${entityIdB}/records`,
        headers: ownerB.headers,
      });
      expect(checkB.json().data).toHaveLength(0);
    });

    it('PUT /schema/entities/:id on a foreign entity returns 404 and changes nothing', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/schema/entities/${entityIdB}`,
        headers: builderA.headers,
        payload: { label: 'Hacked Label', expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(404);

      // Verify label in Tenant B unchanged
      const check = await pool.query('SELECT label FROM public.entity_def WHERE id = $1', [entityIdB]);
      expect(check.rows[0].label).toBe('Invoice');
    });

    it('DELETE /schema/entities/:id on a foreign entity returns 404 and drops nothing', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/schema/entities/${entityIdB}?expectedVersion=1`,
        headers: builderA.headers,
      });
      expect(res.statusCode).toBe(404);

      const check = await pool.query('SELECT id FROM public.entity_def WHERE id = $1', [entityIdB]);
      expect(check.rows.length).toBe(1);
    });

    it('POST /schema/entities/:id/fields on a foreign entity returns 404 and creates nothing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/schema/entities/${entityIdB}/fields`,
        headers: builderA.headers,
        payload: {
          name: 'hacked_field',
          label: 'Hacked Field',
          type: 'text',
          expectedVersion: 1,
        },
      });
      expect(res.statusCode).toBe(404);

      const check = await pool.query(
        'SELECT id FROM public.field_def WHERE entity_id = $1 AND name = $2',
        [entityIdB, 'hacked_field']
      );
      expect(check.rows.length).toBe(0);
    });

    it('PUT /schema/entities/:id/fields/reorder on a foreign entity returns 404', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/schema/entities/${entityIdB}/fields/reorder`,
        headers: builderA.headers,
        payload: { fieldIds: ['f_invalid'] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PUT /schema/entities/:entityId/permissions/:role on a foreign entity returns 404', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/schema/entities/${entityIdB}/permissions/editor`,
        headers: adminA.headers,
        payload: { canRead: false, canCreate: false, canUpdate: false, canDelete: false },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PUT/DELETE/publish on foreign pages all return 404', async () => {
      // PUT foreign page
      const putRes = await server.inject({
        method: 'PUT',
        url: `/api/pages/${pageIdB}`,
        headers: builderA.headers,
        payload: { name: 'Defaced Beta Page' },
      });
      expect(putRes.statusCode).toBe(404);

      // Publish foreign page
      const pubRes = await server.inject({
        method: 'POST',
        url: `/api/pages/${pageIdB}/publish`,
        headers: builderA.headers,
      });
      expect(pubRes.statusCode).toBe(404);

      // DELETE foreign page
      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/pages/${pageIdB}`,
        headers: builderA.headers,
      });
      expect(delRes.statusCode).toBe(404);

      // Verify page in Tenant B still exists with original name
      const pageCheck = await pool.query('SELECT name FROM public.page_def WHERE id = $1', [pageIdB]);
      expect(pageCheck.rows[0].name).toBe('Beta Page');
    });

    it('PATCH/DELETE /members with a foreign user ID returns 404 and changes nothing', async () => {
      // Try to change role of user in Tenant B from Tenant A admin
      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/members/${ownerB.userId}/role`,
        headers: adminA.headers,
        payload: { role: 'viewer' },
      });
      expect(patchRes.statusCode).toBe(404);

      // Verify role in Tenant B is unchanged
      const checkRole = await pool.query(
        'SELECT role FROM public.tenant_member WHERE tenant_id = $1 AND user_id = $2',
        [tenantB, ownerB.userId]
      );
      expect(checkRole.rows[0].role).toBe('owner');

      // Try to delete member in Tenant B from Tenant A admin
      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/members/${ownerB.userId}`,
        headers: adminA.headers,
      });
      expect(delRes.statusCode).toBe(404);

      // Verify member not removed
      const checkMem = await pool.query(
        'SELECT role FROM public.tenant_member WHERE tenant_id = $1 AND user_id = $2',
        [tenantB, ownerB.userId]
      );
      expect(checkMem.rows.length).toBe(1);
    });

    it('POST /auth/invite ignores foreign tenant in body and creates invite in caller tenant', async () => {
      await pool.query("UPDATE public.tenant SET plan = 'pro' WHERE id = $1", [tenantA]);
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/invite',
        headers: adminA.headers,
        payload: {
          email: 'target@example.com',
          role: 'editor',
          tenantId: tenantB, // Trying to pass Tenant B
        },
      });
      expect(res.statusCode).toBe(201);

      // Tenant B has no invite created
      const checkB = await pool.query('SELECT * FROM public.invite_token WHERE tenant_id = $1', [tenantB]);
      expect(checkB.rows.length).toBe(0);
      // Tenant A has the invite
      const checkA = await pool.query('SELECT * FROM public.invite_token WHERE tenant_id = $1 AND invitee_email = $2', [tenantA, 'target@example.com']);
      expect(checkA.rows.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. Rate limiting: separate limits per IP and per email
  // =========================================================================
  describe('A.3: Separate Rate Limiting per IP and per Email', () => {
    it('enforces rate limits independently for IP and email', async () => {
      const limiter = new MemoryRateLimiter();

      // IP limit: 3, Email limit: 3
      const ip = '192.168.1.50';
      const emailA = 'alice@example.com';
      const emailB = 'bob@example.com';
      const otherIp = '10.0.0.1';

      // Exhaust IP limit using emailA
      expect((await limiter.consume(`ip:${ip}`, 3, 60000)).allowed).toBe(true); // 1
      expect((await limiter.consume(`ip:${ip}`, 3, 60000)).allowed).toBe(true); // 2
      expect((await limiter.consume(`ip:${ip}`, 3, 60000)).allowed).toBe(true); // 3
      expect((await limiter.consume(`ip:${ip}`, 3, 60000)).allowed).toBe(false); // 4th blocked by IP

      // A different IP using the same emailA should NOT be blocked by IP
      // but emailA has only 0 consumes under email:alice@example.com so far
      expect((await limiter.consume(`ip:${otherIp}`, 3, 60000)).allowed).toBe(true);

      // Now exhaust email limit for emailB
      expect((await limiter.consume(`email:${emailB}`, 2, 60000)).allowed).toBe(true); // 1
      expect((await limiter.consume(`email:${emailB}`, 2, 60000)).allowed).toBe(true); // 2
      expect((await limiter.consume(`email:${emailB}`, 2, 60000)).allowed).toBe(false); // 3rd blocked by Email

      // A different email on otherIp still passes
      expect((await limiter.consume(`email:charlie@example.com`, 2, 60000)).allowed).toBe(true);
    });
  });

  // =========================================================================
  // 4. Multi-workspace users & workspace switcher
  // =========================================================================
  describe('A.4: Multi-Workspace Users & Session Switching', () => {
    it('supports user belonging to multiple tenants, logs into last used, and switches workspace', async () => {
      // Create user belonging to Tenant A and Tenant B
      const multiEmail = `multi_${crypto.randomBytes(4).toString('hex')}@example.com`;
      const pass = 'supersecurepass123!';
      const argon2 = await import('argon2');
      const hash = await argon2.hash(pass);
      const multiUserId = `u_multi_${crypto.randomBytes(4).toString('hex')}`;

      await pool.query(
        `INSERT INTO public.app_user (id, email, password_hash, last_tenant_id, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())`,
        [multiUserId, multiEmail, hash, tenantA]
      );

      // Add to Tenant A as editor
      await pool.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, 'editor', NOW())`,
        [multiUserId, tenantA]
      );

      // Add to Tenant B as builder
      await pool.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, 'builder', NOW())`,
        [multiUserId, tenantB]
      );

      // Login lands in last used tenant (Tenant A)
      const sessionA = await authService.login(multiEmail, pass);
      expect(sessionA.tenantId).toBe(tenantA);
      expect(sessionA.role).toBe('editor');

      // Check workspaces list
      const workspaces = await authService.getUserWorkspaces(multiUserId, tenantA);
      expect(workspaces).toHaveLength(2);
      expect(workspaces.find((w) => w.tenantId === tenantA)?.isCurrent).toBe(true);
      expect(workspaces.find((w) => w.tenantId === tenantB)?.isCurrent).toBe(false);

      // Test that session A cannot act on Tenant B
      const headersA = {
        cookie: `sid=${sessionA.sessionId}; csrf_token=csrf123`,
        'x-csrf-token': 'csrf123',
      };
      const foreignAct = await server.inject({
        method: 'POST',
        url: `/api/entities/${entityIdB}/records`,
        headers: headersA,
        payload: { inv_num: 'INVALID' },
      });
      expect(foreignAct.statusCode).toBe(404);

      // Switch to Tenant B
      const sessionB = await authService.switchWorkspace(sessionA.sessionId, multiUserId, tenantB);
      expect(sessionB.tenantId).toBe(tenantB);
      expect(sessionB.role).toBe('builder');

      // Old session A is now invalidated
      const oldSessionCheck = await authService.resolveSession(sessionA.sessionId);
      expect(oldSessionCheck).toBeNull();

      // Subsequent login now lands in Tenant B as last used!
      const reLogin = await authService.login(multiEmail, pass);
      expect(reLogin.tenantId).toBe(tenantB);

      // Cleanup
      await cleanupTestUser(multiUserId);
    });
  });

  // =========================================================================
  // 5. Migration 002: reset editor delete permissions
  // =========================================================================
  describe('A.5: Reset Editor Delete Permissions Migration Report', () => {
    it('executes migration 002 and reports rows changed', async () => {
      expect(editorDeleteMigrationReport).toBeDefined();
      expect(typeof editorDeleteMigrationReport.rowsChanged).toBe('number');
      expect(editorDeleteMigrationReport.executedAt).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Password rules & Email verification
  // =========================================================================
  describe('A.6: Password Rules & Email Verification', () => {
    it('enforces minimum 10 characters and common-password blacklist', () => {
      // < 10 characters
      expect(() => validatePassword('short')).toThrow('Password must be at least 10 characters long');
      expect(() => validatePassword('123456789')).toThrow('Password must be at least 10 characters long');

      // Blacklist common passwords
      expect(() => validatePassword('1234567890')).toThrow('Password is too common and easily guessable');
      expect(() => validatePassword('password123')).toThrow('Password is too common and easily guessable');
      expect(() => validatePassword('admin12345')).toThrow('Password is too common and easily guessable');

      // Valid strong password passes
      expect(() => validatePassword('validSecurePassword2026!')).not.toThrow();
    });

    it('triggers email verification on signup and allows verification via token', async () => {
      const email = `verify_${crypto.randomBytes(4).toString('hex')}@example.com`;
      const pass = 'extremelySecurePass2026!';

      const session = await authService.signup(email, pass, 'Verification Tenant');
      expect(session.email).toBe(email);

      // Verify emailVerifier captured verification token
      expect(defaultEmailVerifier.lastSentEmail).not.toBeNull();
      expect(defaultEmailVerifier.lastSentEmail?.email).toBe(email);
      const token = defaultEmailVerifier.lastSentEmail!.token;

      // App user initially has email_verified = false
      const userRes1 = await pool.query('SELECT email_verified FROM public.app_user WHERE id = $1', [session.userId]);
      expect(userRes1.rows[0].email_verified).toBe(false);

      // Verify email via endpoint
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // App user now has email_verified = true
      const userRes2 = await pool.query('SELECT email_verified FROM public.app_user WHERE id = $1', [session.userId]);
      expect(userRes2.rows[0].email_verified).toBe(true);

      // Cleanup
      await cleanupTestUser(session.userId);
    });
  });
});
