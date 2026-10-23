import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { importService } from '../src/records/import/import-service.js';
import { exportImportService } from '../src/workspace/export-import-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Unique combinations (e.g. one sheet per machine per month)', () => {
  let server: FastifyInstance;
  const tenantId = `uniq_${crypto.randomBytes(3).toString('hex')}`;
  let builder: TestSession;
  let sheetId: string;
  let fieldIds: Record<string, string>;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Unique Rules Tenant');
    builder = await createTestSession(tenantId, 'builder', 'uniq_builder');
    const sheet = await migrationService.createEntity(tenantId, {
      name: 'sheet',
      label: 'Production Sheet',
      fields: [
        { name: 'machine', label: 'Machine', type: 'text' },
        { name: 'month', label: 'Month', type: 'date', config: { granularity: 'month' } },
        { name: 'notes', label: 'Notes', type: 'text' },
      ],
    } as any);
    sheetId = sheet.entity.id;
    fieldIds = Object.fromEntries(sheet.fields.map((f) => [f.name, f.id]));
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(builder.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    server.inject({ method, url, headers: builder.headers, payload: payload as any });
  const version = async () => (await pool.query('SELECT version FROM public.entity_def WHERE id = $1', [sheetId])).rows[0].version as number;
  const setRules = async (rules: Array<{ id?: string; fields: string[] }>) =>
    call('PUT', `/api/schema/entities/${sheetId}/unique-rules`, { rules, expectedVersion: await version() });
  const addSheet = (machine: string, month: string | null) => call('POST', '/api/entities/sheet/records', { machine, month });

  it('refuses a rule that existing records already break, naming examples', async () => {
    await addSheet('CNC Mill 01', '2026-10-01');
    const dup = JSON.parse((await addSheet('CNC Mill 01', '2026-10-01')).body);
    const res = await setRules([{ fields: [fieldIds.machine, fieldIds.month] }]);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/already has records sharing the same Machine \+ Month: CNC Mill 01 \/ 2026-10-01 \(2 records\)/);

    await call('DELETE', `/api/entities/sheet/records/${dup.id}`);
    const ok = await setRules([{ fields: [fieldIds.machine, fieldIds.month] }]);
    expect(ok.statusCode).toBe(200);
    const rules = JSON.parse(ok.body).uniqueRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].fields).toEqual([fieldIds.machine, fieldIds.month]);
  });

  it('blocks duplicates on create and edit with a readable message', async () => {
    const dup = await addSheet('CNC Mill 01', '2026-10-15'); // month granularity: stored as 2026-10-01
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).message).toMatch(/A Production Sheet with the same Machine and Month already exists/);

    const other = JSON.parse((await addSheet('Lathe L-03', '2026-10-01')).body);
    const edit = await call('PATCH', `/api/entities/sheet/records/${other.id}`, { machine: 'CNC Mill 01' });
    expect(edit.statusCode).toBe(409);

    // Different month, or an empty part, is fine
    expect((await addSheet('CNC Mill 01', '2026-11-01')).statusCode).toBe(201);
    expect((await addSheet('CNC Mill 01', null)).statusCode).toBe(201);
    expect((await addSheet('CNC Mill 01', null)).statusCode).toBe(201);
  });

  it('import dry run flags rows that break a rule, in the file or against stored records', async () => {
    const csv = 'Machine,Month\nCNC Mill 01,2026-10-01\nPress P-04,2026-10-01\nPress P-04,2026-10-01\n';
    const result: any = await importService.dryRun(
      tenantId, 'sheet', 'builder', Buffer.from(csv), { Machine: fieldIds.machine, Month: fieldIds.month },
      { dateFormat: 'ISO', decimalSeparator: '.', trueWords: ['true'], falseWords: ['false'] }, 'sheets.csv',
    );
    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(2);
    const messages = result.errors.map((e: any) => `${e.row}: ${e.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/already exists/),
      expect.stringMatching(/Same Machine \+ Month as row/),
    ]));
  });

  it('a field in a rule cannot be deleted; removing the rule allows duplicates again', async () => {
    const del = await call('DELETE', `/api/schema/entities/${sheetId}/fields/${fieldIds.month}?expectedVersion=${await version()}`);
    expect(del.statusCode).toBe(409);
    expect(JSON.parse(del.body).message).toMatch(/part of the unique combination Machine \+ Month/);

    expect((await setRules([])).statusCode).toBe(200);
    expect((await addSheet('CNC Mill 01', '2026-10-01')).statusCode).toBe(201);
  });

  it('workspace bundles carry unique combinations, enforced in the new workspace', async () => {
    expect((await setRules([{ fields: [fieldIds.machine, fieldIds.month] }])).statusCode).toBe(409); // duplicates from the previous test
    await pool.query(
      `DELETE FROM "${defaultStorageAdapter.getTenantSchemaName(tenantId)}".${(await pool.query('SELECT physical_table_name FROM public.entity_def WHERE id = $1', [sheetId])).rows[0].physical_table_name}`
    );
    expect((await setRules([{ fields: [fieldIds.machine, fieldIds.month] }])).statusCode).toBe(200);

    const bundle = await exportImportService.exportBundle(tenantId);
    expect(bundle.entities.find((e) => e.name === 'sheet')!.uniqueRules).toHaveLength(1);

    const target = `uniq_imp_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(target, 'Unique Import Target');
    const targetUser = await createTestSession(target, 'builder', 'uniq_target');
    try {
      await exportImportService.importBundle(target, bundle, false);
      const post = () => server.inject({ method: 'POST', url: '/api/entities/sheet/records', headers: targetUser.headers, payload: { machine: 'X', month: '2026-10-01' } });
      expect((await post()).statusCode).toBe(201);
      const dup = await post();
      expect(dup.statusCode).toBe(409);
      expect(JSON.parse(dup.body).message).toMatch(/same Machine and Month/);
    } finally {
      await cleanupTestUser(targetUser.userId);
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [target]);
      await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(target)}" CASCADE`);
    }
  });

  it('names linked records (not their ids) when existing records break a rule', async () => {
    const install = await call('POST', '/api/solution-templates/maintenance-log/install', { sampleData: true });
    expect(install.statusCode).toBe(201);
    const job = (await pool.query(
      `SELECT e.id, e.version, f.id AS machine_field FROM public.entity_def e JOIN public.field_def f ON f.entity_id = e.id
        WHERE e.tenant_id = $1 AND e.name = 'maintenance_job' AND f.name = 'machine'`,
      [tenantId]
    )).rows[0];
    const res = await call('PUT', `/api/schema/entities/${job.id}/unique-rules`, { rules: [{ fields: [job.machine_field] }], expectedVersion: job.version });
    expect(res.statusCode).toBe(409);
    // The sample data has two jobs on CNC Mill 01
    expect(JSON.parse(res.body).message).toMatch(/sharing the same Machine: CNC Mill 01 \(2 records\)/);
  }, 120000);
});
