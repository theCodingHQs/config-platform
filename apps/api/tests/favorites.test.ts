import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pagesService } from '../src/pages/pages-service.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Favorite pages (per person, with the values a view was opened with)', () => {
  let server: FastifyInstance;
  const tenantId = `fav_test_${crypto.randomBytes(3).toString('hex')}`;
  const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
  let me: TestSession;
  let colleague: TestSession;
  let viewId: string;
  let draftOnlyId: string;

  const call = (session: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    server.inject({ method, url: `/api/${url}`, headers: session.headers, payload: payload as any });

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Favorites Test Tenant');
    me = await createTestSession(tenantId, 'viewer', 'fav_me');
    colleague = await createTestSession(tenantId, 'viewer', 'fav_colleague');

    const view = await pagesService.createPage(tenantId, { name: 'Machine Detail', route: '/machine-detail' });
    await pagesService.publishPage(tenantId, view.id);
    viewId = view.id;
    draftOnlyId = (await pagesService.createPage(tenantId, { name: 'Unfinished', route: '/unfinished' })).id;
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(me.userId);
    await cleanupTestUser(colleague.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  });

  it('saves a page with its values, once per page and values, and keeps them to the person', async () => {
    const first = await call(me, 'POST', 'favorites', { pageId: viewId, params: { machine: 'M12' } });
    expect(first.statusCode).toBe(201);
    expect(JSON.parse(first.body)).toMatchObject({ pageId: viewId, params: { machine: 'M12' }, label: null });

    // The same page and values again: the one they have, not a second
    const again = await call(me, 'POST', 'favorites', { pageId: viewId, params: { machine: 'M12' } });
    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body).id).toBe(JSON.parse(first.body).id);

    // Other values on the same page are a separate favorite
    expect((await call(me, 'POST', 'favorites', { pageId: viewId, params: { machine: 'M13' }, label: ' Line 2 press ' })).statusCode).toBe(201);
    const mine = JSON.parse((await call(me, 'GET', 'favorites')).body);
    expect(mine.map((f: any) => f.params.machine)).toEqual(['M12', 'M13']);
    expect(mine[1].label).toBe('Line 2 press');

    expect(JSON.parse((await call(colleague, 'GET', 'favorites')).body)).toEqual([]);
  });

  it('renames and removes only their own', async () => {
    const [first] = JSON.parse((await call(me, 'GET', 'favorites')).body);
    expect((await call(colleague, 'PUT', `favorites/${first.id}`, { label: 'Mine now' })).statusCode).toBe(404);
    expect((await call(colleague, 'DELETE', `favorites/${first.id}`)).statusCode).toBe(404);

    const renamed = await call(me, 'PUT', `favorites/${first.id}`, { label: 'Press 12' });
    expect(JSON.parse(renamed.body).label).toBe('Press 12');
    expect(JSON.parse((await call(me, 'PUT', `favorites/${first.id}`, { label: '  ' })).body).label).toBeNull();

    expect((await call(me, 'DELETE', `favorites/${first.id}`)).statusCode).toBe(204);
    expect(JSON.parse((await call(me, 'GET', 'favorites')).body)).toHaveLength(1);
  });

  it('refuses a page that is not published, bad values, and an eleventh favorite', async () => {
    expect((await call(me, 'POST', 'favorites', { pageId: draftOnlyId })).statusCode).toBe(404);
    expect((await call(me, 'POST', 'favorites', { pageId: 'nope' })).statusCode).toBe(404);
    expect((await call(me, 'POST', 'favorites', { pageId: viewId, params: { machine: 7 } })).statusCode).toBe(422);
    expect((await call(me, 'POST', 'favorites', { pageId: viewId, params: ['x'] })).statusCode).toBe(422);

    // One is already saved, so nine more fill the ten
    for (let i = 0; i < 9; i++) {
      expect((await call(me, 'POST', 'favorites', { pageId: viewId, params: { n: String(i) } })).statusCode).toBe(201);
    }
    const full = await call(me, 'POST', 'favorites', { pageId: viewId, params: { n: 'extra' } });
    expect(full.statusCode).toBe(409);
    expect(JSON.parse(full.body).message ?? JSON.parse(full.body).error).toMatch(/up to 10 favorites/);
    // At the limit, saving one they already have still works
    expect((await call(me, 'POST', 'favorites', { pageId: viewId, params: { n: '0' } })).statusCode).toBe(200);
  });

  it('removes a favorite when its page is deleted', async () => {
    await pagesService.deletePage(tenantId, viewId);
    expect(JSON.parse((await call(me, 'GET', 'favorites')).body)).toEqual([]);
  });
});
