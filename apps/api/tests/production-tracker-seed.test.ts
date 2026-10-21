import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { migrationService } from '../src/migrations/migration-service.js';
import { exportTemplateService } from '../src/records/export/export-template-service.js';
import { gridHydrator, rewriteRowRelativeFormula, applyCheckboxValues } from '../src/records/export/grid-hydrator.js';
import { seedProductionTracker } from '../src/scripts/seed-production-tracker.js';
import { seedProductionPages } from '../src/scripts/seed-production-pages.js';
import { pagesService } from '../src/pages/pages-service.js';
import { recordsService } from '../src/records/records-service.js';
import { entityCache } from '../src/records/entity-cache.js';
import * as schemaPkg from '@config-platform/schema';
import { pool } from '../src/db/pool.js';

/** Validates every node's resolved props with the same Zod schema the runtime renderer uses. */
function collectPropErrors(node: any, scope: any, errors: string[] = []): string[] {
  const schemaName = `${node.type[0].toUpperCase()}${node.type.slice(1)}PropsSchema`;
  const propsSchema = (schemaPkg as any)[schemaName];
  if (!propsSchema) errors.push(`${node.id}: no props schema for type '${node.type}'`);
  else {
    const { resolved, errors: exprErrors } = schemaPkg.resolveProps(node.props || {}, scope);
    for (const [k, v] of Object.entries(exprErrors)) errors.push(`${node.id}.${k}: ${v}`);
    const parsed = propsSchema.safeParse(resolved);
    if (!parsed.success) errors.push(`${node.id}: ${parsed.error.errors.map((e: any) => `${e.path.join('.')} ${e.message}`).join('; ')}`);
  }
  for (const child of node.children || []) collectPropErrors(child, scope, errors);
  return errors;
}

describe('Production Target Tracker: seeded entities, records and data-driven template', () => {
  let tenantId: string;
  let templateId: string;

  beforeAll(async () => {
    tenantId = `t_prod_${crypto.randomBytes(4).toString('hex')}`;
    await migrationService.provisionTenant(tenantId, 'Production Tracker Test');
    const result = await seedProductionTracker(tenantId, {
      months: ['2026-09', '2026-10'],
      today: new Date(2026, 9, 18),
    });
    templateId = result.templateId!;
  }, 60000);

  it('rewrites template-row formulas onto each record row', () => {
    expect(rewriteRowRelativeFormula('SUM(C21:AG21)', 21, 24)).toBe('SUM(C24:AG24)');
    expect(rewriteRowRelativeFormula('IF(B21-AH21>0,B21-AH21,0)', 21, 22)).toBe('IF(B22-AH22>0,B22-AH22,0)');
    expect(rewriteRowRelativeFormula('ROUND(AH21/$B$21,2)+A4', 21, 23)).toBe('ROUND(AH23/$B$21,2)+A4');
  });

  it('turns hydrated booleans in checkbox ranges into 1/0', () => {
    const sheet: any = {
      cells: { '0:0': { value: true }, '0:1': { value: false }, '0:2': { value: '' }, '0:3': { value: 'true' } },
      dataValidations: [{ ref: 'A1:D1', type: 'checkbox', checkedValue: 1, uncheckedValue: 0 }],
    };
    applyCheckboxValues(sheet);
    expect([0, 1, 2, 3].map((c) => sheet.cells[`0:${c}`].value)).toEqual([1, 0, 0, 1]);
  });

  it('creates the entities, 8 machines, 16 sheets and the template, and is idempotent', async () => {
    const entities = await pool.query(`SELECT name FROM public.entity_def WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
    expect(entities.rows.map((r) => r.name)).toEqual(['machine', 'production_sheet']);

    const again = await seedProductionTracker(tenantId, { months: ['2026-09', '2026-10'], today: new Date(2026, 9, 18) });
    expect(again.machinesCreated).toBe(0);
    expect(again.sheetsCreated).toBe(0);
    expect(again.templateId).toBe(templateId);
  });

  it('--reset-template restores a draft that was saved in an expanded (preview) state', async () => {
    // Simulate the old designer bug: hydrated sheets saved as the draft with unshifted charts
    const tpl = await exportTemplateService.getTemplate(tenantId, templateId);
    const original: any = tpl!.draft;
    const hydrated: any = await gridHydrator.hydrateGridDefinition(original, { tenantId, userRole: 'owner' });
    await exportTemplateService.updateTemplate(tenantId, templateId, { draft: { ...hydrated, charts: original.charts } });

    const again = await seedProductionTracker(tenantId, { months: ['2026-09', '2026-10'], today: new Date(2026, 9, 18), resetTemplate: true });
    expect(again.templateId).toBe(templateId); // same id: pages and export buttons keep working

    // After the reset, the daily chart again reads the line attainment row once data expands
    const restored = await exportTemplateService.getTemplate(tenantId, templateId);
    const rehydrated: any = await gridHydrator.hydrateGridDefinition(restored!.draft as any, { tenantId, userRole: 'owner' });
    const daily = rehydrated.charts.find((c: any) => c.title === 'Daily Line Attainment %');
    expect(daily.source.series[0].range).toBe('C30:AG30');
    expect(rehydrated.sheets[0].cells['29:0'].value).toBe('LINE ATTAIN. %');
  }, 60000);

  it('exports one row per machine with checkbox values, per-row formulas, totals and native charts', async () => {
    const tpl = await exportTemplateService.getTemplate(tenantId, templateId);
    const hydrated = await gridHydrator.hydrateGridDefinition(tpl!.draft as any, { tenantId, userRole: 'owner' });
    const sheet = hydrated.sheets[0];

    // Region (row index 20) expanded to 8 machine rows, sorted by name
    const names = Array.from({ length: 8 }, (_, i) => sheet.cells[`${20 + i}:0`]?.value);
    expect(names).toEqual([
      'Assembly A-08', 'CNC Mill 01', 'CNC Mill 02', 'Injection Mold M-05',
      'Lathe L-03', 'Paint Line PL-07', 'Press P-04', 'Welding Cell W-06',
    ]);

    // Default month (October): days after the 18th and Sundays are unticked; values are 1/0
    const row = 21; // CNC Mill 01
    const days = Array.from({ length: 31 }, (_, d) => sheet.cells[`${row}:${2 + d}`].value);
    expect(days.every((v) => v === 0 || v === 1)).toBe(true);
    expect(days.slice(18).every((v) => v === 0)).toBe(true);
    expect([4, 11, 18].map((d) => days[d - 1])).toEqual([0, 0, 0]);

    // Per-row MET formula was copied and evaluated for this row
    const met = days.reduce((a, b) => a + (b as number), 0);
    expect(sheet.cells[`${row}:33`].formula).toBe('SUM(C22:AG22)');
    expect(sheet.cells[`${row}:33`].value).toBe(met);
    expect(sheet.cells[`${row}:34`].value).toBe(26 - met);

    // Numeric fields arrive as numbers (Postgres NUMERIC comes back as a string); as text,
    // Excel's SUM/IF skipped them and planned days, gap and attainment showed 0
    for (let r = 20; r < 28; r++) expect(typeof sheet.cells[`${r}:1`].value).toBe('number');
    expect(sheet.cells[`${row}:1`].value).toBe(26);

    // Week series rows (31-35) read TARGETS MET (row 29), not a machine row: their bare "C22"
    // formulas must shift with the region like every other reference below it
    expect(sheet.cells['30:2'].formula).toBe('C29');
    for (let d = 0; d < 7; d++) {
      expect(sheet.cells[`30:${2 + d}`].value).toBe(sheet.cells[`28:${2 + d}`].value); // week 1 = targets met
    }

    // KPI totals cover all 8 rows; checkbox range and summary rows expanded / moved below them
    expect(sheet.cells['3:0'].value).toBe(8);
    expect(sheet.cells['3:2'].formula).toBe('SUM(B21:B28)');
    expect(sheet.dataValidations?.[0].ref).toBe('C21:AG28');
    expect(sheet.cells['28:0'].value).toBe('TARGETS MET');

    // Exported workbook: native charts read the expanded rows
    const buffer = await gridHydrator.renderHydratedToBuffer(tpl!.draft as any, { tenantId, userRole: 'owner' });
    const zip = await JSZip.loadAsync(buffer);
    const chartXml = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))
          .map((f) => zip.file(f)!.async('string'))
      )
    ).join('\n');
    expect(chartXml).toContain('&apos;Production Tracker&apos;!$AH$21:$AH$28');
    expect(chartXml).toContain('&apos;Production Tracker&apos;!$A$21:$A$28');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Production Tracker')!.getCell('A22').value).toBe('CNC Mill 01');
  }, 60000);

  describe('production pages', () => {
    let pagesResult: Awaited<ReturnType<typeof seedProductionPages>>;

    beforeAll(async () => {
      pagesResult = await seedProductionPages(tenantId, { today: new Date(2026, 9, 18) });
    }, 120000);

    it('creates four published pages in a Production folder with valid bindings and props', async () => {
      expect(pagesResult.pages.map((p) => p.route)).toEqual([
        '/production/dashboard',
        '/production/machines',
        '/production/sheets',
        '/production/machine-performance',
      ]);
      for (const p of pagesResult.pages) {
        expect(p.brokenBindings).toEqual([]);
        const page: any = await pagesService.getPage(tenantId, p.id);
        expect(page.published).toBeTruthy();
        const scope = { state: page.published.state, params: {}, user: { id: 'u', role: 'owner' }, ds: {} };
        expect(collectPropErrors(page.published.root, scope)).toEqual([]);
      }
      const folder = await pool.query(`SELECT name FROM public.page_nav_folder WHERE id = $1`, [pagesResult.folderId]);
      expect(folder.rows[0].name).toBe('Production');
    });

    it('shows the pages in the navigation menu, in order', async () => {
      // The runtime menu lists a navigation entry only if a published definition has the same id
      for (const p of pagesResult.pages) {
        const page: any = await pagesService.getPage(tenantId, p.id);
        expect(page.published.id).toBe(p.id);
        expect(page.draft.id).toBe(p.id);
      }
      const nav = await pagesService.getNavigation(tenantId);
      const inFolder = nav.pages.filter((p) => p.folderId === pagesResult.folderId).map((p) => p.route);
      expect(inFolder).toEqual(pagesResult.pages.map((p) => p.route));
    });

    it('wires the export report button to the tracker template with the selected month', async () => {
      const dashboard: any = await pagesService.getPage(tenantId, pagesResult.pages[0].id);
      const json = JSON.stringify(dashboard.published);
      expect(json).toContain(`"template":"${templateId}"`);
      expect(json).toContain('"parameters":{"month":"{{ state.month }}"}');
    });

    it('keeps derived sheet fields in sync through the trigger', async () => {
      entityCache.invalidate(tenantId);
      const list = await recordsService.getRecords(tenantId, 'production_sheet', { 'filter[month][eq]': '2026-10-01', limit: '100' });
      const rows: any[] = list.data;
      expect(rows).toHaveLength(8);
      const mill = rows.find((r) => r.machine_name === 'CNC Mill 01');
      const ticked = Array.from({ length: 31 }, (_, d) => mill[`day_${String(d + 1).padStart(2, '0')}`]).filter(Boolean).length;
      expect(Number(mill.days_met)).toBe(ticked);
      expect(Number(mill.gap_days)).toBe(26 - ticked);
      expect(Number(mill.attainment_pct)).toBeCloseTo(Math.round((ticked * 1000) / 26) / 10, 1);
      expect(mill.work_center).toBe('Machining');

      // Ticking a day in a form (record update) recalculates the totals
      const updated = await recordsService.updateRecord(tenantId, 'production_sheet', mill.id, { day_25: true });
      expect(Number(updated.days_met)).toBe(ticked + 1);

      // Renaming a machine flows into its sheets
      await recordsService.updateRecord(tenantId, 'machine', mill.machine, { name: 'CNC Mill 01A' });
      const after = await recordsService.getRecordById(tenantId, 'production_sheet', mill.id);
      expect(after.machine_name).toBe('CNC Mill 01A');
    });

    it('re-running updates the pages in place', async () => {
      const again = await seedProductionPages(tenantId, { today: new Date(2026, 9, 18) });
      expect(again.fieldsAdded).toBe(0);
      expect(again.pages.every((p) => !p.created)).toBe(true);
      expect(again.pages.map((p) => p.id)).toEqual(pagesResult.pages.map((p) => p.id));
    }, 120000);
  });
});
