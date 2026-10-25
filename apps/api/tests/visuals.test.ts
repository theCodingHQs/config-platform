import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pagesService } from '../src/pages/pages-service.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Visuals API', () => {
  let server: FastifyInstance;
  const tenantId = `visual_test_${crypto.randomBytes(3).toString('hex')}`;
  const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
  let builder: TestSession;
  let viewer: TestSession;

  const conveyor = { id: 'c1', kind: 'preset', ref: 'conveyor', attrs: { x: 100, y: 200, length: 4 }, bindings: { running: 'live.line1.status == "running"' } };
  const lamp = { id: 'lamp', kind: 'ellipse', attrs: { x: 40, y: 40, rx: 6, ry: 6, fill: 'grey' }, rules: [{ when: 'live.phf.ready', set: { fill: 'green' } }] };

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Visual Test Tenant');
    builder = await createTestSession(tenantId, 'builder', 'visual_builder');
    viewer = await createTestSession(tenantId, 'viewer', 'visual_viewer');
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(builder.userId);
    await cleanupTestUser(viewer.userId);
    await pool.query('DELETE FROM public.tenant WHERE id = $1', [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  });

  const call = (who: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    server.inject({ method, url: `/api${url}`, headers: who.headers, payload: payload as any });

  let id: string;

  it('builders create visuals; defaults fill in', async () => {
    const res = await call(builder, 'POST', '/visuals', { name: 'Line 1', definition: { nodes: [conveyor, { id: 'g', kind: 'group', attrs: {}, children: [lamp] }] } });
    expect(res.statusCode).toBe(201);
    const saved = res.json();
    id = saved.id;
    expect(saved).toMatchObject({ name: 'Line 1', version: 1, elementCount: 2, definition: { version: 2, width: 1200, mode: 'flat', grid: true } });
    expect(saved.definition.nodes[1].children[0]).toMatchObject(lamp);
  });

  it('drawings in the first format are converted', async () => {
    const old = { width: 900, grid: 'isometric', elements: [{ id: 'c1', type: 'conveyor', x: 100, y: 200, scale: 2, flip: true, props: { length: 4 }, bindings: conveyor.bindings }] };
    const res = await call(builder, 'POST', '/visuals', { name: 'Old', definition: old });
    expect(res.statusCode).toBe(201);
    expect(res.json().definition).toMatchObject({ version: 2, width: 900, mode: 'isometric', nodes: [{ id: 'c1', kind: 'preset', ref: 'conveyor', attrs: { x: 100, y: 200, length: 4, scaleX: 2, scaleY: 2, turned: true }, bindings: conveyor.bindings }] });
    expect((await call(builder, 'DELETE', `/visuals/${res.json().id}`)).statusCode).toBe(204);
  });

  it('symbols are placed in drawings and cannot be deleted while placed or contain themselves', async () => {
    const sym = await call(builder, 'POST', '/visuals', { name: 'Station', kind: 'symbol', definition: { width: 120, height: 200, inputs: [{ name: 'status', type: 'text', default: 'idle' }], nodes: [lamp] } });
    expect(sym.json()).toMatchObject({ kind: 'symbol', definition: { inputs: [{ name: 'status', type: 'text' }] } });
    const symId = sym.json().id;
    const self = await call(builder, 'PUT', `/visuals/${symId}`, { name: 'Station', definition: { nodes: [{ id: 's', kind: 'symbol', ref: symId, attrs: {} }] }, expectedVersion: 1 });
    expect(self.json().message).toMatch(/can't contain itself/);
    const line = await call(builder, 'POST', '/visuals', { name: 'HT line', definition: { nodes: [{ id: 'g', kind: 'group', attrs: {}, children: [{ id: 's1', kind: 'symbol', ref: symId, attrs: { x: 10, status: 'running' } }] }] } });
    expect(line.json().kind).toBe('drawing');
    const blocked = await call(builder, 'DELETE', `/visuals/${symId}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toMatch(/placed in "HT line"/);
    expect((await call(builder, 'GET', '/visuals')).json().find((v: { id: string }) => v.id === symId).kind).toBe('symbol');
    expect((await call(builder, 'DELETE', `/visuals/${line.json().id}`)).statusCode).toBe(204);
    expect((await call(builder, 'DELETE', `/visuals/${symId}`)).statusCode).toBe(204);
  });

  it('rejects bad drawings with a readable message', async () => {
    const dup = await call(builder, 'POST', '/visuals', { name: 'Dup', definition: { nodes: [conveyor, { id: 'g', kind: 'group', attrs: {}, children: [conveyor] }] } });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().message).toMatch(/share the id/);
    const noName = await call(builder, 'POST', '/visuals', { name: ' ', definition: {} });
    expect(noName.json().message).toMatch(/Give the visual a name/);
  });

  it('viewers can load a visual (pages show it) but not list or change them', async () => {
    expect((await call(viewer, 'GET', `/visuals/${id}`)).statusCode).toBe(200);
    expect((await call(viewer, 'GET', '/visuals')).statusCode).toBe(403);
    expect((await call(viewer, 'PUT', `/visuals/${id}`, { name: 'x', definition: {}, expectedVersion: 1 })).statusCode).toBe(403);
    const list = (await call(builder, 'GET', '/visuals')).json();
    expect(list).toEqual([expect.objectContaining({ id, name: 'Line 1', elementCount: 2 })]);
  });

  it('saves with the version it was opened at, refusing a stale save', async () => {
    const ok = await call(builder, 'PUT', `/visuals/${id}`, { name: 'Line 1 overview', definition: { nodes: [] }, expectedVersion: 1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ version: 2, elementCount: 0 });
    const stale = await call(builder, 'PUT', `/visuals/${id}`, { name: 'Old', definition: {}, expectedVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().message).toMatch(/Someone else saved/);
  });

  it('pages flag a missing visual and a visual on a page cannot be deleted', async () => {
    const page = await pagesService.createPage(tenantId, {
      name: 'Floor',
      route: '/floor',
      draft: {
        schemaVersion: 2,
        id: 'p_floor',
        version: 1,
        route: '/floor',
        root: { id: 'root', type: 'stack', props: {}, children: [{ id: 'v1', type: 'visual', props: { visualId: id } }, { id: 'v2', type: 'visual', props: { visualId: 'vis_gone' } }] },
      } as any,
    });
    const broken = await pagesService.validateBindings(tenantId, page.draft as any);
    expect(broken).toEqual(["Visual [v2] references missing visual 'vis_gone'"]);

    const blocked = await call(builder, 'DELETE', `/visuals/${id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toMatch(/shown on the page "Floor"/);

    await pagesService.deletePage(tenantId, page.id);
    expect((await call(builder, 'DELETE', `/visuals/${id}`)).statusCode).toBe(204);
    expect((await call(builder, 'GET', `/visuals/${id}`)).statusCode).toBe(404);
  });
});
