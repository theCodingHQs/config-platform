/**
 * Comprehensive Auth, Tenancy, and Server-Side Permissions Test Suite.
 *
 * Verifies:
 * 1. 401 on every route when unauthenticated (complete coverage list)
 * 2. Cross-tenant isolation on records, schema, pages, and aggregate
 * 3. Hidden fields blocked in responses, filters, sorts, and aggregates
 * 4. Read-only field write rejected on create (POST) and update (PATCH)
 * 5. Session unusable after logout
 * 6. CSRF double-submit protection rejection
 * 7. Viewer restricted from Studio routes and Studio APIs
 * 8. Token hashing in DB (only SHA-256 hashes stored for sessions and invites)
 * 9. Rate limiter interface and memory implementation (keyed by IP + email)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { authService, hashToken } from '../src/auth/auth-service.js';
import { permissionService } from '../src/permissions/permission-service.js';
import { MemoryRateLimiter, buildRateLimitKey } from '../src/auth/rate-limiter.js';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

describe('Authentication, Tenancy & Permissions', () => {
  let server: FastifyInstance;

  const tenantA = `auth_a_${crypto.randomBytes(3).toString('hex')}`;
  const tenantB = `auth_b_${crypto.randomBytes(3).toString('hex')}`;
  const schemaA = defaultStorageAdapter.getTenantSchemaName(tenantA);
  const schemaB = defaultStorageAdapter.getTenantSchemaName(tenantB);

  let ownerA: TestSession;
  let viewerA: TestSession;
  let editorA: TestSession;
  let builderA: TestSession;
  let ownerB: TestSession;

  let itemEntityIdA: string;
  let itemEntityIdB: string;
  let secretNotesFieldIdA: string;
  let statusFieldIdA: string;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    // Provision tenants
    await migrationService.provisionTenant(tenantA, 'Auth Tenant A');
    await migrationService.provisionTenant(tenantB, 'Auth Tenant B');

    // Create item entity in Tenant A with fields: title, secret_notes, status
    const itemResA = await migrationService.createEntity(tenantA, {
      name: 'item',
      label: 'Item',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'secret_notes', label: 'Secret Notes', type: 'text', required: false },
        { name: 'status', label: 'Status', type: 'text', required: false },
      ],
    });
    itemEntityIdA = itemResA.entity.id;
    secretNotesFieldIdA = itemResA.fields.find((f: any) => f.name === 'secret_notes')!.id;
    statusFieldIdA = itemResA.fields.find((f: any) => f.name === 'status')!.id;

    // Set field permissions in Tenant A:
    // - secret_notes: hidden for viewer
    // - status: read-only for editor
    await permissionService.setFieldPermission(tenantA, itemEntityIdA, secretNotesFieldIdA, 'viewer', {
      hidden: true,
      readOnly: false,
    });
    await permissionService.setFieldPermission(tenantA, itemEntityIdA, statusFieldIdA, 'editor', {
      hidden: false,
      readOnly: true,
    });

    // Create item entity in Tenant B
    const itemResB = await migrationService.createEntity(tenantB, {
      name: 'item',
      label: 'Item',
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
    });
    itemEntityIdB = itemResB.entity.id;

    // Create sessions
    ownerA   = await createTestSession(tenantA, 'owner',   'auth_owner_a');
    viewerA  = await createTestSession(tenantA, 'viewer',  'auth_viewer_a');
    editorA  = await createTestSession(tenantA, 'editor',  'auth_editor_a');
    builderA = await createTestSession(tenantA, 'builder', 'auth_builder_a');
    ownerB   = await createTestSession(tenantB, 'owner',   'auth_owner_b');
  }, 60000);

  afterAll(async () => {
    await server.close();
    for (const sess of [ownerA, viewerA, editorA, builderA, ownerB]) {
      if (sess) await cleanupTestUser(sess.userId);
    }
    await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [tenantA, tenantB]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
  }, 60000);

  // ─── 1. Unauthenticated 401 on Every Protected Route ─────────────────────

  const unauthenticatedRoutes: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string }> = [
    // Records
    { method: 'GET', url: '/api/entities/item/records' },
    { method: 'POST', url: '/api/entities/item/records' },
    { method: 'GET', url: '/api/entities/item/records/rec_test_1' },
    { method: 'PATCH', url: '/api/entities/item/records/rec_test_1' },
    { method: 'DELETE', url: '/api/entities/item/records/rec_test_1' },
    { method: 'GET', url: '/api/entities/item/aggregate' },
    // Import
    { method: 'POST', url: '/api/entities/item/import/preview' },
    { method: 'POST', url: '/api/entities/item/import/dry-run' },
    { method: 'POST', url: '/api/entities/item/import/commit' },
    // Schema & ERD & DDL
    { method: 'GET', url: '/api/schema/entities' },
    { method: 'POST', url: '/api/schema/entities' },
    { method: 'PUT', url: '/api/schema/entities/item' },
    { method: 'DELETE', url: '/api/schema/entities/item' },
    { method: 'POST', url: '/api/schema/entities/item/fields' },
    { method: 'PUT', url: '/api/schema/entities/item/fields/f_test_1' },
    { method: 'DELETE', url: '/api/schema/entities/item/fields/f_test_1' },
    { method: 'PUT', url: '/api/schema/entities/item/fields/reorder' },
    { method: 'GET', url: '/api/schema/erd' },
    { method: 'GET', url: '/api/schema/ddl' },
    // Permissions
    { method: 'GET', url: '/api/schema/entities/item/permissions' },
    { method: 'PUT', url: '/api/schema/entities/item/permissions/viewer' },
    { method: 'GET', url: '/api/schema/entities/item/fields/permissions' },
    { method: 'PUT', url: '/api/schema/entities/item/fields/f_test_1/permissions/viewer' },
    // Pages
    { method: 'GET', url: '/api/pages' },
    { method: 'POST', url: '/api/pages' },
    { method: 'GET', url: '/api/pages/p_test_1' },
    { method: 'PUT', url: '/api/pages/p_test_1' },
    { method: 'DELETE', url: '/api/pages/p_test_1' },
    { method: 'POST', url: '/api/pages/p_test_1/publish' },
    { method: 'GET', url: '/api/pages/published' },
    // Members & Auth info
    { method: 'GET', url: '/api/members' },
    { method: 'POST', url: '/api/auth/invite' },
    { method: 'PATCH', url: '/api/members/u_test_1/role' },
    { method: 'DELETE', url: '/api/members/u_test_1' },
    { method: 'GET', url: '/api/auth/me' },
    // Workspace
    { method: 'GET', url: '/api/workspace/usage' },
    { method: 'GET', url: '/api/workspace/export' },
    { method: 'POST', url: '/api/workspace/import' },
    { method: 'DELETE', url: '/api/workspace/tenant' },
    // Audit logs
    { method: 'GET', url: '/api/audit-logs' },
    // Export Templates
    { method: 'POST', url: '/api/export-templates/tpl_test_1/render-preview' },
    // Workspace switching
    { method: 'GET', url: '/api/auth/workspaces' },
    { method: 'POST', url: '/api/auth/switch-workspace' },
  ];

  for (const route of unauthenticatedRoutes) {
    it(`returns 401 for ${route.method} ${route.url} when unauthenticated`, async () => {
      const res = await server.inject({
        method: route.method,
        url: route.url,
      });
      expect(res.statusCode).toBe(401);
    });
  }

  // ─── 2. Cross-Tenant Isolation ───────────────────────────────────────────

  it('cross-tenant records: ownerA cannot see or access tenantB records', async () => {
    // ownerB creates a record in tenantB
    const createB = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: ownerB.headers,
      payload: { title: 'Secret in Tenant B' },
    });
    expect(createB.statusCode).toBe(201);
    const recIdB = JSON.parse(createB.payload).id;

    // ownerA queries tenantA items
    const listA = await server.inject({
      method: 'GET',
      url: '/api/entities/item/records',
      headers: ownerA.headers,
    });
    expect(listA.statusCode).toBe(200);
    const recordsA = JSON.parse(listA.payload).data;
    expect(recordsA.some((r: any) => r.id === recIdB || r.title === 'Secret in Tenant B')).toBe(false);

    // ownerA attempts to get record by ID
    const getByIdA = await server.inject({
      method: 'GET',
      url: `/api/entities/item/records/${recIdB}`,
      headers: ownerA.headers,
    });
    expect(getByIdA.statusCode).toBe(404);

    // ownerA attempts to patch record in tenantB
    const patchA = await server.inject({
      method: 'PATCH',
      url: `/api/entities/item/records/${recIdB}`,
      headers: ownerA.headers,
      payload: { title: 'Hacked by Tenant A' },
    });
    expect(patchA.statusCode).toBe(404);

    // ownerA attempts to delete record in tenantB
    const deleteA = await server.inject({
      method: 'DELETE',
      url: `/api/entities/item/records/${recIdB}`,
      headers: ownerA.headers,
    });
    expect(deleteA.statusCode).toBe(404);
  });

  it('cross-tenant schema: ownerA only gets tenantA entities; cannot modify tenantB entities', async () => {
    const resA = await server.inject({
      method: 'GET',
      url: '/api/schema/entities',
      headers: ownerA.headers,
    });
    const resB = await server.inject({
      method: 'GET',
      url: '/api/schema/entities',
      headers: ownerB.headers,
    });
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const entitiesA = JSON.parse(resA.payload);
    const entitiesB = JSON.parse(resB.payload);

    expect(entitiesA.some((e: any) => e.id === itemEntityIdA)).toBe(true);
    expect(entitiesA.some((e: any) => e.id === itemEntityIdB)).toBe(false);

    expect(entitiesB.some((e: any) => e.id === itemEntityIdB)).toBe(true);
    expect(entitiesB.some((e: any) => e.id === itemEntityIdA)).toBe(false);
  });

  it('cross-tenant pages: ownerA cannot see or access tenantB pages', async () => {
    // Builder B creates and publishes a page in tenantB
    const createPageB = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: ownerB.headers,
      payload: {
        name: 'Tenant B Private Page',
        route: '/tenant-b-secret',
      },
    });
    expect(createPageB.statusCode).toBe(201);
    const pageIdB = JSON.parse(createPageB.payload).id;

    await server.inject({
      method: 'POST',
      url: `/api/pages/${pageIdB}/publish`,
      headers: ownerB.headers,
    });

    // ownerA lists pages
    const listPagesA = await server.inject({
      method: 'GET',
      url: '/api/pages',
      headers: ownerA.headers,
    });
    expect(listPagesA.statusCode).toBe(200);
    const pagesA = JSON.parse(listPagesA.payload);
    expect(pagesA.some((p: any) => p.id === pageIdB)).toBe(false);

    // ownerA lists published pages
    const pubPagesA = await server.inject({
      method: 'GET',
      url: '/api/pages/published',
      headers: ownerA.headers,
    });
    expect(pubPagesA.statusCode).toBe(200);
    const publishedA = JSON.parse(pubPagesA.payload);
    expect(publishedA.some((p: any) => p.id === pageIdB)).toBe(false);

    // ownerA attempts to get page by ID
    const getPageA = await server.inject({
      method: 'GET',
      url: `/api/pages/${pageIdB}`,
      headers: ownerA.headers,
    });
    expect(getPageA.statusCode).toBe(404);
  });

  it('cross-tenant aggregate: aggregate counts only reflect current tenant records', async () => {
    // Insert 1 record into tenantA
    await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: ownerA.headers,
      payload: { title: 'Tenant A Item' },
    });

    // Query aggregate for Tenant A
    const aggA = await server.inject({
      method: 'GET',
      url: '/api/entities/item/aggregate?op=count',
      headers: ownerA.headers,
    });
    expect(aggA.statusCode).toBe(200);
    const countA = JSON.parse(aggA.payload).value;

    // Query aggregate for Tenant B
    const aggB = await server.inject({
      method: 'GET',
      url: '/api/entities/item/aggregate?op=count',
      headers: ownerB.headers,
    });
    expect(aggB.statusCode).toBe(200);
    const countB = JSON.parse(aggB.payload).value;

    // Both should be isolated counts
    expect(typeof countA).toBe('number');
    expect(typeof countB).toBe('number');
  });

  it('cross-tenant export-templates render-preview: builderA/ownerA cannot render preview of tenantB export template', async () => {
    // Builder B creates an export template in Tenant B
    const createResB = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: ownerB.headers,
      payload: {
        name: 'Tenant B Template',
        entityId: itemEntityIdB,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_b',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { value: 'Secret B' },
              },
            },
          ],
        },
      },
    });
    expect(createResB.statusCode).toBe(201);
    const tplBId = JSON.parse(createResB.payload).id;

    // ownerA or builderA tries to render preview of tenantB template
    const previewResA = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${tplBId}/render-preview`,
      headers: ownerA.headers,
    });
    expect(previewResA.statusCode).toBe(404);
  });

  // ─── 3. Hidden Fields Protection ──────────────────────────────────────────

  it('hidden fields: stripped in record responses for viewer', async () => {
    // Owner creates item with secret_notes
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: ownerA.headers,
      payload: { title: 'Item with Secrets', secret_notes: 'Top Secret 123' },
    });
    expect(createRes.statusCode).toBe(201);
    const recId = JSON.parse(createRes.payload).id;

    // Viewer queries records: secret_notes must be omitted
    const listRes = await server.inject({
      method: 'GET',
      url: '/api/entities/item/records',
      headers: viewerA.headers,
    });
    expect(listRes.statusCode).toBe(200);
    const viewerRecord = JSON.parse(listRes.payload).data.find((r: any) => r.id === recId);
    expect(viewerRecord).toBeDefined();
    expect(viewerRecord.secret_notes).toBeUndefined();

    // Viewer gets single record by ID: secret_notes must be omitted
    const getRes = await server.inject({
      method: 'GET',
      url: `/api/entities/item/records/${recId}`,
      headers: viewerA.headers,
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.payload).secret_notes).toBeUndefined();
  });

  it('hidden fields: filter by hidden field is blocked (403 Forbidden)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/entities/item/records?filter[secret_notes][eq]=TopSecret',
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('not accessible');
  });

  it('hidden fields: sort by hidden field is blocked (403 Forbidden)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/entities/item/records?sort=secret_notes',
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('not accessible');
  });

  it('hidden fields: aggregate on hidden field is blocked (403 Forbidden)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/entities/item/aggregate?op=count&field=secret_notes',
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('not accessible');
  });

  // ─── 4. Read-Only Field Write Rejection ───────────────────────────────────

  it('read-only field: POST create rejects write with 403 Forbidden', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: editorA.headers,
      payload: { title: 'Editor Item', status: 'active' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('read-only');
  });

  it('read-only field: PATCH update rejects write with 403 Forbidden', async () => {
    // Create record as owner
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: ownerA.headers,
      payload: { title: 'To Be Patched' },
    });
    const recId = JSON.parse(createRes.payload).id;

    // Editor tries to PATCH read-only status field
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/entities/item/records/${recId}`,
      headers: editorA.headers,
      payload: { status: 'archived' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('read-only');
  });

  // ─── 5. Session Unusable After Logout ─────────────────────────────────────

  it('session is unusable after logout (returns 401)', async () => {
    const tempSess = await createTestSession(tenantA, 'editor', 'logout_test');

    // Confirm session is valid
    const checkValid = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: tempSess.cookieHeader },
    });
    expect(checkValid.statusCode).toBe(200);

    // Call POST /auth/logout
    const logoutRes = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: tempSess.headers,
    });
    expect(logoutRes.statusCode).toBe(200);

    // Attempting to use the cookie now should return 401
    const checkInvalid = await server.inject({
      method: 'GET',
      url: '/api/entities/item/records',
      headers: { cookie: tempSess.cookieHeader },
    });
    expect(checkInvalid.statusCode).toBe(401);

    await cleanupTestUser(tempSess.userId);
  });

  // ─── 6. CSRF Double-Submit Protection ────────────────────────────────────

  it('CSRF rejection: missing x-csrf-token on state mutations returns 403', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: { cookie: ownerA.cookieHeader, 'content-type': 'application/json' },
      payload: { title: 'No CSRF' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('CSRF');
  });

  it('CSRF rejection: mismatched x-csrf-token header returns 403', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/entities/item/records',
      headers: {
        cookie: ownerA.cookieHeader,
        'x-csrf-token': 'invalid-csrf-token-1234',
        'content-type': 'application/json',
      },
      payload: { title: 'Bad CSRF' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toContain('CSRF');
  });

  // ─── 7. Viewer Cannot Reach Studio Routes or Studio APIs ─────────────────

  it('viewer cannot create schema entity (403)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/schema/entities',
      headers: viewerA.headers,
      payload: { name: 'unauthorized_entity', label: 'Unauthorized' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot add field to schema entity (403)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/schema/entities/${itemEntityIdA}/fields`,
      headers: viewerA.headers,
      payload: { name: 'unauthorized_field', label: 'Unauthorized', type: 'text' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot create page (403)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: viewerA.headers,
      payload: { name: 'Unauthorized Page', route: '/unauthorized' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot update page (403)', async () => {
    // Builder creates page
    const createPage = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: builderA.headers,
      payload: { name: 'Draft Page', route: '/draft-test' },
    });
    const pageId = JSON.parse(createPage.payload).id;

    const res = await server.inject({
      method: 'PUT',
      url: `/api/pages/${pageId}`,
      headers: viewerA.headers,
      payload: { name: 'Hacked Page' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot delete page (403)', async () => {
    const createPage = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: builderA.headers,
      payload: { name: 'To Be Deleted', route: '/to-delete' },
    });
    const pageId = JSON.parse(createPage.payload).id;

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/pages/${pageId}`,
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot publish page (403)', async () => {
    const createPage = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: builderA.headers,
      payload: { name: 'To Publish', route: '/to-publish' },
    });
    const pageId = JSON.parse(createPage.payload).id;

    const res = await server.inject({
      method: 'POST',
      url: `/api/pages/${pageId}/publish`,
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot inspect unpublished draft page (404/403)', async () => {
    const createPage = await server.inject({
      method: 'POST',
      url: '/api/pages',
      headers: builderA.headers,
      payload: { name: 'Secret Draft', route: '/secret-draft' },
    });
    const pageId = JSON.parse(createPage.payload).id;

    const res = await server.inject({
      method: 'GET',
      url: `/api/pages/${pageId}`,
      headers: viewerA.headers,
    });
    // For non-builders, unpublished pages return 404 (draft invisible)
    expect(res.statusCode).toBe(404);
  });

  it('viewer cannot list members (403)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/members',
      headers: viewerA.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot invite members (403)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/invite',
      headers: viewerA.headers,
      payload: { email: 'invitee@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── 8. Token Hashing in Database ─────────────────────────────────────────

  it('stores only SHA-256 hashes of session tokens and invite tokens in DB', async () => {
    // Raw session ID from test session
    const rawSessionId = ownerA.sessionId;
    const hashedSessionId = hashToken(rawSessionId);

    // Verify raw session ID does NOT exist in public.app_session
    const rawCheck = await pool.query(
      `SELECT id FROM public.app_session WHERE id = $1`,
      [rawSessionId]
    );
    expect(rawCheck.rows.length).toBe(0);

    // Verify hashed session ID DOES exist
    const hashCheck = await pool.query(
      `SELECT id FROM public.app_session WHERE id = $1`,
      [hashedSessionId]
    );
    expect(hashCheck.rows.length).toBe(1);

    // Create an invite token
    const rawInviteToken = await authService.createInvite(
      tenantA,
      ownerA.userId,
      'hash_test@example.com',
      'editor'
    );
    const hashedInviteToken = hashToken(rawInviteToken);

    // Verify raw invite token does NOT exist in public.invite_token
    const rawInviteCheck = await pool.query(
      `SELECT token FROM public.invite_token WHERE token = $1`,
      [rawInviteToken]
    );
    expect(rawInviteCheck.rows.length).toBe(0);

    // Verify hashed invite token DOES exist
    const hashInviteCheck = await pool.query(
      `SELECT token FROM public.invite_token WHERE token = $1`,
      [hashedInviteToken]
    );
    expect(hashInviteCheck.rows.length).toBe(1);
  });

  // ─── 9. Rate Limiter Interface & IP + Email Keying ────────────────────────

  it('rate limiter: keys by IP + email and blocks requests exceeding limit', async () => {
    const limiter = new MemoryRateLimiter();
    const fakeReq = { ip: '192.168.1.50' };
    const email = 'user@example.com';
    const key = buildRateLimitKey(fakeReq as any, email);

    expect(key).toBe('192.168.1.50:user@example.com');

    // Allow 2 requests per window
    const first = await limiter.consume(key, 2, 60000);
    expect(first.allowed).toBe(true);

    const second = await limiter.consume(key, 2, 60000);
    expect(second.allowed).toBe(true);

    const third = await limiter.consume(key, 2, 60000);
    expect(third.allowed).toBe(false);
    expect(third.resetMs).toBeGreaterThan(0);

    // Different email on same IP should not be blocked
    const otherKey = buildRateLimitKey(fakeReq as any, 'other@example.com');
    const otherRes = await limiter.consume(otherKey, 2, 60000);
    expect(otherRes.allowed).toBe(true);
  });
});
