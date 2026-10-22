import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Template gallery (ready-made apps)', () => {
  let server: FastifyInstance;
  const tenantId = `tpl_${crypto.randomBytes(3).toString('hex')}`;
  const trackerTenant = `tpl_pt_${crypto.randomBytes(3).toString('hex')}`;
  let builder: TestSession;
  let viewer: TestSession;
  let trackerBuilder: TestSession;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Template Tenant');
    await migrationService.provisionTenant(trackerTenant, 'Tracker Tenant');
    builder = await createTestSession(tenantId, 'builder', 'tpl_builder');
    viewer = await createTestSession(tenantId, 'viewer', 'tpl_viewer');
    trackerBuilder = await createTestSession(trackerTenant, 'builder', 'tpl_pt_builder');
  });

  afterAll(async () => {
    await server.close();
    for (const s of [builder, viewer, trackerBuilder]) await cleanupTestUser(s.userId);
    for (const t of [tenantId, trackerTenant]) {
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [t]);
      await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(t)}" CASCADE`);
    }
  });

  const install = (session: TestSession, id: string, sampleData = true) =>
    server.inject({ method: 'POST', url: `/api/solution-templates/${id}/install`, headers: session.headers, payload: { sampleData } });
  const records = async (session: TestSession, entity: string, query = '') =>
    JSON.parse((await server.inject({ method: 'GET', url: `/api/entities/${entity}/records?limit=100${query}`, headers: session.headers })).body).data;

  it('lists the templates', async () => {
    const list = JSON.parse((await server.inject({ method: 'GET', url: '/api/solution-templates', headers: builder.headers })).body);
    expect(list.map((t: any) => t.id)).toEqual(['production-tracker', 'maintenance-log', 'quality-inspections', 'shift-handover', 'downtime-log']);
    expect(list[1]).toMatchObject({ name: 'Maintenance & Breakdown Log', pages: ['Maintenance Jobs'], reports: ['Maintenance report'] });
  });

  it('installs the Maintenance Log: entities, calculated lookups, sample data, a published page and a report', async () => {
    const res = await install(builder, 'maintenance-log');
    expect(res.statusCode).toBe(201);
    const result = JSON.parse(res.body);
    expect(result.warnings).toEqual([]);
    expect(result.entities.map((e: any) => e.label)).toEqual(['Machine', 'Maintenance Job']);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].route).toBe('/maintenance/jobs');
    expect(result.reports).toHaveLength(1);

    const jobs = await records(builder, 'maintenance_job', '&sort=reported_on');
    expect(jobs).toHaveLength(5);
    expect(jobs[0].machine_name).toBe('CNC Mill 01');
    expect(jobs[0].work_center).toBe('Machining');

    const published = JSON.parse((await server.inject({ method: 'GET', url: '/api/pages/published', headers: viewer.headers })).body);
    expect(published.some((p: any) => p.route === '/maintenance/jobs')).toBe(true);
  }, 120000);

  it('later templates reuse the existing Machine entity and its records', async () => {
    const res = JSON.parse((await install(builder, 'downtime-log')).body);
    expect(res.entities.find((e: any) => e.label === 'Machine').reused).toBe(true);
    expect(await records(builder, 'machine')).toHaveLength(5); // not duplicated
    const events = await records(builder, 'downtime_event', '&sort=started_at');
    expect(events).toHaveLength(5);
    expect(Number(events[1].hours)).toBe(4); // 240 minutes
    expect(events[0].machine_name).toBeTruthy();
  }, 120000);

  it('Quality Inspections calculates the defect rate and result', async () => {
    expect((await install(builder, 'quality-inspections')).statusCode).toBe(201);
    const byBatch = Object.fromEntries((await records(builder, 'quality_inspection')).map((r: any) => [r.batch, r]));
    expect(Number(byBatch['B-2401'].defect_rate)).toBe(1);
    expect(byBatch['B-2401'].result).toBe('Pass');
    expect(Number(byBatch['H-0915'].defect_rate)).toBe(4);
    expect(byBatch['H-0915'].result).toBe('Reject');
  }, 120000);

  it('Shift Handover allows each date and shift once, and can be installed without sample data', async () => {
    const res = JSON.parse((await install(builder, 'shift-handover', false)).body);
    expect(res.sampleRecords).toBe(0);
    const post = () => server.inject({
      method: 'POST', url: '/api/entities/shift_handover/records', headers: builder.headers,
      payload: { shift_date: '2026-10-22', shift: 'A (Morning)', supervisor: 'P. Nair', units_produced: 900, units_target: 1000 },
    });
    const first = await post();
    expect(first.statusCode).toBe(201);
    expect(Number(JSON.parse(first.body).achieved_pct)).toBe(90);
    expect((await post()).statusCode).toBe(409);
  }, 120000);

  it('refuses to install twice, unknown templates, and non-builders', async () => {
    const again = await install(builder, 'maintenance-log');
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).message).toMatch(/already installed/);
    expect((await install(builder, 'nope')).statusCode).toBe(404);
    expect((await install(viewer, 'downtime-log')).statusCode).toBe(403);
  }, 120000);

  it('installs the Production Tracker (its own set-up)', async () => {
    const res = await install(trackerBuilder, 'production-tracker');
    expect(res.statusCode).toBe(201);
    const result = JSON.parse(res.body);
    expect(result.pages.map((p: any) => p.route)).toContain('/production/sheets');
    expect(result.reports).toHaveLength(1);
    const sheets = await records(trackerBuilder, 'production_sheet');
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.every((s: any) => s.machine_name)).toBe(true);
    expect((await install(trackerBuilder, 'production-tracker')).statusCode).toBe(409);
  }, 240000);
});
