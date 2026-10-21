import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  type GridExportTemplateDefinition,
  type GridChartDefinition,
  GridChartDefinitionSchema,
  GridExportTemplateDefinitionSchema,
  buildEChartsOption,
  migrateGridTemplateToV3,
  CHART_LIMITS,
} from '@config-platform/schema';
import { chartRenderer, assertSvgScriptFree } from '../src/records/export/chart-renderer.js';
import { chartDataExtractor } from '../src/records/export/chart-data-extractor.js';
import { gridHydrator } from '../src/records/export/grid-hydrator.js';
import { gridXlsxRenderer } from '../src/records/export/grid-xlsx-renderer.js';
import { GridHydrationForbiddenError } from '../src/records/export/dataset-query-builder.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { entityCache } from '../src/records/entity-cache.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { tenantLimitsService } from '../src/limits/tenant-limits.js';
import { exportImportService } from '../src/workspace/export-import-service.js';
import { permissionService } from '../src/permissions/permission-service.js';
import { pool } from '../src/db/pool.js';

describe('Phase A: Charts in Grid Templates (Server & Schema Engine)', () => {
  let tenantId: string;
  let salesEntityId: string;
  let fRegionId: string;
  let fAmountId: string;

  beforeAll(async () => {
    tenantId = `t_chart_${crypto.randomBytes(4).toString('hex')}`;
    await migrationService.provisionTenant(tenantId, 'Chart Testing Tenant');

    salesEntityId = `t_${crypto.randomBytes(4).toString('hex')}`;
    fRegionId = `c_${crypto.randomBytes(4).toString('hex')}`;
    fAmountId = `c_${crypto.randomBytes(4).toString('hex')}`;

    // Provision Sales entity with Region and Amount fields
    await pool.query(
      `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version, created_at, updated_at)
       VALUES ($1, $2, 'sales', 'Sales Orders', 'tbl_sales', 1, NOW(), NOW())`,
      [salesEntityId, tenantId]
    );

    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, physical_column_name, type, required, created_at, updated_at)
       VALUES 
         ($1, $2, $3, 'region', 'Sales Region', $1, 'text', true, NOW(), NOW()),
         ($4, $2, $3, 'amount', 'Order Amount', $4, 'number', true, NOW(), NOW())`,
      [fRegionId, tenantId, salesEntityId, fAmountId]
    );

    const tenantSchema = defaultStorageAdapter.getTenantSchemaName(tenantId);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS "${tenantSchema}"."tbl_sales" (
         id VARCHAR(64) PRIMARY KEY,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         "${fRegionId}" TEXT NOT NULL,
         "${fAmountId}" NUMERIC NOT NULL
       )`
    );

    // Seed 40 records: 20 North ($100 each = 2000), 20 South ($200 each = 4000)
    for (let i = 1; i <= 40; i++) {
      const region = i <= 20 ? 'North' : 'South';
      const amount = i <= 20 ? 100 : 200;
      await pool.query(
        `INSERT INTO "${tenantSchema}"."tbl_sales" (id, "${fRegionId}", "${fAmountId}")
         VALUES ($1, $2, $3)`,
        [`rec_${i}`, region, amount]
      );
    }

    // Set entity permissions for admin & editor
    await pool.query(
      `INSERT INTO public.entity_permission (tenant_id, entity_id, role, can_read, can_create, can_update, can_delete, can_export)
       VALUES 
         ($1, $2, 'admin', true, true, true, true, true),
         ($1, $2, 'editor', true, true, true, true, true)
       ON CONFLICT (tenant_id, entity_id, role) DO UPDATE SET can_export = true`,
      [tenantId, salesEntityId]
    );
  }, 30000);

  // ─── 1. Schema Parsing & Caps ──────────────────────────────────────────────
  it('1. schema parsing and caps: parses valid charts and enforces caps', () => {
    const validChart: GridChartDefinition = {
      id: 'ch_1',
      title: 'Quarterly Sales by Region',
      type: 'bar',
      source: {
        kind: 'dataset',
        datasetId: 'ds_sales',
        category: 'region',
        series: [
          { fieldId: 'amount', name: 'Revenue', color: '#4F46E5', type: 'bar' },
        ],
      },
      anchor: {
        sheetId: 'sheet_1',
        startRow: 2,
        startCol: 1,
        endRow: 12,
        endCol: 8,
      },
      options: {
        stacked: false,
        legend: true,
        xAxisTitle: 'Region',
        yAxisTitle: 'Amount ($)',
      },
    };

    const parsed = GridChartDefinitionSchema.safeParse(validChart);
    expect(parsed.success).toBe(true);

    // Enforce title length <= 120
    const invalidTitle = { ...validChart, title: 'A'.repeat(121) };
    expect(GridChartDefinitionSchema.safeParse(invalidTitle).success).toBe(false);

    // Enforce series cap <= 8
    const tooManySeries = {
      ...validChart,
      source: {
        ...validChart.source,
        series: Array.from({ length: 9 }, (_, i) => ({
          fieldId: `f_${i}`,
          name: `Series ${i}`,
        })),
      },
    };
    expect(GridChartDefinitionSchema.safeParse(tooManySeries).success).toBe(false);

    // Enforce max 20 charts per template
    const templateWithTooManyCharts = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [],
      charts: Array.from({ length: 21 }, (_, i) => ({
        ...validChart,
        id: `chart_${i}`,
      })),
      sheets: [{ id: 'sheet_1', name: 'Sheet1', order: 0, cells: {} }],
      filenameExpression: '"test"',
    };
    const tplParse = GridExportTemplateDefinitionSchema.safeParse(templateWithTooManyCharts);
    expect(tplParse.success).toBe(false);

    // Migrator v3 upgrades older templates
    const v2Template = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      sheets: [{ id: 'sheet_1', name: 'Sheet1', order: 0, cells: {} }],
    };
    const v3Migrated = migrateGridTemplateToV3(v2Template);
    expect(v3Migrated.schemaVersion).toBe(3);
    expect(v3Migrated.charts).toEqual([]);
  });

  // ─── 2. Option Builder Snapshot ────────────────────────────────────────────
  it('2. option builder snapshot: produces deterministic ECharts options with theme tokens', () => {
    const chart: GridChartDefinition = {
      id: 'ch_combo',
      title: 'Monthly Progress & Target',
      type: 'combo',
      source: {
        kind: 'range',
        sheetId: 'sheet_1',
        categoryRange: 'A2:A4',
        series: [
          { name: 'Completed', range: 'B2:B4', color: 'accent', type: 'bar' },
          { name: 'Goal', range: 'C2:C4', color: 'purple', type: 'line' },
        ],
      },
      anchor: { sheetId: 'sheet_1', startRow: 1, startCol: 1, endRow: 10, endCol: 7 },
      options: { legend: true, smooth: true, stacked: false, yAxisTitle: 'Count' },
    };

    const data = {
      categories: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Completed', data: [15, 25, 30], color: 'accent', type: 'bar' as const },
        { name: 'Goal', data: [20, 25, 28], color: 'purple', type: 'line' as const },
      ],
    };

    const option = buildEChartsOption(chart, data, { accent: '#0284C7', purple: '#9333EA' });

    expect(option.title.text).toBe('Monthly Progress &amp; Target');
    expect(option.xAxis.data).toEqual(['Jan', 'Feb', 'Mar']);
    expect(option.series).toHaveLength(2);
    expect(option.series[0].type).toBe('bar');
    expect(option.series[0].itemStyle.color).toBe('#0284C7'); // Resolved theme token
    expect(option.series[1].type).toBe('line');
    expect(option.series[1].smooth).toBe(true);
    expect(option.series[1].itemStyle.color).toBe('#9333EA');
  });

  // ─── 3. Server SVG Output is Valid & Script-Free ───────────────────────────
  it('3. server SVG output is valid and contains no scripts or XSS vectors', () => {
    const chart: GridChartDefinition = {
      id: 'ch_xss',
      title: '<script>alert("xss")</script> Revenue',
      type: 'bar',
      source: {
        kind: 'range',
        sheetId: 's1',
        categoryRange: 'A1:A2',
        series: [{ name: 'Val <img src=x onerror=alert(1)>', range: 'B1:B2' }],
      },
      anchor: { sheetId: 's1', startRow: 0, startCol: 0, endRow: 8, endCol: 6 },
    };

    const data = {
      categories: ['<svg onload=alert(1)>Cat 1', 'Cat 2'],
      series: [{ name: 'Val <img src=x onerror=alert(1)>', data: [100, 200] }],
    };

    const svg = chartRenderer.renderToSvg(chart, data, { width: 500, height: 300 });

    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload=');
    expect(svg).not.toContain('onerror=');
    expect(svg).not.toContain('javascript:');

    // assertSvgScriptFree directly throws on malicious SVG
    expect(() => assertSvgScriptFree('<svg><script>alert(1)</script></svg>')).toThrow();
    expect(() => assertSvgScriptFree('<svg onload="alert(1)"></svg>')).toThrow();
  });

  // ─── 4. Range Chart Exports as a Native Excel Chart at Expected Cells ───────
  it('4. range chart exports as a native Excel chart anchored at the expected cells', async () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [],
      charts: [
        {
          id: 'chart_embed',
          title: 'Embedded Range Chart',
          type: 'line',
          source: {
            kind: 'range',
            sheetId: 'sheet_chart',
            categoryRange: 'A2:A4',
            series: [{ name: 'Trend', range: 'B2:B4', color: '#10B981' }],
          },
          anchor: {
            sheetId: 'sheet_chart',
            startRow: 2,
            startCol: 1,
            endRow: 10,
            endCol: 7,
          },
        },
      ],
      sheets: [
        {
          id: 'sheet_chart',
          name: 'Dashboard',
          order: 0,
          cells: {
            '1:0': { value: 'Jan' },
            '2:0': { value: 'Feb' },
            '3:0': { value: 'Mar' },
            '1:1': { value: 120 },
            '2:1': { value: 180 },
            '3:1': { value: 240 },
          },
        },
      ],
      filenameExpression: '"chart_test"',
      pdf: { mode: 'table' },
    };

    const buffer = await gridHydrator.renderHydratedToBuffer(template, {
      tenantId,
      userRole: 'admin',
    });

    expect(buffer.length).toBeGreaterThan(1000);

    const readWb = new ExcelJS.Workbook();
    await readWb.xlsx.load(buffer);

    const ws = readWb.getWorksheet('Dashboard');
    expect(ws).toBeDefined();

    // Range charts are live native charts (not PNG snapshots) referencing the source cells
    expect(ws!.getImages()).toHaveLength(0);
    const zip = await JSZip.loadAsync(buffer);
    const chartXml = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(chartXml).toContain("<c:f>&apos;Dashboard&apos;!$B$2:$B$4</c:f>");
    expect(chartXml).toContain("<c:f>&apos;Dashboard&apos;!$A$2:$A$4</c:f>");
    const drawingXml = await zip.file('xl/drawings/drawing1.xml')!.async('string');
    expect(drawingXml).toContain('<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row>');
    expect(drawingXml).toContain('<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>11</xdr:row>');
  });

  // ─── 5. Export with 40 Records Matches Database Sums ────────────────────────
  it('5. export with 40 records shows series values equal to database sums', async () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [
        {
          id: 'ds_regional_summary',
          name: 'Regional Sales Summary',
          source: {
            baseEntityId: salesEntityId,
            joins: [],
          },
          fields: [
            { id: 'f_region', name: 'region', fieldPath: 'region', fieldId: fRegionId },
          ],
          groupBy: [
            { fieldPath: 'region' },
          ],
          aggregates: [
            { id: 'total_revenue', name: 'Total Revenue', fn: 'sum', op: 'sum', fieldPath: 'amount', fieldId: fAmountId },
          ],
          sort: [{ fieldPath: 'region', direction: 'asc' }],
          filters: [],
        },
      ],
      charts: [
        {
          id: 'chart_sales_sum',
          title: 'Regional Revenue Sums',
          type: 'bar',
          source: {
            kind: 'dataset',
            datasetId: 'ds_regional_summary',
            category: 'region',
            series: [
              { aggregateId: 'total_revenue', name: 'Revenue', color: '#2563EB' },
            ],
          },
          anchor: {
            sheetId: 'sheet_summary',
            startRow: 1,
            startCol: 1,
            endRow: 12,
            endCol: 8,
          },
        },
      ],
      sheets: [
        {
          id: 'sheet_summary',
          name: 'Regional Summary',
          order: 0,
          cells: {},
        },
      ],
      filenameExpression: '"sales_summary"',
      pdf: { mode: 'table' },
    };

    const chartData = await chartDataExtractor.extractChartData(
      tenantId,
      'admin',
      template.charts[0],
      template,
      template.sheets
    );

    // North has 20 records at $100 = 2000; South has 20 records at $200 = 4000
    expect(chartData.categories).toEqual(['North', 'South']);
    expect(chartData.series).toHaveLength(1);
    expect(chartData.series[0].name).toBe('Revenue');
    expect(chartData.series[0].data).toEqual([2000, 4000]);
  });

  // ─── 6. Band Shifting Moves Anchor & Range References ──────────────────────
  it('6. band shifting moves chart anchor and range references', async () => {
    // Template has:
    // Region on row 2..2 (repeats for 40 records -> delta = +39 rows)
    // Chart anchor at row 6..14 (strictly below region)
    // Range source referencing A3:A3 (inside region) and B6:B8 (below region)
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [
        {
          id: 'ds_all_sales',
          name: 'All Sales',
          source: { baseEntityId: salesEntityId, joins: [] },
          fields: [
            { id: 'f_reg', name: 'region', fieldPath: 'region', fieldId: fRegionId },
            { id: 'f_amt', name: 'amount', fieldPath: 'amount', fieldId: fAmountId },
          ],
          sort: [{ fieldPath: 'id', direction: 'asc' }],
          filters: [],
        },
      ],
      charts: [
        {
          id: 'chart_shifted',
          title: 'Shifted Chart',
          type: 'line',
          source: {
            kind: 'range',
            sheetId: 'sheet_data',
            categoryRange: 'A3:A3',
            series: [{ name: 'Summary', range: 'B6:B8' }],
          },
          anchor: {
            sheetId: 'sheet_data',
            startRow: 6,
            startCol: 1,
            endRow: 14,
            endCol: 8,
          },
        },
      ],
      sheets: [
        {
          id: 'sheet_data',
          name: 'Data Sheet',
          order: 0,
          cells: {
            '2:0': { binding: { datasetId: 'ds_all_sales', fieldId: 'region' } },
            '2:1': { binding: { datasetId: 'ds_all_sales', fieldId: 'amount' } },
            '5:1': { value: 50 },
            '6:1': { value: 60 },
            '7:1': { value: 70 },
          },
          regions: [
            {
              id: 'reg_sales',
              datasetId: 'ds_all_sales',
              startRow: 2,
              endRow: 2,
              columns: [
                { datasetFieldId: 'region', format: 'text' },
                { datasetFieldId: 'amount', format: 'currency' },
              ],
            },
          ],
        },
      ],
      filenameExpression: '"shifted_export"',
      pdf: { mode: 'table' },
    };

    const hydrated = await gridHydrator.hydrateGridDefinition(template, {
      tenantId,
      userRole: 'admin',
    });

    const shiftedChart = hydrated.charts[0];
    expect(shiftedChart).toBeDefined();

    // 40 records expanded region from 2..2 to 2..41 (delta = 39 rows)
    // Anchor was row 6..14 -> shifts by +39 to 45..53
    expect(shiftedChart.anchor.startRow).toBe(6 + 39);
    expect(shiftedChart.anchor.endRow).toBe(14 + 39);

    // Range references:
    // A3:A3 was inside repeating region -> expands endRow to A3:A42
    // B6:B8 was below region -> shifts by +39 to B45:B47
    if (shiftedChart.source.kind === 'range') {
      expect(shiftedChart.source.categoryRange).toBe('A3:A42');
      expect(shiftedChart.source.series[0].range).toBe('B45:B47');
    }
  });

  // ─── 7. Hidden-Field Rejection ─────────────────────────────────────────────
  it('7. hidden-field rejection: rejects chart when category or series uses a hidden field', async () => {
    // Hide 'amount' for role 'editor'
    await pool.query(
      `INSERT INTO public.field_permission (tenant_id, entity_id, field_id, role, hidden, read_only)
       VALUES ($1, $2, $3, 'editor', true, false)
       ON CONFLICT (tenant_id, entity_id, field_id, role) DO UPDATE SET hidden = true`,
      [tenantId, salesEntityId, fAmountId]
    );

    // Invalidate entity cache
    entityCache.invalidate(tenantId);

    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [
        {
          id: 'ds_sales_hidden',
          name: 'Sales Hidden',
          source: { baseEntityId: salesEntityId, joins: [] },
          fields: [
            { id: 'f_reg', name: 'region', fieldPath: 'region', fieldId: fRegionId },
            { id: 'f_amt', name: 'amount', fieldPath: 'amount', fieldId: fAmountId },
          ],
          sort: [],
          filters: [],
        },
      ],
      charts: [
        {
          id: 'ch_forbidden',
          title: 'Forbidden Chart',
          type: 'bar',
          source: {
            kind: 'dataset',
            datasetId: 'ds_sales_hidden',
            category: 'region',
            series: [{ fieldId: 'amount', name: 'Amount' }],
          },
          anchor: { sheetId: 's1', startRow: 1, startCol: 1, endRow: 10, endCol: 6 },
        },
      ],
      sheets: [{ id: 's1', name: 'Sheet1', order: 0, cells: {} }],
      filenameExpression: '"test"',
      pdf: { mode: 'table' },
    };

    await expect(
      chartDataExtractor.extractChartData(
        tenantId,
        'editor',
        template.charts[0],
        template,
        template.sheets
      )
    ).rejects.toThrow(GridHydrationForbiddenError);
  });

  // ─── 8. Import Remapping (No Old ID Survives) ──────────────────────────────
  it('8. import remapping: remaps datasetId and fieldId inside charts with no old ID surviving', async () => {
    const oldEntityId = `t_${crypto.randomBytes(4).toString('hex')}`;
    const oldFieldId = `c_${crypto.randomBytes(4).toString('hex')}`;
    const oldDatasetId = `ds_${crypto.randomBytes(4).toString('hex')}`;
    const oldTemplateId = `et_${crypto.randomBytes(4).toString('hex')}`;

    const bundle = {
      bundleVersion: 2,
      entities: [
        {
          id: oldEntityId,
          name: 'project',
          label: 'Projects',
          fields: [
            { id: oldFieldId, name: 'budget', label: 'Budget', type: 'number', required: true },
          ],
        },
      ],
      relations: [],
      pages: [],
      exportTemplates: [
        {
          id: oldTemplateId,
          entityId: oldEntityId,
          name: 'Project Budget Report',
          draft: {
            kind: 'grid',
            version: 1,
            schemaVersion: 3,
            parameters: [],
            datasets: [
              {
                id: oldDatasetId,
                name: 'Project Dataset',
                source: { baseEntityId: oldEntityId, joins: [] },
                fields: [{ id: 'f_b', name: 'budget', fieldPath: 'budget', fieldId: oldFieldId }],
                sort: [],
                filters: [],
              },
            ],
            charts: [
              {
                id: 'ch_project_budget',
                title: 'Budget Overview',
                type: 'bar',
                source: {
                  kind: 'dataset',
                  datasetId: oldDatasetId,
                  category: oldFieldId,
                  series: [{ fieldId: oldFieldId, name: 'Budget' }],
                },
                anchor: { sheetId: 's1', startRow: 2, startCol: 1, endRow: 10, endCol: 7 },
              },
            ],
            sheets: [{ id: 's1', name: 'Sheet1', order: 0, cells: {} }],
          },
        },
      ],
      permissions: { entities: [], fields: [] },
    };

    const targetTenant = `imp_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(targetTenant, 'Import Target Tenant');

    // Pre-insert oldFieldId to simulate collision and ensure field ID remapping
    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, physical_column_name, type, required, is_unique, position, created_at, updated_at)
       VALUES ($1, $2, $3, 'existing_f', 'Existing', $1, 'text', false, false, 0, NOW(), NOW())`,
      [oldFieldId, tenantId, salesEntityId]
    );

    const importResult = await exportImportService.importBundle(targetTenant, bundle as any);
    expect(importResult.success).toBe(true);

    // Read back imported template from database
    const rows = await pool.query<{ draft: any }>(
      `SELECT draft FROM public.export_template WHERE tenant_id = $1`,
      [targetTenant]
    );
    expect(rows.rows).toHaveLength(1);

    const importedDraft = rows.rows[0].draft;
    const jsonStr = JSON.stringify(importedDraft);

    // Assert that NO old field ID or dataset ID survives in the imported template
    expect(jsonStr).not.toContain(oldFieldId);
    expect(jsonStr).not.toContain(oldDatasetId);

    // Assert that chart has valid new IDs matching the remapped dataset and fields
    const importedChart = importedDraft.charts[0];
    const remappedDatasetId = importedDraft.datasets[0].id;
    const remappedFieldId = importedDraft.datasets[0].fields[0].fieldId;

    expect(importedChart.source.datasetId).toBe(remappedDatasetId);
    expect(importedChart.source.category).toBe(remappedFieldId);
    expect(importedChart.source.series[0].fieldId).toBe(remappedFieldId);
  });

  // ─── 9. Slot Release When Rendering Fails ──────────────────────────────────
  it('9. slot release when rendering fails: acquires export slot and releases upon failure', async () => {
    const invalidChart: GridChartDefinition = {
      id: 'ch_fail',
      title: 'Failing Chart',
      type: 'bar',
      source: {
        kind: 'range',
        sheetId: 's1',
        categoryRange: 'A1:A2',
        // Deliberately exceed 1,000 points cap to trigger an error during renderToSvg
        series: [{ name: 'Overcap', range: 'B1:B2000' }],
      },
      anchor: { sheetId: 's1', startRow: 0, startCol: 0, endRow: 5, endCol: 5 },
    };

    const overcapData = {
      categories: ['1'],
      series: [
        {
          name: 'Overcap',
          data: Array.from({ length: 1001 }, (_, i) => i),
        },
      ],
    };

    // Before: slot should be available
    const slot1 = await tenantLimitsService.acquireExportSlot(tenantId);
    slot1(); // release immediately

    // Call renderWithSlot expecting failure
    await expect(
      chartRenderer.renderWithSlot(tenantId, invalidChart, overcapData)
    ).rejects.toThrow();

    // After failure: slot MUST have been released and available again
    const slot2 = await tenantLimitsService.acquireExportSlot(tenantId);
    expect(typeof slot2).toBe('function');
    slot2(); // clean up
  });

  // ─── 10. Benchmark: 10-Chart Export ─────────────────────────────────────────
  it('10. benchmark: measures peak heap and elapsed time for an export with 10 charts', async () => {
    // Build 10 distinct charts across line, bar, area, pie, donut, and combo
    const chartTypes: Array<'bar' | 'line' | 'area' | 'pie' | 'donut' | 'combo'> = [
      'bar', 'line', 'area', 'pie', 'donut', 'combo', 'bar', 'line', 'pie', 'donut',
    ];

    const charts: GridChartDefinition[] = chartTypes.map((type, i) => ({
      id: `benchmark_chart_${i + 1}`,
      title: `Executive Metric ${i + 1}`,
      type,
      source: {
        kind: 'range',
        sheetId: 'sheet_bench',
        categoryRange: 'A1:A12',
        series: [
          { name: `Series A`, range: 'B1:B12', color: '#0ea5e9', type: 'bar' },
          { name: `Series B`, range: 'C1:C12', color: '#8b5cf6', type: 'line' },
        ],
      },
      anchor: {
        sheetId: 'sheet_bench',
        startRow: i * 15,
        startCol: 4,
        endRow: i * 15 + 12,
        endCol: 12,
      },
      options: {
        legend: true,
        smooth: true,
        stacked: i % 2 === 0,
      },
    }));

    const cells: Record<string, any> = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let r = 0; r < 12; r++) {
      cells[`${r}:0`] = { value: months[r] };
      cells[`${r}:1`] = { value: 100 + r * 15 };
      cells[`${r}:2`] = { value: 80 + r * 10 };
    }

    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [],
      charts,
      sheets: [
        {
          id: 'sheet_bench',
          name: '10-Chart Dashboard',
          order: 0,
          cells,
        },
      ],
      filenameExpression: '"benchmark_10_charts"',
      pdf: { mode: 'table' },
    };

    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const buffer = await gridHydrator.renderHydratedToBuffer(template, {
      tenantId,
      userRole: 'admin',
    });

    const endTime = performance.now();
    const peakHeap = process.memoryUsage().heapUsed;
    const heapGrowthMb = (peakHeap - initialHeap) / (1024 * 1024);
    const durationMs = endTime - startTime;

    console.log(
      `[Benchmark] 10-chart grid export: Initial Heap: ${(initialHeap / 1024 / 1024).toFixed(1)} MB, ` +
        `Peak Heap: ${(peakHeap / 1024 / 1024).toFixed(1)} MB, Growth: ${heapGrowthMb.toFixed(1)} MB, ` +
        `Time: ${durationMs.toFixed(0)} ms, Buffer: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
    );

    expect(buffer.length).toBeGreaterThan(10000);
    // Verification: 10 ECharts SVG SSR + PNG rasterization renders comfortably
    expect(durationMs).toBeLessThan(30000);

    // Read back: the workbook still loads, and all 10 range charts are native chart parts
    const readWb = new ExcelJS.Workbook();
    await readWb.xlsx.load(buffer);
    expect(readWb.getWorksheet('10-Chart Dashboard')).toBeDefined();
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(10);
  });
});
