import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

/** A small factory sheet as teams keep them in Excel. */
async function factorySheet(rows: Array<[string, string, Date, number | string, string, string]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('October Sheets');
  ws.addRow(['Machine', 'Work Center', 'Month', 'Planned Days', 'Day 1', 'Status']);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipart(file: Buffer, fields: Record<string, string>) {
  const boundary = `----wizard${crypto.randomBytes(6).toString('hex')}`;
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Production Tracker.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file,
    Buffer.from('\r\n'),
  ];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const month = (m: number) => new Date(Date.UTC(2026, m - 1, 1));
const GOOD_ROWS: Array<[string, string, Date, number | string, string, string]> = [
  ['CNC Mill 01', 'Machining', month(10), 26, 'x', 'Running'],
  ['CNC Mill 02', 'Machining', month(10), 24, '', 'Running'],
  ['Lathe L-03', 'Machining', month(9), 22, 'x', 'Down'],
  ['Press P-04', 'Stamping', month(9), 20, 'x', 'Running'],
  ['Paint PL-07', 'Finishing', month(9), 18, '', 'Idle'],
];

describe('Import wizard: start from an Excel sheet', () => {
  let server: FastifyInstance;
  const tenantId = `wiz_${crypto.randomBytes(3).toString('hex')}`;
  let builder: TestSession;
  let viewer: TestSession;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Wizard Tenant');
    builder = await createTestSession(tenantId, 'builder', 'wiz_builder');
    viewer = await createTestSession(tenantId, 'viewer', 'wiz_viewer');
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(builder.userId);
    await cleanupTestUser(viewer.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const post = (session: TestSession, url: string, file: Buffer, fields: Record<string, string> = {}) => {
    const { payload, contentType } = multipart(file, fields);
    return server.inject({ method: 'POST', url, headers: { ...session.headers, 'content-type': contentType }, payload });
  };

  it('suggests fields from the sheet', async () => {
    const res = await post(builder, '/api/import-wizard/analyze', await factorySheet(GOOD_ROWS));
    expect(res.statusCode).toBe(200);
    const analysis = JSON.parse(res.body);
    expect(analysis.rowCount).toBe(5);
    expect(analysis.suggestedLabel).toBe('Production Tracker');
    expect(analysis.suggestedName).toBe('production_tracker');
    const kinds = Object.fromEntries(analysis.columns.map((c: any) => [c.header, c.kind]));
    expect(kinds).toEqual({
      Machine: 'text', 'Work Center': 'select', Month: 'month', 'Planned Days': 'number', 'Day 1': 'boolean', Status: 'select',
    });
  });

  it('creates the entity and imports every row', async () => {
    const file = await factorySheet(GOOD_ROWS);
    const analysis = JSON.parse((await post(builder, '/api/import-wizard/analyze', file)).body);
    const plan = { entityName: 'production_sheet', entityLabel: 'Production Sheet', icon: 'ClipboardCheck', dateFormat: analysis.dateFormat, columns: analysis.columns };
    const res = await post(builder, '/api/import-wizard/create', file, { plan: JSON.stringify(plan) });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).insertedCount).toBe(5);

    const records = JSON.parse((await server.inject({ method: 'GET', url: '/api/entities/production_sheet/records?sort=machine', headers: builder.headers })).body).data;
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ machine: 'CNC Mill 01', work_center: 'Machining', month: '2026-10-01', day_1: true, status: 'Running' });
    expect(Number(records[0].planned_days)).toBe(26);
    expect(records[1].day_1).toBe(null); // empty tick cell
  });

  it('nothing is left behind when rows don\'t fit, and the reason is given per row', async () => {
    const file = await factorySheet([...GOOD_ROWS, ['Saw S-09', 'Cutting', month(9), 'n/a', 'x', 'Running']]);
    // The user overrides the (text) suggestion for Planned Days and asks for a number
    const analysis = JSON.parse((await post(builder, '/api/import-wizard/analyze', file)).body);
    const columns = analysis.columns.map((c: any) => (c.header === 'Planned Days' ? { ...c, kind: 'number' } : c));
    const res = await post(builder, '/api/import-wizard/create', file, {
      plan: JSON.stringify({ entityName: 'saw_sheet', entityLabel: 'Saw Sheet', dateFormat: 'ISO', columns }),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(JSON.parse(res.body).errors)).toMatch(/Planned Days/);
    const left = await pool.query(`SELECT 1 FROM public.entity_def WHERE tenant_id = $1 AND name = 'saw_sheet'`, [tenantId]);
    expect(left.rows).toHaveLength(0);
  });

  it('only builders can use it, and plans are validated', async () => {
    const file = await factorySheet(GOOD_ROWS);
    expect((await post(viewer, '/api/import-wizard/analyze', file)).statusCode).toBe(403);
    const bad = await post(builder, '/api/import-wizard/create', file, {
      plan: JSON.stringify({ entityName: 'Bad Name', entityLabel: 'X', columns: [] }),
    });
    expect(bad.statusCode).toBe(422);
    // An existing entity name is refused
    const analysis = JSON.parse((await post(builder, '/api/import-wizard/analyze', file)).body);
    const dup = await post(builder, '/api/import-wizard/create', file, {
      plan: JSON.stringify({ entityName: 'production_sheet', entityLabel: 'Again', dateFormat: 'ISO', columns: analysis.columns }),
    });
    expect(dup.statusCode).toBe(409);
  });
});
