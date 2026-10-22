import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

const DAYS = Array.from({ length: 5 }, (_, i) => `day_0${i + 1}`);

describe('Calculated fields (formulas and lookups)', () => {
  let server: FastifyInstance;
  const tenantId = `calc_${crypto.randomBytes(3).toString('hex')}`;
  let builder: TestSession;
  let sheetEntityId: string;
  let machineId: string;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Calculated Fields Tenant');
    builder = await createTestSession(tenantId, 'builder', 'calc_builder');

    const machine = await migrationService.createEntity(tenantId, {
      name: 'machine',
      label: 'Machine',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'work_center', label: 'Work Center', type: 'text' },
      ],
    } as any);
    const sheet = await migrationService.createEntity(tenantId, {
      name: 'sheet',
      label: 'Sheet',
      fields: [
        { name: 'machine', label: 'Machine', type: 'reference', config: { targetEntityId: machine.entity.id } },
        { name: 'planned_days', label: 'Planned Days', type: 'number' },
        ...DAYS.map((name) => ({ name, label: name, type: 'boolean' })),
        { name: 'days_met', label: 'Days on Target', type: 'number', config: { formula: 'countTrue(range("day_01", "day_05"))' } },
        { name: 'attainment_pct', label: 'Attainment %', type: 'number', config: { formula: 'if(planned_days > 0, round(days_met * 100 / planned_days, 1), 0)' } },
        { name: 'machine_name', label: 'Machine Name', type: 'text', config: { formula: 'machine.name' } },
      ],
    } as any);
    sheetEntityId = sheet.entity.id;

    const created = await call('POST', '/api/entities/machine/records', { name: 'CNC Mill 01', work_center: 'Machining' });
    machineId = JSON.parse(created.body).id;
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(builder.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    return server.inject({ method, url, headers: builder.headers, payload: payload as any });
  }
  const entityVersion = async () =>
    (await pool.query('SELECT version FROM public.entity_def WHERE id = $1', [sheetEntityId])).rows[0].version as number;

  it('calculates on save, ignores typed-in values, and recalculates on edit', async () => {
    const res = await call('POST', '/api/entities/sheet/records', {
      machine: machineId, planned_days: 4, day_01: true, day_02: true, day_03: false, days_met: 999,
    });
    expect(res.statusCode).toBe(201);
    const sheet = JSON.parse(res.body);
    expect(Number(sheet.days_met)).toBe(2);
    expect(Number(sheet.attainment_pct)).toBe(50);
    expect(sheet.machine_name).toBe('CNC Mill 01');

    const edited = JSON.parse((await call('PATCH', `/api/entities/sheet/records/${sheet.id}`, { day_03: true })).body);
    expect(Number(edited.days_met)).toBe(3);
    expect(Number(edited.attainment_pct)).toBe(75);
  });

  it('keeps lookups current when the linked record changes', async () => {
    await call('PATCH', `/api/entities/machine/records/${machineId}`, { name: 'CNC Mill 01A' });
    const sheets = JSON.parse((await call('GET', '/api/entities/sheet/records')).body).data;
    expect(sheets.every((s: any) => s.machine_name === 'CNC Mill 01A')).toBe(true);
  });

  it('calculated values can be filtered and sorted like typed-in ones', async () => {
    await call('POST', '/api/entities/sheet/records', { machine: machineId, planned_days: 5, day_01: true });
    const filtered = JSON.parse((await call('GET', '/api/entities/sheet/records?filter[attainment_pct][gte]=50&sort=-attainment_pct')).body).data;
    expect(filtered.map((s: any) => Number(s.attainment_pct))).toEqual([75]);
  });

  it('a new formula field is calculated for existing records', async () => {
    const res = await call('POST', `/api/schema/entities/${sheetEntityId}/fields`, {
      name: 'gap_days', label: 'Gap', type: 'number', config: { formula: 'max(planned_days - days_met, 0)' }, expectedVersion: await entityVersion(),
    });
    expect(res.statusCode).toBe(201);
    const gaps = JSON.parse((await call('GET', '/api/entities/sheet/records?sort=planned_days')).body).data.map((s: any) => Number(s.gap_days));
    expect(gaps).toEqual([1, 4]);
  });

  it('rejects invalid formulas with a readable reason', async () => {
    const add = (formula: string) => call('POST', `/api/schema/entities/${sheetEntityId}/fields`, {
      name: `bad_${crypto.randomBytes(2).toString('hex')}`, label: 'Bad', type: 'number', config: { formula }, expectedVersion: 0,
    });
    for (const [formula, reason] of [
      ['planned_dayz * 2', /unknown field 'planned_dayz'/],
      ['machine.serial', /no field 'serial'/],
      ['system(1)', /Unknown function 'system'/],
    ] as const) {
      const res = await add(formula);
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).message).toMatch(reason);
    }
  });

  it('refuses to delete or rename a field that formulas use', async () => {
    const fields = (await pool.query(`SELECT id, name FROM public.field_def WHERE entity_id = $1`, [sheetEntityId])).rows;
    const planned = fields.find((f: any) => f.name === 'planned_days');
    const del = await call('DELETE', `/api/schema/entities/${sheetEntityId}/fields/${planned.id}?expectedVersion=${await entityVersion()}`);
    expect(del.statusCode).toBe(422);
    expect(JSON.parse(del.body).message).toMatch(/used by Sheet\.attainment_pct/);

    const rename = await call('PUT', `/api/schema/entities/${sheetEntityId}/fields/${planned.id}`, {
      name: 'plan', expectedVersion: await entityVersion(),
    });
    expect(rename.statusCode).toBe(422);
    expect(JSON.parse(rename.body).message).toMatch(/Can't rename 'planned_days'/);

    // The machine's name is used by the sheet's lookup
    const machineEntity = (await pool.query(`SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = 'machine'`, [tenantId])).rows[0].id;
    const nameField = (await pool.query(`SELECT id FROM public.field_def WHERE entity_id = $1 AND name = 'name'`, [machineEntity])).rows[0].id;
    const machineVersion = (await pool.query('SELECT version FROM public.entity_def WHERE id = $1', [machineEntity])).rows[0].version;
    const delName = await call('DELETE', `/api/schema/entities/${machineEntity}/fields/${nameField}?expectedVersion=${machineVersion}`);
    expect(delName.statusCode).toBe(422);
    expect(JSON.parse(delName.body).message).toMatch(/Sheet\.machine_name/);
  });
});
