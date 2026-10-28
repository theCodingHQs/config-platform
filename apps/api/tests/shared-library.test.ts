import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Shared library API', () => {
  let server: FastifyInstance;
  const suffix = crypto.randomBytes(3).toString('hex');
  const tenantA = `shared_a_${suffix}`;
  const tenantB = `shared_b_${suffix}`;
  let builderA: TestSession;
  let viewerA: TestSession;
  let builderB: TestSession;
  let owner: TestSession;

  const lamp = { id: 'lamp', kind: 'ellipse', attrs: { x: 20, y: 20, rx: 6, ry: 6 }, bindings: { fill: 'inputs.on ? "green" : "grey"' } };
  const symbolDef = (nodes: unknown[] = [lamp]) => ({ width: 40, height: 40, inputs: [{ name: 'on', type: 'boolean', default: false }], nodes });

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantA, 'Workspace A');
    await migrationService.provisionTenant(tenantB, 'Workspace B');
    builderA = await createTestSession(tenantA, 'builder', 'shared_builder_a');
    viewerA = await createTestSession(tenantA, 'viewer', 'shared_viewer_a');
    builderB = await createTestSession(tenantB, 'builder', 'shared_builder_b');
    owner = await createTestSession(tenantB, 'viewer', 'shared_platform_owner');
    await pool.query('UPDATE public.app_user SET is_platform_admin = TRUE WHERE id = $1', [owner.userId]);
  });

  afterAll(async () => {
    await server.close();
    for (const s of [builderA, viewerA, builderB, owner]) await cleanupTestUser(s.userId);
    for (const t of [tenantA, tenantB]) {
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [t]);
      await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(t)}" CASCADE`);
    }
  });

  const call = (who: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    server.inject({ method, url: `/api${url}`, headers: who.headers, payload: payload as any });
  const createVisual = async (who: TestSession, name: string, kind: 'symbol' | 'drawing', definition: unknown) => {
    const res = await call(who, 'POST', '/visuals', { name, kind, definition });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number };
  };

  let symbolId: string;
  let sharedId: string;
  let panelId: string;

  it('builders publish a symbol; publishing again makes the next release', async () => {
    symbolId = (await createVisual(builderA, 'Lamp', 'symbol', symbolDef())).id;
    const first = await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: symbolId, description: 'A lamp' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ name: 'Lamp', description: 'A lamp', version: 1, everywhere: false, own: true, sourceId: symbolId, workspace: 'Workspace A' });
    sharedId = first.json().id;

    // Changing the working copy changes nothing shared until it's published again
    const current = (await call(builderA, 'GET', `/visuals/${symbolId}`)).json();
    await call(builderA, 'PUT', `/visuals/${symbolId}`, { name: 'Lamp', definition: symbolDef([{ ...lamp, attrs: { ...lamp.attrs, rx: 9 } }]), expectedVersion: current.version });
    expect((await call(builderA, 'GET', `/shared/${sharedId}`)).json().content.nodes[0].attrs.rx).toBe(6);
    const second = await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: symbolId });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: sharedId, version: 2, content: { nodes: [{ attrs: { rx: 9 } }] } });
  });

  it('only symbols can be shared, and only by builders', async () => {
    const drawing = await createVisual(builderA, 'Board', 'drawing', { nodes: [] });
    expect((await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: drawing.id })).statusCode).toBe(422);
    expect((await call(viewerA, 'POST', '/shared', { kind: 'symbol', sourceId: symbolId })).statusCode).toBe(403);
    expect((await call(builderB, 'POST', '/shared', { kind: 'symbol', sourceId: symbolId })).statusCode).toBe(404);
  });

  it("refuses a symbol that places one of the workspace's own symbols; built-in and shared ones are fine", async () => {
    const placing = (ref: string) => symbolDef([{ id: 'inner', kind: 'symbol', ref, attrs: { x: 0, y: 0 } }]);
    const local = await createVisual(builderA, 'Panel', 'symbol', placing(symbolId));
    const refused = await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: local.id });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toContain('"Lamp"');
    const fine = await createVisual(builderA, 'Panel 2', 'symbol', symbolDef([
      { id: 'a', kind: 'symbol', ref: `shared:${sharedId}`, attrs: { x: 0, y: 0 } },
      { id: 'b', kind: 'symbol', ref: 'builtin:gauge', attrs: { x: 0, y: 0 } },
    ]));
    panelId = fine.id;
    const ok = await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: fine.id });
    expect(ok.statusCode).toBe(201);
    // Not while that one is placed by another shared item
    expect((await call(builderA, 'DELETE', `/shared/${sharedId}`)).statusCode).toBe(409);
    expect((await call(builderA, 'DELETE', `/shared/${ok.json().id}`)).statusCode).toBe(204);
  });

  it('other workspaces see it only once a platform owner shares it everywhere', async () => {
    expect((await call(builderB, 'GET', '/shared?kind=symbol')).json()).toEqual([]);
    expect((await call(builderB, 'GET', `/shared/${sharedId}`)).statusCode).toBe(404);

    // Platform owners can list every workspace's items to choose from; nobody else can
    expect((await call(builderB, 'GET', '/shared?kind=symbol&all=true')).json()).toEqual([]);
    const all = (await call(owner, 'GET', '/shared?kind=symbol&all=true')).json();
    expect(all.find((s: any) => s.id === sharedId)).toMatchObject({ own: false, sourceId: null, workspace: 'Workspace A' });

    expect((await call(builderA, 'PUT', `/shared/${sharedId}/everywhere`, { everywhere: true })).statusCode).toBe(403);
    expect((await call(owner, 'PUT', `/shared/${sharedId}/everywhere`, { everywhere: true })).statusCode).toBe(200);
    const seen = (await call(builderB, 'GET', '/shared?kind=symbol')).json();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: sharedId, everywhere: true, own: false, sourceId: null });
    expect((await call(builderB, 'GET', `/shared/${sharedId}`)).json().content.nodes).toHaveLength(1);
  });

  it("keeps it shared while other workspaces' drawings use it, and lets nobody else unpublish it", async () => {
    const board = await createVisual(builderB, 'Board B', 'drawing', { nodes: [{ id: 'l', kind: 'symbol', ref: `shared:${sharedId}`, attrs: { x: 0, y: 0 } }] });
    expect((await call(owner, 'PUT', `/shared/${sharedId}/everywhere`, { everywhere: false })).statusCode).toBe(409);
    expect((await call(builderB, 'DELETE', `/shared/${sharedId}`)).statusCode).toBe(403);
    expect((await call(builderA, 'DELETE', `/shared/${sharedId}`)).statusCode).toBe(409);

    expect((await call(builderB, 'DELETE', `/visuals/${board.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'PUT', `/shared/${sharedId}/everywhere`, { everywhere: false })).statusCode).toBe(200);
    expect((await call(builderB, 'GET', `/shared/${sharedId}`)).statusCode).toBe(404);
    // Its own workspace still places it in Panel 2
    expect((await call(builderA, 'DELETE', `/shared/${sharedId}`)).json().message).toContain('"Panel 2"');
    expect((await call(builderA, 'DELETE', `/visuals/${panelId}`)).statusCode).toBe(204);
    expect((await call(builderA, 'DELETE', `/shared/${sharedId}`)).statusCode).toBe(204);
    expect((await call(builderA, 'GET', '/shared?kind=symbol')).json()).toEqual([]);
  });
});
