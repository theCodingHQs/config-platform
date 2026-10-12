import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  gridXlsxRenderer,
  buildPersonalMonthlyBudgetBenchmark,
} from '../src/records/export/grid-xlsx-renderer.js';
import {
  GridExportTemplateDefinitionSchema,
} from '@config-platform/schema';

describe('ExcelJS Grid XLSX Renderer Benchmark (Personal Monthly Budget)', () => {
  it('validates benchmark template against kind: "grid" Zod schema', () => {
    const benchmark = buildPersonalMonthlyBudgetBenchmark();
    const parsed = GridExportTemplateDefinitionSchema.safeParse(benchmark);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      console.error(parsed.error);
    }
    expect(benchmark.kind).toBe('grid');
    expect(benchmark.sheets.length).toBe(1);
    expect(benchmark.sheets[0].name).toBe('Personal Budget');
  });

  it('renders benchmark to ExcelJS Workbook with all styles, merges, and formulas', () => {
    const benchmark = buildPersonalMonthlyBudgetBenchmark();
    const wb = gridXlsxRenderer.renderToWorkbook(benchmark);

    expect(wb.worksheets.length).toBe(1);
    const ws = wb.getWorksheet('Personal Budget');
    expect(ws).toBeDefined();

    // Check Banner row (A1)
    const bannerCell = ws!.getCell('A1');
    expect(bannerCell.value).toBe('Personal Monthly Budget');
    expect(bannerCell.font?.bold).toBe(true);
    expect(bannerCell.font?.size).toBe(20);
    expect(bannerCell.fill?.type).toBe('pattern');
    if (bannerCell.fill?.type === 'pattern') {
      expect((bannerCell.fill.fgColor as any)?.argb).toBe('FFC6D92D');
    }

    // Check Merges exist
    expect(benchmark.sheets[0].merges.length).toBeGreaterThan(10);

    // Check Formulas and results
    // Housing Total row 22 (A22:E22), Projected Cost at C22
    const housingProjectedTotal = ws!.getCell('C22');
    expect(typeof housingProjectedTotal.value).toBe('object');
    expect((housingProjectedTotal.value as any)?.formula).toBe('SUM(C12:C21)');
    expect((housingProjectedTotal.value as any)?.result).toBe(1810);
    expect(housingProjectedTotal.numFmt).toBe('$#,##0');

    // Difference formula at E12: C12-D12
    const diffCell = ws!.getCell('E12');
    expect((diffCell.value as any)?.formula).toBe('C12-D12');
    expect((diffCell.value as any)?.result).toBe(100);

    // Check Conditional Formatting rules were attached
    const cf = (ws as any).conditionalFormattings;
    expect(cf).toBeDefined();
    expect(cf.length).toBe(4);
    expect(cf[0].rules[0].type).toBe('iconSet');
    expect(cf[0].rules[0].iconSet).toBe('3TrafficLights1');
    expect(cf[0].rules[0].cfvo.length).toBe(3);
  });

  it('generates binary XLSX buffer that is re-readable by ExcelJS without corruption', async () => {
    const benchmark = buildPersonalMonthlyBudgetBenchmark();
    const buffer = await gridXlsxRenderer.renderToBuffer(benchmark);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);

    // Check ZIP magic bytes (PK\x03\x04)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // Re-load the generated buffer with ExcelJS to ensure it is not corrupt
    const readWb = new ExcelJS.Workbook();
    await readWb.xlsx.load(buffer as any);

    const reloadedSheet = readWb.getWorksheet('Personal Budget');
    expect(reloadedSheet).toBeDefined();
    expect(reloadedSheet!.getCell('A1').value).toBe('Personal Monthly Budget');
    expect(reloadedSheet!.getCell('C22').numFmt).toBe('$#,##0');
  });
});
