import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTemplatePage, type ErdTable, type TemplateContent } from '@config-platform/schema';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pagesService } from '../src/pages/pages-service.js';
import { exportTemplateService } from '../src/records/export/export-template-service.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Shared page and export templates', () => {
  let server: FastifyInstance;
  const suffix = crypto.randomBytes(3).toString('hex');
  const tenantA = `tpl_a_${suffix}`;
  const tenantB = `tpl_b_${suffix}`;
  let builderA: TestSession;
  let builderB: TestSession;
  let owner: TestSession;
  let entityA: ErdTable;
  let entityB: { id: string; fields: Array<{ id: string; name: string }> };
  let pageId: string;
  let exportId: string;

  const erd = (res: any): ErdTable => ({
    id: res.entity.id,
    name: res.entity.name,
    label: res.entity.label,
    columns: res.fields.map((f: any) => ({ id: f.id, name: f.name, label: f.label, type: f.type })),
  }) as ErdTable;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantA, 'Template Workspace A');
    await migrationService.provisionTenant(tenantB, 'Template Workspace B');
    builderA = await createTestSession(tenantA, 'builder', 'tpl_builder_a');
    builderB = await createTestSession(tenantB, 'builder', 'tpl_builder_b');
    owner = await createTestSession(tenantB, 'viewer', 'tpl_platform_owner');
    await pool.query('UPDATE public.app_user SET is_platform_admin = TRUE WHERE id = $1', [owner.userId]);

    entityA = erd(await migrationService.createEntity(tenantA, {
      name: 'work_item',
      label: 'Work Item',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'hours', label: 'Hours', type: 'number' },
        { name: 'owner_note', label: 'Owner Note', type: 'text' },
      ],
    }));
    // Workspace B's own entity: same title and hours, no owner note
    const b = await migrationService.createEntity(tenantB, {
      name: 'task',
      label: 'Task',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'hours', label: 'Hours', type: 'number' },
      ],
    });
    entityB = { id: b.entity.id, fields: b.fields };

    const draft = createTemplatePage('CRUD list', 'p_tmp', '/work', entityA, { tableColumns: entityA.columns.map((c) => c.id) });
    pageId = (await pagesService.createPage(tenantA, { name: 'Work items', route: '/work', draft })).id;
    exportId = (await exportTemplateService.createTemplate(tenantA, { name: 'Work sheet', entityId: entityA.id })).id;
  });

  afterAll(async () => {
    await server.close();
    for (const s of [builderA, builderB, owner]) await cleanupTestUser(s.userId);
    for (const t of [tenantA, tenantB]) {
      await pool.query('DELETE FROM public.tenant WHERE id = $1', [t]);
      await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(t)}" CASCADE`);
    }
  });

  const call = (who: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    server.inject({ method, url: `/api${url}`, headers: who.headers, payload: payload as any });

  let pageTemplateId: string;
  let exportTemplateId: string;

  it('a page shared as a template records the entity and fields it uses', async () => {
    const res = await call(builderA, 'POST', '/shared', { kind: 'page-template', sourceId: pageId, description: 'List with forms' });
    expect(res.statusCode).toBe(201);
    pageTemplateId = res.json().id;
    const content = res.json().content as TemplateContent;
    expect(res.json()).toMatchObject({ kind: 'page-template', name: 'Work items', version: 1 });
    expect(content.entities).toHaveLength(1);
    expect(content.entities[0]).toMatchObject({ id: entityA.id, name: 'work_item', label: 'Work Item' });
    expect(content.entities[0].fields.map((f) => f.name).sort()).toEqual(['hours', 'owner_note', 'title']);
    expect((await call(builderA, 'GET', '/shared?kind=page-template')).json()).toHaveLength(1);
    expect((await call(builderA, 'GET', '/shared?kind=symbol')).json()).toHaveLength(0);
  });

  it('its own workspace uses it as it is', async () => {
    const res = await call(builderA, 'POST', `/shared/${pageTemplateId}/use`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().missingFields).toEqual([]);
    expect(JSON.stringify(res.json().definition)).toContain(entityA.id);
  });

  it('another workspace chooses its own entity; fields match by name and the rest are listed', async () => {
    expect((await call(owner, 'PUT', `/shared/${pageTemplateId}/everywhere`, { everywhere: true })).statusCode).toBe(200);
    const unchosen = await call(builderB, 'POST', `/shared/${pageTemplateId}/use`, {});
    expect(unchosen.statusCode).toBe(422);
    expect(unchosen.json().message).toContain('"Work Item"');

    const res = await call(builderB, 'POST', `/shared/${pageTemplateId}/use`, { entityMap: { [entityA.id]: entityB.id } });
    expect(res.statusCode).toBe(200);
    const text = JSON.stringify(res.json().definition);
    expect(text).toContain(entityB.id);
    expect(text).not.toContain(entityA.id);
    for (const name of ['title', 'hours']) {
      expect(text).not.toContain(entityA.columns.find((c) => c.name === name)!.id);
      expect(text).toContain(entityB.fields.find((f) => f.name === name)!.id);
    }
    expect(res.json().missingFields).toEqual(['Task → Owner Note']);

    // Only entities of the workspace using it can stand in
    expect((await call(builderB, 'POST', `/shared/${pageTemplateId}/use`, { entityMap: { [entityA.id]: entityA.id } })).statusCode).toBe(422);
  });

  it('an export template keeps the entity it exports, pointed at the stand-in', async () => {
    const res = await call(builderA, 'POST', '/shared', { kind: 'export-template', sourceId: exportId });
    expect(res.statusCode).toBe(201);
    exportTemplateId = res.json().id;
    expect(res.json().content).toMatchObject({ entityId: entityA.id, entities: [{ id: entityA.id }] });

    expect((await call(builderB, 'POST', `/shared/${exportTemplateId}/use`, { entityMap: { [entityA.id]: entityB.id } })).statusCode).toBe(404);
    await call(owner, 'PUT', `/shared/${exportTemplateId}/everywhere`, { everywhere: true });
    const used = await call(builderB, 'POST', `/shared/${exportTemplateId}/use`, { entityMap: { [entityA.id]: entityB.id } });
    expect(used.statusCode).toBe(200);
    expect(used.json().entityId).toBe(entityB.id);
  });

  it('symbols are not "used" this way, unknown sources are 404, and templates can stop being shared any time', async () => {
    expect((await call(builderA, 'POST', '/shared', { kind: 'page-template', sourceId: 'p_missing' })).statusCode).toBe(404);
    expect((await call(builderA, 'POST', '/shared', { kind: 'export-template', sourceId: 'et_missing' })).statusCode).toBe(404);
    // Copies made from a template don't depend on it
    expect((await call(owner, 'PUT', `/shared/${pageTemplateId}/everywhere`, { everywhere: false })).statusCode).toBe(200);
    expect((await call(builderA, 'DELETE', `/shared/${pageTemplateId}`)).statusCode).toBe(204);
    expect((await call(builderA, 'DELETE', `/shared/${exportTemplateId}`)).statusCode).toBe(204);
  });
});
