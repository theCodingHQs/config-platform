import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTemplatePage, type ErdTable, type InstallPlan, type SolutionContent } from '@config-platform/schema';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pagesService } from '../src/pages/pages-service.js';
import { exportTemplateService } from '../src/records/export/export-template-service.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Shared solutions', () => {
  let server: FastifyInstance;
  const suffix = crypto.randomBytes(3).toString('hex');
  const tenantA = `sol_a_${suffix}`;
  const tenantB = `sol_b_${suffix}`;
  let builderA: TestSession;
  let builderB: TestSession;
  let owner: TestSession;
  const ids = { machineA: '', areaA: '', jobA: '', otherA: '', machineB: '' };
  let solutionId: string;

  const erd = (res: any): ErdTable => ({ id: res.entity.id, name: res.entity.name, label: res.entity.label, columns: res.fields.map((f: any) => ({ id: f.id, name: f.name, label: f.label, type: f.type })) }) as ErdTable;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantA, 'Solution Workspace A');
    await migrationService.provisionTenant(tenantB, 'Solution Workspace B');
    builderA = await createTestSession(tenantA, 'builder', 'sol_builder_a');
    builderB = await createTestSession(tenantB, 'builder', 'sol_builder_b');
    owner = await createTestSession(tenantB, 'viewer', 'sol_platform_owner');
    await pool.query('UPDATE public.app_user SET is_platform_admin = TRUE WHERE id = $1', [owner.userId]);

    const machine = await migrationService.createEntity(tenantA, {
      name: 'machine',
      label: 'Machine',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'area', label: 'Area', type: 'text' },
      ],
    });
    ids.machineA = machine.entity.id;
    ids.areaA = machine.fields.find((f: any) => f.name === 'area')!.id;
    const job = await migrationService.createEntity(tenantA, {
      name: 'job',
      label: 'Job',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'machine', label: 'Machine', type: 'reference', config: { targetEntityId: ids.machineA } },
      ],
    });
    ids.jobA = job.entity.id;
    // Not part of the solution: nothing built on it should come along
    ids.otherA = (await migrationService.createEntity(tenantA, { name: 'note', label: 'Note', fields: [{ name: 'text', label: 'Text', type: 'text' }] })).entity.id;

    await pagesService.createPage(tenantA, { name: 'Jobs', route: '/jobs', draft: createTemplatePage('CRUD list', 'p_x', '/jobs', erd(job)) });
    await pagesService.createPage(tenantA, { name: 'Notes', route: '/notes', draft: createTemplatePage('CRUD list', 'p_y', '/notes', erd({ entity: { id: ids.otherA, name: 'note', label: 'Note' }, fields: [] })) });
    await exportTemplateService.createTemplate(tenantA, { name: 'Job sheet', entityId: ids.jobA });

    // Workspace B already has a Machine, without an Area
    ids.machineB = (await migrationService.createEntity(tenantB, { name: 'machine', label: 'Machine', fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] })).entity.id;
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

  it('shares the chosen entities, what they link to, and the pages and exports built only on them', async () => {
    expect((await call(builderA, 'POST', '/shared', { kind: 'solution', sourceId: 'jobs', entityIds: [ids.jobA] })).statusCode).toBe(422);
    const res = await call(builderA, 'POST', '/shared', { kind: 'solution', sourceId: 'jobs', name: 'Job tracking', entityIds: [ids.jobA] });
    expect(res.statusCode).toBe(201);
    solutionId = res.json().id;
    const content = res.json().content as SolutionContent;
    expect(content.entities.map((e) => e.name).sort()).toEqual(['job', 'machine']);
    expect(content.pages.map((p) => p.name)).toEqual(['Jobs']);
    expect(content.exportTemplates.map((t) => t.name)).toEqual(['Job sheet']);
    await call(owner, 'PUT', `/shared/${solutionId}/everywhere`, { everywhere: true });
  });

  it('plans the install: which entities clash, and the fields the existing one lacks', async () => {
    const res = await call(builderB, 'GET', `/shared/${solutionId}/install-plan`);
    expect(res.statusCode).toBe(200);
    const plan = res.json() as InstallPlan;
    expect(plan.entities.find((e) => e.name === 'job')!.existing).toBeNull();
    expect(plan.entities.find((e) => e.name === 'machine')!.existing).toMatchObject({ id: ids.machineB, missingFields: [{ id: ids.areaA, label: 'Area' }] });
    expect(plan.pages).toEqual(['Jobs']);
  });

  it('asks what to do with a clash, then reuses the existing entity with the ticked fields added', async () => {
    const undecided = await call(builderB, 'POST', `/shared/${solutionId}/install`, {});
    expect(undecided.statusCode).toBe(422);
    expect(undecided.json().message).toContain('"Machine"');

    const res = await call(builderB, 'POST', `/shared/${solutionId}/install`, { choices: { [ids.machineA]: { action: 'reuse', entityId: ids.machineB, addFields: [ids.areaA] } } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: ['Job'], reused: ['Machine'], pages: [{ name: 'Jobs', route: '/jobs' }], exportTemplates: ['Job sheet'], missingFields: [] });

    const fields = await pool.query<{ name: string; config: any; entity: string }>(
      `SELECT f.name, f.config, e.name AS entity FROM public.field_def f JOIN public.entity_def e ON e.id = f.entity_id WHERE e.tenant_id = $1 ORDER BY e.name, f.position`,
      [tenantB],
    );
    expect(fields.rows.filter((f) => f.entity === 'machine').map((f) => f.name)).toEqual(['name', 'area']);
    // The new Job links to the workspace's own Machine
    expect(fields.rows.find((f) => f.entity === 'job' && f.name === 'machine')!.config.targetEntityId).toBe(ids.machineB);

    const jobB = (await pool.query<{ id: string }>(`SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = 'job'`, [tenantB])).rows[0].id;
    const page = (await pool.query<{ draft: unknown }>(`SELECT draft FROM public.page_def WHERE tenant_id = $1 AND route = '/jobs'`, [tenantB])).rows[0];
    expect(JSON.stringify(page.draft)).toContain(jobB);
    expect(JSON.stringify(page.draft)).not.toContain(ids.jobA);
    const sheet = (await pool.query<{ entity_id: string }>(`SELECT entity_id FROM public.export_template WHERE tenant_id = $1`, [tenantB])).rows;
    expect(sheet).toEqual([{ entity_id: jobB }]);
  });

  it('installs again as new entities under other names, with the page on a free route', async () => {
    const plan = (await call(builderB, 'GET', `/shared/${solutionId}/install-plan`)).json() as InstallPlan;
    expect(plan.entities.every((e) => e.existing)).toBe(true);
    const taken = await call(builderB, 'POST', `/shared/${solutionId}/install`, { choices: { [ids.jobA]: { action: 'create', label: 'Machine' }, [ids.machineA]: { action: 'reuse', entityId: ids.machineB } } });
    expect(taken.statusCode).toBe(422);

    const res = await call(builderB, 'POST', `/shared/${solutionId}/install`, { choices: { [ids.jobA]: { action: 'create', label: 'Job copy' }, [ids.machineA]: { action: 'reuse', entityId: ids.machineB } } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: ['Job copy'], reused: ['Machine'], pages: [{ route: '/jobs-2' }] });
    expect((await pool.query(`SELECT 1 FROM public.entity_def WHERE tenant_id = $1 AND name = 'job_copy'`, [tenantB])).rowCount).toBe(1);
  });

  it('only solutions are installed', async () => {
    const symbol = await call(builderA, 'POST', '/visuals', { name: 'Dot', kind: 'symbol', definition: { width: 20, height: 20, inputs: [], nodes: [] } });
    const shared = await call(builderA, 'POST', '/shared', { kind: 'symbol', sourceId: symbol.json().id });
    expect((await call(builderA, 'GET', `/shared/${shared.json().id}/install-plan`)).statusCode).toBe(422);
  });
});
