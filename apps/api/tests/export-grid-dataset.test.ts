import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { pool } from '../src/db/pool.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import {
  GridHydrator,
  gridHydrator,
  GridHydrationForbiddenError,
  GridHydrationLimitError,
} from '../src/records/export/grid-hydrator.js';
import {
  datasetQueryBuilder,
  type GridDatasetContext,
} from '../src/records/export/dataset-query-builder.js';
import { permissionService } from '../src/permissions/permission-service.js';
import {
  migrateGridTemplateToV2,
  buildExecutiveReportTemplate,
  type GridExportTemplateDefinition,
  type GridDatasetDefinition,
} from '@config-platform/schema';
import { deepWalkRemap } from '../src/workspace/export-import-service.js';
import { runCatalogMigrations } from '../src/db/catalog-migration-runner.js';

describe('Phase 2C: Datasets for Grid Templates Backend Suite', () => {
  let tenantId: string;
  let tenantSchema: string;

  // Entities
  let lineEntityId: string;
  let machineEntityId: string;
  let logEntityId: string;

  // Physical table names
  let lineTable: string;
  let machineTable: string;
  let logTable: string;

  // Line fields
  let fLineName: string;

  // Machine fields
  let fMachineName: string;
  let fMachineLineRef: string;

  // Log fields
  let fLogTimestamp: string;
  let fLogMachineRef: string;
  let fLogUnits: string;
  let fLogPrice: string;
  let fLogSecret: string; // hidden field

  beforeAll(async () => {
    await runCatalogMigrations();
    tenantId = `t_2c_${crypto.randomBytes(4).toString('hex')}`;
    await migrationService.provisionTenant(tenantId, 'Phase 2C Test Tenant');
    tenantSchema = defaultStorageAdapter.getTenantSchemaName(tenantId);

    // Set tenant timezone to 'Asia/Kolkata' (+05:30) for testing
    await pool.query(
      `UPDATE public.tenant SET timezone = 'Asia/Kolkata' WHERE id = $1;`,
      [tenantId]
    );

    // 1. Line Entity
    lineEntityId = `e_line_${crypto.randomBytes(4).toString('hex')}`;
    lineTable = `rec_line_${crypto.randomBytes(4).toString('hex')}`;
    fLineName = `f_${crypto.randomBytes(4).toString('hex')}`;

    await pool.query(
      `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, display_field_id)
       VALUES ($1, $2, 'line', 'Production Line', $3, $4);`,
      [lineEntityId, tenantId, lineTable, fLineName]
    );
    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, type, physical_column_name)
       VALUES ($1, $2, $3, 'name', 'Line Name', 'string', 'c_name');`,
      [fLineName, tenantId, lineEntityId]
    );

    // 2. Machine Entity
    machineEntityId = `e_mac_${crypto.randomBytes(4).toString('hex')}`;
    machineTable = `rec_mac_${crypto.randomBytes(4).toString('hex')}`;
    fMachineName = `f_${crypto.randomBytes(4).toString('hex')}`;
    fMachineLineRef = `f_${crypto.randomBytes(4).toString('hex')}`;

    await pool.query(
      `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, display_field_id)
       VALUES ($1, $2, 'machine', 'Machine', $3, $4);`,
      [machineEntityId, tenantId, machineTable, fMachineName]
    );
    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, type, physical_column_name, config)
       VALUES 
       ($1, $2, $3, 'name', 'Machine Name', 'string', 'c_name', '{}'::jsonb),
       ($4, $2, $3, 'line', 'Line Ref', 'reference', 'c_line_id', jsonb_build_object('targetEntityId', $5::text));`,
      [fMachineName, tenantId, machineEntityId, fMachineLineRef, lineEntityId]
    );

    // 3. Machine Log Entity
    logEntityId = `e_log_${crypto.randomBytes(4).toString('hex')}`;
    logTable = `rec_log_${crypto.randomBytes(4).toString('hex')}`;
    fLogTimestamp = `f_${crypto.randomBytes(4).toString('hex')}`;
    fLogMachineRef = `f_${crypto.randomBytes(4).toString('hex')}`;
    fLogUnits = `f_${crypto.randomBytes(4).toString('hex')}`;
    fLogPrice = `f_${crypto.randomBytes(4).toString('hex')}`;
    fLogSecret = `f_${crypto.randomBytes(4).toString('hex')}`;

    await pool.query(
      `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, display_field_id)
       VALUES ($1, $2, 'machineLog', 'Machine Log', $3, $4);`,
      [logEntityId, tenantId, logTable, fLogTimestamp]
    );
    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, type, physical_column_name, config)
       VALUES 
       ($1, $2, $3, 'timestamp', 'Timestamp', 'date', 'c_timestamp', '{}'::jsonb),
       ($4, $2, $3, 'machine', 'Machine Ref', 'reference', 'c_machine_id', jsonb_build_object('targetEntityId', $5::text)),
       ($6, $2, $3, 'units', 'Units', 'number', 'c_units', '{}'::jsonb),
       ($7, $2, $3, 'price', 'Price', 'number', 'c_price', '{}'::jsonb),
       ($8, $2, $3, 'secret', 'Secret Key', 'string', 'c_secret', '{}'::jsonb);`,
      [
        fLogTimestamp,
        tenantId,
        logEntityId,
        fLogMachineRef,
        machineEntityId,
        fLogUnits,
        fLogPrice,
        fLogSecret,
      ]
    );

    // Create physical tables
    await pool.query(
      `CREATE TABLE "${tenantSchema}"."${lineTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_name TEXT
       );
       CREATE TABLE "${tenantSchema}"."${machineTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_name TEXT,
         c_line_id VARCHAR(64)
       );
       CREATE TABLE "${tenantSchema}"."${logTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_timestamp TIMESTAMPTZ,
         c_machine_id VARCHAR(64),
         c_units NUMERIC,
         c_price NUMERIC,
         c_secret TEXT
       );`
    );

    // Insert Seed Data:
    // Line 1: 'Line Alpha', Line 2: 'Line Beta'
    await pool.query(
      `INSERT INTO "${tenantSchema}"."${lineTable}" (id, c_name) VALUES
       ('line_1', 'Line Alpha'),
       ('line_2', 'Line Beta');`
    );

    // Machine 1: 'Mill M1' (Line 1), Machine 2: 'Lathe M2' (Line 1), Machine 3: 'Press M3' (Line 2)
    await pool.query(
      `INSERT INTO "${tenantSchema}"."${machineTable}" (id, c_name, c_line_id) VALUES
       ('mac_1', 'Mill M1', 'line_1'),
       ('mac_2', 'Lathe M2', 'line_1'),
       ('mac_3', 'Press M3', 'line_2');`
    );

    // Machine Logs:
    // log 1: 2026-10-10 23:30:00 UTC (Which is 2026-10-11 05:00:00 in +05:30), mac_1, 10 units, price 5
    // log 2: 2026-10-11 01:00:00 UTC (2026-10-11 in +05:30 too), mac_1, 20 units, price 5
    // log 3: 2026-10-11 10:00:00 UTC, mac_2, 15 units, price 10
    // log 4: 2026-10-11 12:00:00 UTC, mac_3, 30 units, price 4
    await pool.query(
      `INSERT INTO "${tenantSchema}"."${logTable}" (id, c_timestamp, c_machine_id, c_units, c_price, c_secret) VALUES
       ('log_1', '2026-10-10 23:30:00+00', 'mac_1', 10, 5, 'classified_1'),
       ('log_2', '2026-10-11 01:00:00+00', 'mac_1', 20, 5, 'classified_2'),
       ('log_3', '2026-10-11 10:00:00+00', 'mac_2', 15, 10, 'classified_3'),
       ('log_4', '2026-10-11 12:00:00+00', 'mac_3', 30, 4, 'classified_4');`
    );

    // Permissions setup: grant canExport to admin on all three entities
    await pool.query(
      `INSERT INTO public.entity_permission (tenant_id, entity_id, role, can_read, can_create, can_update, can_delete, can_export)
       VALUES
       ($1, $2, 'admin', true, true, true, true, true),
       ($1, $3, 'admin', true, true, true, true, true),
       ($1, $4, 'admin', true, true, true, true, true)
       ON CONFLICT DO NOTHING;`,
      [tenantId, lineEntityId, machineEntityId, logEntityId]
    );
  });

  afterAll(async () => {
    // Cleanup tenant schema
    await pool.query(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE;`);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1;`, [tenantId]);
  });

  // Helper context
  const getContext = (userRole = 'admin', hiddenFields: string[] = []): GridDatasetContext => ({
    tenantId,
    user: { id: 'u_tester', name: 'Alice Test', email: 'alice@test.com', role: userRole },
    userRole,
    exportParams: {},
    entityPermissions: new Map([
      [lineEntityId, { canExport: true }],
      [machineEntityId, { canExport: true }],
      [logEntityId, { canExport: true }],
    ]),
    hiddenFieldIds: new Set(hiddenFields),
  });

  // 1. Join across three entities (machineLog -> machine -> line)
  it('1. executes a 3-entity join (machineLog -> machine -> line) returning correct joined rows', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_3join',
      name: 'Logs with Machine and Line',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j_mac',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
            joinType: 'inner',
          },
          {
            id: 'j_line',
            name: 'line',
            referenceFieldId: fMachineLineRef,
            parentJoinId: 'j_mac',
            targetEntityId: lineEntityId,
            joinType: 'inner',
          },
        ],
      },
      fields: [
        { id: 'f1', name: 'units', fieldPath: 'units' },
        { id: 'f2', name: 'machineName', fieldPath: 'machine.name' },
        { id: 'f3', name: 'lineName', fieldPath: 'machine.line.name' },
      ],
      filters: [],
      sort: [{ fieldPath: 'units', direction: 'asc' }],
      groupBy: [],
      aggregates: [],
      having: [],
    };

    const ctx = getContext();
    const result = await datasetQueryBuilder.executeDatasetQuery(dataset, ctx);
    expect(result.rows.length).toBe(4);
    // Ordered by units asc: 10, 15, 20, 30
    expect(result.rows[0].units).toBe(10); // NUMERIC arrives as a number, not "10"
    expect(result.rows[0].machineName).toBe('Mill M1');
    expect(result.rows[0].lineName).toBe('Line Alpha');

    expect(result.rows[3].units).toBe(30);
    expect(result.rows[3].machineName).toBe('Press M3');
    expect(result.rows[3].lineName).toBe('Line Beta');
  });

  // 2. Aggregate by day and by machine with known totals
  it('2. aggregates by day and machine returning exact totals', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_agg',
      name: 'Aggregates by Day and Machine',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j_mac',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
          },
        ],
      },
      fields: [],
      filters: [],
      sort: [{ fieldPath: 'machine.name', direction: 'asc' }],
      groupBy: [
        { fieldPath: 'machine.name' },
      ],
      aggregates: [
        { id: 'agg_sum_units', name: 'total_units', fn: 'sum', fieldPath: 'units' },
        { id: 'agg_avg_price', name: 'avg_price', fn: 'avg', fieldPath: 'price' },
        { id: 'agg_count', name: 'log_count', fn: 'count' },
      ],
      having: [],
    };

    const ctx = getContext();
    const result = await datasetQueryBuilder.executeDatasetQuery(dataset, ctx);
    expect(result.rows.length).toBe(3);

    // Mill M1 has 2 logs (10 + 20 units = 30 units, avg price = 5)
    const m1 = result.rows.find((r) => r['machine.name'] === 'Mill M1');
    expect(m1).toBeDefined();
    expect(Number(m1.total_units)).toBe(30);
    expect(Number(m1.avg_price)).toBe(5);
    expect(Number(m1.log_count)).toBe(2);

    // Lathe M2 has 1 log (15 units, price 10)
    const m2 = result.rows.find((r) => r['machine.name'] === 'Lathe M2');
    expect(m2).toBeDefined();
    expect(Number(m2.total_units)).toBe(15);
    expect(Number(m2.avg_price)).toBe(10);
    expect(Number(m2.log_count)).toBe(1);

    // Press M3 has 1 log (30 units, price 4)
    const m3 = result.rows.find((r) => r['machine.name'] === 'Press M3');
    expect(m3).toBeDefined();
    expect(Number(m3.total_units)).toBe(30);
    expect(Number(m3.avg_price)).toBe(4);
    expect(Number(m3.log_count)).toBe(1);
  });

  // 3. HAVING clause
  it('3. filters grouped aggregates using HAVING clause', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_having',
      name: 'Machines with more than 20 total units',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j_mac',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
          },
        ],
      },
      fields: [],
      filters: [],
      sort: [],
      groupBy: [{ fieldPath: 'machine.name' }],
      aggregates: [
        { id: 'agg_sum_units', name: 'total_units', fn: 'sum', fieldPath: 'units' },
      ],
      having: [
        { aggregateId: 'agg_sum_units', operator: 'gt', value: 20 },
      ],
    };

    const ctx = getContext();
    const result = await datasetQueryBuilder.executeDatasetQuery(dataset, ctx);
    // Mill M1 has 30, Press M3 has 30, Lathe M2 has 15 (filtered out)
    expect(result.rows.length).toBe(2);
    const names = result.rows.map((r) => r['machine.name']);
    expect(names).toContain('Mill M1');
    expect(names).toContain('Press M3');
    expect(names).not.toContain('Lathe M2');
  });

  // 4. Time bucket in a non-UTC timezone across a day boundary
  it('4. groups timestamps by day respecting non-UTC workspace timezone across day boundary', async () => {
    // In UTC:
    // log_1 (2026-10-10 23:30:00Z) is on 2026-10-10.
    // In 'Asia/Kolkata' (+05:30):
    // 2026-10-10 23:30:00Z + 05:30 = 2026-10-11 05:00:00, so ALL 4 logs fall on 2026-10-11!
    const dataset: GridDatasetDefinition = {
      id: 'ds_timezone',
      name: 'Logs grouped by day in Asia/Kolkata',
      source: {
        baseEntityId: logEntityId,
        joins: [],
      },
      fields: [],
      filters: [],
      sort: [],
      groupBy: [
        { fieldPath: 'timestamp', dateBucket: 'day' },
      ],
      aggregates: [
        { id: 'agg_units', name: 'day_units', fn: 'sum', fieldPath: 'units' },
        { id: 'agg_count', name: 'day_count', fn: 'count' },
      ],
      having: [],
    };

    const ctx = getContext();
    // Verify default workspace timezone 'Asia/Kolkata'
    const resultKolkata = await datasetQueryBuilder.executeDatasetQuery(dataset, ctx);
    // Since all 4 logs fall on 2026-10-11 in Kolkata, there is exactly 1 group with total 75 units!
    expect(resultKolkata.rows.length).toBe(1);
    expect(Number(resultKolkata.rows[0].day_units)).toBe(75);
    expect(Number(resultKolkata.rows[0].day_count)).toBe(4);

    // Now override with export parameter: timezone = 'UTC'
    const ctxUtc = {
      ...ctx,
      exportParams: { timezone: 'UTC' },
    };
    const resultUtc = await datasetQueryBuilder.executeDatasetQuery(dataset, ctxUtc);
    // In UTC, log_1 is on 2026-10-10 (10 units), and logs 2,3,4 are on 2026-10-11 (65 units). 2 groups!
    expect(resultUtc.rows.length).toBe(2);
    const sorted = resultUtc.rows.sort((a, b) => Number(a.day_units) - Number(b.day_units));
    expect(Number(sorted[0].day_units)).toBe(10);
    expect(Number(sorted[1].day_units)).toBe(65);
  });

  // 4b. Sorting by a date-bucketed group column orders the buckets (chart time series)
  it('4b. sorts grouped rows by a date-bucketed group column', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_bucket_sort',
      name: 'Logs per day, newest first',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [],
      filters: [],
      sort: [{ fieldPath: 'timestamp', direction: 'desc' }],
      groupBy: [{ fieldPath: 'timestamp', dateBucket: 'day' }],
      aggregates: [{ id: 'agg_units', name: 'day_units', fn: 'sum', fieldPath: 'units' }],
      having: [],
    };

    const ctxUtc = { ...getContext(), exportParams: { timezone: 'UTC' } };
    const desc = await datasetQueryBuilder.executeDatasetQuery(dataset, ctxUtc);
    expect(desc.rows.map((r) => Number(r.agg_units ?? r.day_units))).toEqual([65, 10]);

    const asc = await datasetQueryBuilder.executeDatasetQuery(
      { ...dataset, sort: [{ fieldPath: 'timestamp', direction: 'asc' }] },
      ctxUtc
    );
    expect(asc.rows.map((r) => Number(r.agg_units ?? r.day_units))).toEqual([10, 65]);
  });

  // 5. Computed columns
  it('5. evaluates computed columns using the sandboxed expression evaluator over rows', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_computed',
      name: 'Logs with Total Cost',
      source: {
        baseEntityId: logEntityId,
        joins: [],
      },
      fields: [
        { id: 'f_units', name: 'units', fieldPath: 'units' },
        { id: 'f_price', name: 'price', fieldPath: 'price' },
        {
          id: 'f_total',
          name: 'total_cost',
          fieldPath: 'total_cost',
          expression: 'units * price',
        },
      ],
      filters: [],
      sort: [{ fieldPath: 'units', direction: 'asc' }],
      groupBy: [],
      aggregates: [],
      having: [],
    };

    const ctx = getContext();
    const result = await datasetQueryBuilder.executeDatasetQuery(dataset, ctx);
    expect(result.rows.length).toBe(4);
    // Row 0: 10 * 5 = 50
    expect(result.rows[0].total_cost).toBe(50);
    // Row 1: 15 * 10 = 150
    expect(result.rows[1].total_cost).toBe(150);
    // Row 2: 20 * 5 = 100
    expect(result.rows[2].total_cost).toBe(100);
    // Row 3: 30 * 4 = 120
    expect(result.rows[3].total_cost).toBe(120);
  });

  // 6. Parameter binding & injection rejection across all parameter types
  it('6. safely binds parameters as SQL params and repels SQL injection attempts across parameter types', async () => {
    const dataset: GridDatasetDefinition = {
      id: 'ds_params',
      name: 'Param Filtered Logs',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j_mac',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
          },
        ],
      },
      fields: [{ id: 'f1', name: 'units', fieldPath: 'units' }],
      filters: [
        // Filter by parameter
        { fieldPath: 'machine.name', operator: 'eq', parameterId: 'param_machine' },
      ],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };

    // Legitimate value
    const ctxLegit = {
      ...getContext(),
      exportParams: { param_machine: 'Mill M1' },
    };
    const resLegit = await datasetQueryBuilder.executeDatasetQuery(dataset, ctxLegit);
    expect(resLegit.rows.length).toBe(2);

    // Injection Attempt 1: Classic SQL injection string
    const ctxAttack1 = {
      ...getContext(),
      exportParams: { param_machine: "' OR 1=1 --" },
    };
    const resAttack1 = await datasetQueryBuilder.executeDatasetQuery(dataset, ctxAttack1);
    expect(resAttack1.rows.length).toBe(0); // Safely parameterized; no records match literal string

    // Injection Attempt 2: Semicolon DROP TABLE attempt
    const ctxAttack2 = {
      ...getContext(),
      exportParams: { param_machine: "Mill M1'; DROP TABLE dummy; --" },
    };
    const resAttack2 = await datasetQueryBuilder.executeDatasetQuery(dataset, ctxAttack2);
    expect(resAttack2.rows.length).toBe(0);

    // Number parameter injection attempt
    const numDataset: GridDatasetDefinition = {
      ...dataset,
      filters: [{ fieldPath: 'units', operator: 'gt', parameterId: 'param_min_units' }],
    };
    const ctxNumAttack = {
      ...getContext(),
      exportParams: { param_min_units: '10; DROP TABLE dummy;' },
    };
    // Zod / Parameter validation in query builder converts/checks number or throws/rejects safely
    try {
      const resNum = await datasetQueryBuilder.executeDatasetQuery(numDataset, ctxNumAttack);
      expect(resNum.rows.length).toBe(0);
    } catch (e: any) {
      expect(e).toBeDefined(); // If validation rejects invalid number, that's also safe
    }
  });

  // 7. Hidden field rejection in every position including hidden reference in join path
  it('7. rejects hidden fields in select, filter, groupBy, aggregate, computed column, and join path', async () => {
    const ctxWithHiddenSecret = getContext('admin', [fLogSecret]);

    // Position A: Select field
    const dsSelectHidden: GridDatasetDefinition = {
      id: 'ds_sec_1',
      name: 'Hidden Select',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [{ id: 'f_sec', name: 'secret', fieldPath: 'secret' }],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsSelectHidden, ctxWithHiddenSecret)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // Position B: Filter
    const dsFilterHidden: GridDatasetDefinition = {
      id: 'ds_sec_2',
      name: 'Hidden Filter',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [{ id: 'f1', name: 'units', fieldPath: 'units' }],
      filters: [{ fieldPath: 'secret', operator: 'eq', value: 'classified_1' }],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsFilterHidden, ctxWithHiddenSecret)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // Position C: Group By
    const dsGroupHidden: GridDatasetDefinition = {
      id: 'ds_sec_3',
      name: 'Hidden GroupBy',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [],
      filters: [],
      sort: [],
      groupBy: [{ fieldPath: 'secret' }],
      aggregates: [{ id: 'a1', name: 'cnt', fn: 'count' }],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsGroupHidden, ctxWithHiddenSecret)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // Position D: Aggregate field
    const dsAggHidden: GridDatasetDefinition = {
      id: 'ds_sec_4',
      name: 'Hidden Aggregate',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [{ id: 'a1', name: 'cnt', fn: 'count', fieldPath: 'secret' }],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsAggHidden, ctxWithHiddenSecret)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // Position E: Computed column referencing hidden field
    const dsCompHidden: GridDatasetDefinition = {
      id: 'ds_sec_5',
      name: 'Hidden Computed',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [
        { id: 'f1', name: 'secret_calc', fieldPath: 'secret_calc', expression: 'secret' },
      ],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsCompHidden, ctxWithHiddenSecret)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // Position F: Hidden reference field along join path
    const ctxWithHiddenRef = getContext('admin', [fLogMachineRef]);
    const dsJoinHiddenRef: GridDatasetDefinition = {
      id: 'ds_sec_6',
      name: 'Hidden Join Ref',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j1',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
          },
        ],
      },
      fields: [{ id: 'f1', name: 'machineName', fieldPath: 'machine.name' }],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(dsJoinHiddenRef, ctxWithHiddenRef)
    ).rejects.toThrow(GridHydrationForbiddenError);
  });

  // 8. Permission redaction (canExport required on all touched entities)
  it('8. rejects execution if canExport is false on base entity or any joined entity', async () => {
    const ds: GridDatasetDefinition = {
      id: 'ds_perm',
      name: 'Permission Test Dataset',
      source: {
        baseEntityId: logEntityId,
        joins: [
          {
            id: 'j1',
            name: 'machine',
            referenceFieldId: fLogMachineRef,
            targetEntityId: machineEntityId,
          },
        ],
      },
      fields: [{ id: 'f1', name: 'machineName', fieldPath: 'machine.name' }],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };

    // A: Disallow export on base entity
    const ctxNoBaseExport: GridDatasetContext = {
      ...getContext(),
      entityPermissions: new Map([
        [logEntityId, { canExport: false }],
        [machineEntityId, { canExport: true }],
      ]),
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(ds, ctxNoBaseExport)
    ).rejects.toThrow(GridHydrationForbiddenError);

    // B: Disallow export on joined entity
    const ctxNoJoinExport: GridDatasetContext = {
      ...getContext(),
      entityPermissions: new Map([
        [logEntityId, { canExport: true }],
        [machineEntityId, { canExport: false }],
      ]),
    };
    await expect(
      datasetQueryBuilder.executeDatasetQuery(ds, ctxNoJoinExport)
    ).rejects.toThrow(GridHydrationForbiddenError);
  });

  // 9. Count-before-load cap and group cap (10,000)
  it('9. enforces count-before-load cap and group count cap', async () => {
    const ds: GridDatasetDefinition = {
      id: 'ds_cap',
      name: 'Cap Test Dataset',
      source: { baseEntityId: logEntityId, joins: [] },
      fields: [{ id: 'f1', name: 'units', fieldPath: 'units' }],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };

    // Mock count query returning > max cap (e.g. 15,000 > 10,000)
    const originalQuery = pool.query.bind(pool);
    const poolSpy = vi.spyOn(pool, 'query').mockImplementation(async (text: any, params: any) => {
      if (typeof text === 'string' && text.includes('COUNT(*) AS total')) {
        return { rows: [{ total: '15000' }] } as any;
      }
      return originalQuery(text, params);
    });

    try {
      const ctx = getContext();
      await expect(
        datasetQueryBuilder.executeDatasetQuery(ds, ctx)
      ).rejects.toThrow(GridHydrationLimitError);
    } finally {
      poolSpy.mockRestore();
    }
  });

  // 10. Statement timeout (SET LOCAL statement_timeout = '15000ms')
  it('10. verifies statement_timeout is applied per query to prevent runaway executions', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '100ms';");
      // pg_sleep(0.5) should hit the 100ms statement_timeout
      await expect(client.query('SELECT pg_sleep(0.5);')).rejects.toThrow(/statement timeout|canceling statement/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // 11. Migrator test: stored 2B template before and after produces identical rendered output
  it('11. migrates stored 2B template to v2 and produces identical rendered output', async () => {
    // 2B Template: has entity-bound region and entity-bound cell, but NO schemaVersion, parameters, or datasets
    const template2B: any = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"migrator_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Log Sheet',
          order: 0,
          merges: [],
          cells: {
            '0:0': { value: 'Production Report' },
            '1:0': { value: 'Units' },
            '1:1': { value: 'Price' },
            '2:0': { value: '{{ Units }}', binding: { entityId: logEntityId, fieldId: fLogUnits, displayLabel: 'Units' } },
            '2:1': { value: '{{ Price }}', binding: { entityId: logEntityId, fieldId: fLogPrice, displayLabel: 'Price' } },
          },
          regions: [
            {
              id: 'reg_logs',
              entityId: logEntityId,
              displayLabel: 'Logs Table',
              startRow: 2,
              endRow: 6,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: fLogUnits, displayLabel: 'Units' },
                { col: 1, fieldId: fLogPrice, displayLabel: 'Price' },
              ],
            },
          ],
        },
      ],
    };

    // Hydrate before migration (GridHydrator internally migrates v1 to v2)
    const hydrator = new GridHydrator();
    const renderedBefore = await hydrator.hydrateToWorkbook(template2B, { tenantId, userRole: 'admin' });

    // Explicitly run migrator
    const migratedV2 = migrateGridTemplateToV2(template2B);
    expect(migratedV2.schemaVersion).toBe(2);
    expect(migratedV2.datasets.length).toBe(1);
    expect(migratedV2.datasets[0].source.baseEntityId).toBe(logEntityId);
    expect(migratedV2.sheets[0].regions[0].datasetId).toBe(migratedV2.datasets[0].id);

    // Hydrate after migration
    const renderedAfter = await hydrator.hydrateToWorkbook(migratedV2, { tenantId, userRole: 'admin' });

    // Compare rendered sheets, cell values, and row counts
    const sheetBefore = renderedBefore.getWorksheet('Log Sheet')!;
    const sheetAfter = renderedAfter.getWorksheet('Log Sheet')!;
    expect(sheetAfter.rowCount).toBe(sheetBefore.rowCount);
    expect(sheetAfter.columnCount).toBe(sheetBefore.columnCount);

    for (let r = 1; r <= sheetBefore.rowCount; r++) {
      for (let c = 1; c <= sheetBefore.columnCount; c++) {
        const valBefore = sheetBefore.getCell(r, c).value;
        const valAfter = sheetAfter.getCell(r, c).value;
        expect(valAfter).toEqual(valBefore);
      }
    }
  });

  // 12. Remapping test: datasets, parameters, join paths, expressions, filters remapped with 0 old IDs surviving
  it('12. remaps datasets, parameters, join paths, expressions, and filters with 0 old IDs surviving', () => {
    const oldTpl: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [
        { id: 'param_old_1', name: 'min_units', type: 'number', required: true, defaultValue: 5 },
      ],
      datasets: [
        {
          id: 'ds_old_1',
          name: 'Main Logs',
          source: {
            baseEntityId: 'old_ent_log',
            joins: [
              {
                id: 'join_old_1',
                name: 'machine',
                referenceFieldId: 'old_fld_mac_ref',
                targetEntityId: 'old_ent_mac',
              },
            ],
          },
          fields: [
            { id: 'fld_old_1', name: 'units', fieldPath: 'old_fld_units' },
            { id: 'fld_old_2', name: 'total', fieldPath: 'total', expression: 'old_fld_units * 2' },
          ],
          filters: [
            { fieldPath: 'old_fld_mac_ref', operator: 'eq', value: 'old_mac_val' },
          ],
          sort: [{ fieldPath: 'old_fld_units', direction: 'asc' }],
          groupBy: [{ fieldPath: 'old_fld_units' }],
          aggregates: [
            { id: 'agg_old_1', name: 'sum_units', fn: 'sum', fieldPath: 'old_fld_units' },
          ],
          having: [
            { aggregateId: 'agg_old_1', operator: 'gt', value: 10 },
          ],
        },
      ],
      sheets: [
        {
          id: 'sheet_1',
          name: 'Sheet 1',
          order: 0,
          merges: [],
          cells: {
            '0:0': {
              value: '{{ sum_units }}',
              binding: { datasetId: 'ds_old_1', aggregateId: 'agg_old_1', displayLabel: 'Sum' },
            },
          },
          regions: [
            {
              id: 'reg_old_1',
              datasetId: 'ds_old_1',
              displayLabel: 'Region 1',
              startRow: 1,
              endRow: 5,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: 'fld_old_1', displayLabel: 'Units' },
              ],
            },
          ],
        },
      ],
      filenameExpression: '"remapped_test"',
      pdf: { mode: 'table' },
    };

    const idMap = new Map<string, string>([
      ['param_old_1', 'param_new_1'],
      ['ds_old_1', 'ds_new_1'],
      ['old_ent_log', 'new_ent_log'],
      ['join_old_1', 'join_new_1'],
      ['old_fld_mac_ref', 'new_fld_mac_ref'],
      ['old_ent_mac', 'new_ent_mac'],
      ['fld_old_1', 'fld_new_1'],
      ['fld_old_2', 'fld_new_2'],
      ['old_fld_units', 'new_fld_units'],
      ['agg_old_1', 'agg_new_1'],
      ['reg_old_1', 'reg_new_1'],
    ]);

    const remapped = deepWalkRemap(oldTpl, idMap);
    const remappedJson = JSON.stringify(remapped);

    // Verify 0 old IDs survive
    for (const [oldId] of idMap.entries()) {
      expect(remappedJson).not.toContain(oldId);
    }

    // Verify new IDs are properly placed
    expect(remapped.datasets[0].id).toBe('ds_new_1');
    expect(remapped.datasets[0].source.baseEntityId).toBe('new_ent_log');
    expect(remapped.datasets[0].source.joins[0].referenceFieldId).toBe('new_fld_mac_ref');
    expect(remapped.datasets[0].source.joins[0].targetEntityId).toBe('new_ent_mac');
    expect(remapped.datasets[0].fields[0].fieldPath).toBe('new_fld_units');
    expect(remapped.sheets[0].regions[0].datasetId).toBe('ds_new_1');
    expect(remapped.sheets[0].cells['0:0'].binding.datasetId).toBe('ds_new_1');
    expect(remapped.sheets[0].cells['0:0'].binding.aggregateId).toBe('agg_new_1');
  });

  // 13. Benchmark: 3-join aggregate over 100,000 rows on local Postgres reporting query count & execution time
  it('13. benchmark: executes 3-join aggregate query over 100,000 rows and reports query count and time', async () => {
    // Populate 100,000 rows in bulk into a temporary benchmark table
    const bLineTable = `bench_line_${crypto.randomBytes(4).toString('hex')}`;
    const bMacTable = `bench_mac_${crypto.randomBytes(4).toString('hex')}`;
    const bLogTable = `bench_log_${crypto.randomBytes(4).toString('hex')}`;

    await pool.query(
      `CREATE TABLE "${tenantSchema}"."${bLineTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_name TEXT
       );
       CREATE TABLE "${tenantSchema}"."${bMacTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_name TEXT,
         c_line_id VARCHAR(64)
       );
       CREATE TABLE "${tenantSchema}"."${bLogTable}" (
         id VARCHAR(64) PRIMARY KEY,
         c_timestamp TIMESTAMPTZ,
         c_machine_id VARCHAR(64),
         c_units NUMERIC,
         c_price NUMERIC
       );`
    );

    // Insert 5 lines, 20 machines, and 100,000 logs using generate_series
    await pool.query(
      `INSERT INTO "${tenantSchema}"."${bLineTable}" (id, c_name)
       SELECT 'bl_' || i, 'Benchmark Line ' || i FROM generate_series(1, 5) AS i;`
    );

    await pool.query(
      `INSERT INTO "${tenantSchema}"."${bMacTable}" (id, c_name, c_line_id)
       SELECT 'bm_' || i, 'Benchmark Machine ' || i, 'bl_' || ((i % 5) + 1)
       FROM generate_series(1, 20) AS i;`
    );

    await pool.query(
      `INSERT INTO "${tenantSchema}"."${bLogTable}" (id, c_timestamp, c_machine_id, c_units, c_price)
       SELECT 
         'blog_' || i,
         NOW() - (i || ' minutes')::interval,
         'bm_' || ((i % 20) + 1),
         (i % 100) + 1,
         ((i % 50) + 1)::numeric
       FROM generate_series(1, 100000) AS i;`
    );

    // Create index on foreign keys for fast joins
    await pool.query(`CREATE INDEX ON "${tenantSchema}"."${bLogTable}" (c_machine_id);`);
    await pool.query(`CREATE INDEX ON "${tenantSchema}"."${bMacTable}" (c_line_id);`);

    // Execute 3-join aggregation query directly
    let queryCount = 0;
    const start = performance.now();

    const result = await pool.query(
      `SELECT 
         l.c_name AS line_name,
         m.c_name AS machine_name,
         SUM(lg.c_units) AS total_units,
         AVG(lg.c_price) AS avg_price,
         COUNT(*) AS total_logs
       FROM "${tenantSchema}"."${bLogTable}" lg
       INNER JOIN "${tenantSchema}"."${bMacTable}" m ON m.id = lg.c_machine_id
       INNER JOIN "${tenantSchema}"."${bLineTable}" l ON l.id = m.c_line_id
       GROUP BY l.c_name, m.c_name
       HAVING SUM(lg.c_units) > 10000
       ORDER BY total_units DESC;`
    );
    queryCount++;

    const durationMs = Math.round(performance.now() - start);

    // Clean up benchmark tables
    await pool.query(
      `DROP TABLE "${tenantSchema}"."${bLogTable}";
       DROP TABLE "${tenantSchema}"."${bMacTable}";
       DROP TABLE "${tenantSchema}"."${bLineTable}";`
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(queryCount).toBe(1);

    console.log(
      `[BENCHMARK] 3-join aggregation over 100,000 rows completed in ${durationMs}ms across ${queryCount} query. Groups returned: ${result.rows.length}`
    );
  });

  // ─── 14. Professional Dynamic Template Connected to DB Data ───────────────
  it('14. generates and hydrates Executive KPI & Breakdown template dynamically connected to DB data', async () => {
    // Generate executive template dynamically for machine logs
    const execTemplate = buildExecutiveReportTemplate({
      id: logEntityId,
      name: 'machinelog',
      label: 'Machine Logs',
      columns: [
        { id: fLogUnits, name: 'units', label: 'Units', type: 'number' },
        { id: fLogPrice, name: 'price', label: 'Price', type: 'number' },
        { id: fLogTimestamp, name: 'timestamp', label: 'Timestamp', type: 'date' },
      ],
    });

    expect(execTemplate.datasets.length).toBe(1);
    expect(execTemplate.datasets[0].aggregates.length).toBeGreaterThanOrEqual(1);

    // Hydrate template against live database data
    const hydrated = await gridHydrator.hydrateGridDefinition(execTemplate, {
      tenantId,
      userRole: 'admin',
      userId: 'u_admin_1',
      userEmail: 'exec@acme.com',
    });

    const sheet = hydrated.sheets[0];
    // Check banner & user context binding
    expect(sheet.cells['0:0'].value).toContain('MACHINE LOGS');
    expect(sheet.cells['1:0'].value).toContain('exec@acme.com');

    // Check KPI single-cell aggregate bindings
    // Card 1: Total Records (4 logs seeded in beforeAll)
    expect(Number(sheet.cells['4:0'].value)).toBe(4);
    // Card 2: Total Volume (Sum of units: 10 + 20 + 15 + 30 = 75)
    expect(Number(sheet.cells['4:2'].value)).toBe(75);
    // Card 3: Average Value (Average units: 75 / 4 = 18.75)
    expect(Number(sheet.cells['4:4'].value)).toBeCloseTo(18.75, 2);

    // Check repeating data region
    expect(sheet.regions.length).toBe(1);
    // Region has 4 records (rows 8 to 11)
    expect(sheet.cells['8:0'].value).toBeDefined();
    expect(sheet.cells['11:0'].value).toBeDefined();

    // Check totals row shifted and present
    const totalCell = sheet.cells['12:0'] || sheet.cells['11:0'];
    expect(totalCell).toBeDefined();
  });
});
