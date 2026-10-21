import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  type GridExportTemplateDefinition,
  buildProductionTrackerTemplate,
  buildGridStarterTemplate,
  GRID_STARTER_TEMPLATES,
  GridExportTemplateDefinitionSchema,
} from '@config-platform/schema';
import {
  gridXlsxRenderer,
  renderGridTemplateToXlsxBuffer,
  buildNativeChartSpecs,
  CHECKBOX_NUM_FMT,
  CHECKBOX_VALUES_SHEET,
} from '../src/records/export/grid-xlsx-renderer.js';
import { evaluateAndCacheSheetFormulas } from '../src/records/export/formula-evaluator.js';
import { buildChartXml, toAbsoluteSheetRef } from '../src/records/export/xlsx-native-charts.js';

// 1×1 transparent PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function chartParts(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const charts = Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f)).sort();
  return { zip, charts };
}

describe('Interactive grid templates: checkbox cells and native Excel charts', () => {
  it('production tracker template is schema-valid with checkbox cells and four range charts', () => {
    const template = buildProductionTrackerTemplate();
    const parsed = GridExportTemplateDefinitionSchema.safeParse(template);
    expect(parsed.success).toBe(true);

    const sheet = template.sheets[0];
    expect(sheet.dataValidations).toEqual([
      expect.objectContaining({ ref: 'C21:AG28', type: 'checkbox', checkedValue: 1, uncheckedValue: 0 }),
    ]);
    expect(template.charts).toHaveLength(4);
    expect(template.charts!.every((c) => c.source.kind === 'range')).toBe(true);
    expect(template.datasets).toEqual([]);
  });

  it('production tracker formulas react to checkbox values (met, gap, KPIs, donut data)', () => {
    const template = buildProductionTrackerTemplate();
    const sheet = structuredClone(template.sheets[0]);
    // Clear every checkbox, then tick 3 days for machine 1 (row 21, 26 planned days)
    for (let r = 20; r <= 27; r++) for (let c = 2; c <= 32; c++) sheet.cells[`${r}:${c}`].value = 0;
    sheet.cells['20:2'].value = 1;
    sheet.cells['20:3'].value = 1;
    sheet.cells['20:4'].value = 1;
    evaluateAndCacheSheetFormulas(sheet);

    expect(sheet.cells['20:33'].value).toBe(3); // MET
    expect(sheet.cells['20:34'].value).toBe(23); // GAP = 26 - 3
    expect(sheet.cells['20:35'].value).toBe(0.12); // ATTAINMENT = ROUND(3/26, 2)
    expect(sheet.cells['3:10'].value).toBe(3); // TARGETS MET KPI
    expect(sheet.cells['28:2'].value).toBe(1); // machines on target on day 1
    expect(sheet.cells['29:2'].value).toBe(13); // daily % = ROUND(1*100/8)
    expect(sheet.cells['30:2'].value).toBe(1); // week 1 series picks up day 1
    expect(sheet.cells['2:38'].value).toBe(3); // donut "Target met" (AM3)
  });

  it('template export stores evaluated formula results and makes Excel recalculate on open', async () => {
    // Regression: formula cells carried placeholder 0 values, and without a recalc flag Excel
    // showed 0 KPIs/totals until the user edited a cell (verified in Microsoft Excel).
    const buffer = await renderGridTemplateToXlsxBuffer(buildProductionTrackerTemplate());
    // ExcelJS doesn't read calcPr back on load, so check the workbook XML directly
    const workbookXml = await (await JSZip.loadAsync(buffer)).file('xl/workbook.xml')!.async('string');
    expect(workbookXml).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const ws = wb.worksheets[0];
    const ticked = Array.from({ length: 31 }, (_, i) => ws.getCell(21, 3 + i).value).filter((v) => v === 1).length;
    const met = ws.getCell('AH21').value as { formula: string; result: number };
    expect(met.formula).toBe('SUM(C21:AG21)');
    expect(met.result).toBe(ticked);
    expect(ticked).toBeGreaterThan(0);
    expect((ws.getCell('K4').value as { result: number }).result).toBeGreaterThan(0);

    // Checkbox cells: ☑/☐ display format plus a dropdown whose choices are real numbers.
    // Regression: a literal "1,0" list holds text, so Excel rejected a typed 1 (a number).
    expect(ws.getCell('C21').numFmt).toBe(CHECKBOX_NUM_FMT);
    const dv = (ws as any).dataValidations.find('C21');
    expect(dv).toMatchObject({ type: 'list', formulae: [`'${CHECKBOX_VALUES_SHEET}'!$A$1:$A$2`] });
    const values = wb.getWorksheet(CHECKBOX_VALUES_SHEET)!;
    expect(values.state).toBe('veryHidden');
    expect(values.getCell('A1').value).toBe(1); // numbers, not text
    expect(values.getCell('A2').value).toBe(0);
    // The template's own sheet stays first; the helper sheet is last
    expect(wb.worksheets[0].name).toBe(ws.name);
    expect(wb.worksheets.at(-1)!.name).toBe(CHECKBOX_VALUES_SHEET);
  });

  it('checkbox ranges with different checked/unchecked values each get their own numeric list', () => {
    const wb = gridXlsxRenderer.renderToWorkbook({
      kind: 'grid',
      version: 1,
      sheets: [{
        id: 's', name: 'S', order: 0, cells: {},
        dataValidations: [
          { ref: 'A1:A3', type: 'checkbox', checkedValue: 1, uncheckedValue: 0 },
          { ref: 'B1:B3', type: 'checkbox', checkedValue: 10, uncheckedValue: -1 },
          { ref: 'C1:C3', type: 'checkbox', checkedValue: 1, uncheckedValue: 0 },
        ],
      }],
    } as GridExportTemplateDefinition);
    const ws = wb.getWorksheet('S') as any;
    expect(ws.dataValidations.model['A1:A3'].formulae).toEqual([`'${CHECKBOX_VALUES_SHEET}'!$A$1:$A$2`]);
    expect(ws.dataValidations.model['B1:B3'].formulae).toEqual([`'${CHECKBOX_VALUES_SHEET}'!$B$1:$B$2`]);
    expect(ws.dataValidations.model['C1:C3'].formulae).toEqual([`'${CHECKBOX_VALUES_SHEET}'!$A$1:$A$2`]);
    const values = wb.getWorksheet(CHECKBOX_VALUES_SHEET)!;
    expect([values.getCell('B1').value, values.getCell('B2').value]).toEqual([10, -1]);
  });

  it('workbooks without checkboxes get no helper sheet', () => {
    const wb = gridXlsxRenderer.renderToWorkbook({
      kind: 'grid', version: 1, sheets: [{ id: 's', name: 'S', order: 0, cells: { '0:0': { value: 1 } } }],
    } as GridExportTemplateDefinition);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['S']);
  });

  it('any workbook with formulas recalculates on open, even with stored values', () => {
    const wb = gridXlsxRenderer.renderToWorkbook({
      kind: 'grid',
      version: 1,
      sheets: [{ id: 's', name: 'S', order: 0, cells: { '0:0': { value: 2 }, '0:1': { formula: '=A1*2', value: 0 } } }],
    } as GridExportTemplateDefinition);
    expect(wb.calcProperties.fullCalcOnLoad).toBe(true);
  });

  it('exports native, cell-referencing charts plus a single checkbox validation', async () => {
    const template = buildProductionTrackerTemplate();
    const buffer = await renderGridTemplateToXlsxBuffer(template);
    const { zip, charts } = await chartParts(buffer);
    expect(charts).toHaveLength(4);

    const xml = await Promise.all(charts.map((p) => zip.file(p)!.async('string')));
    const all = xml.join('\n');
    expect(all).toContain('<c:areaChart>');
    expect(all).toContain('<c:doughnutChart>');
    expect(all).toContain('<c:grouping val="stacked"/>');
    // Series read the formula rows the checkboxes feed
    expect(all).toContain('&apos;Production Tracker&apos;!$C$30:$AG$30');
    expect(all).toContain('&apos;Production Tracker&apos;!$AH$21:$AH$28');
    // Donut slice colours come from options.sliceColors
    expect(all).toContain('<a:srgbClr val="10B981">');
    expect(all).toContain('<a:srgbClr val="CBD5E1">');

    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheetXml.match(/<dataValidation /g)).toHaveLength(1);
    expect(sheetXml).toContain('sqref="C21:AG28"');
    expect(sheetXml).toMatch(/<drawing r:id="rId\d+"\/>/);

    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('/xl/charts/chart1.xml');
    expect(ct).toContain('application/vnd.openxmlformats-officedocument.drawing+xml');

    // Still a workbook ExcelJS can read, with ☑/☐ formatting on checkbox cells
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Production Tracker')!;
    expect(ws.getCell('C21').numFmt).toBe(CHECKBOX_NUM_FMT);
    expect(ws.getCell('AG28').value).toBe(0);
  });

  it('caches computed values in native charts so they render before Excel recalculates', async () => {
    const template = buildProductionTrackerTemplate();
    const sheets = structuredClone(template.sheets);
    sheets.forEach((s) => evaluateAndCacheSheetFormulas(s));
    const specs = buildNativeChartSpecs(template, sheets);
    const donut = specs.find((s) => s.chart.id === 'chart_production_overall')!;
    const completed = Number(sheets[0].cells['3:10'].value);
    const remaining = Number(sheets[0].cells['3:18'].value);
    expect(donut.data.series[0].data).toEqual([completed, remaining]);
    expect(completed).toBeGreaterThan(0);

    const xml = buildChartXml(donut)!;
    expect(xml).toContain(`<c:v>${completed}</c:v>`);
    expect(xml).toContain('<c:v>Target met</c:v>');
  });

  it('appends native charts to the drawing ExcelJS writes for PNG charts on the same sheet', async () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 3,
      parameters: [],
      datasets: [],
      charts: [
        {
          id: 'png_chart',
          title: 'Snapshot',
          type: 'bar',
          source: { kind: 'range', sheetId: 's1', categoryRange: 'A1:A3', series: [{ name: 'V', range: 'B1:B3' }] },
          anchor: { sheetId: 's1', startRow: 0, startCol: 3, endRow: 8, endCol: 7 },
          options: {},
        },
        {
          id: 'native_chart',
          title: "Owner's Trend",
          type: 'line',
          source: { kind: 'range', sheetId: 's1', categoryRange: 'A1:A3', series: [{ name: 'V', range: 'B1:B3' }] },
          anchor: { sheetId: 's1', startRow: 10, startCol: 3, endRow: 18, endCol: 7 },
          options: { smooth: true },
        },
      ],
      sheets: [
        {
          id: 's1',
          name: "Ops' Q1",
          order: 0,
          merges: [],
          regions: [],
          conditionalFormats: [],
          cells: {
            '0:0': { value: 'Jan' },
            '1:0': { value: 'Feb' },
            '2:0': { value: 'Mar' },
            '0:1': { value: 3 },
            '1:1': { value: 5 },
            '2:1': { value: 8 },
          },
        },
      ],
      filenameExpression: '"mixed"',
      pdf: { mode: 'table' },
    };

    const specs = buildNativeChartSpecs(template).filter((s) => s.chart.id === 'native_chart');
    const buffer = await gridXlsxRenderer.renderToBuffer(template, new Map([['png_chart', PNG_1PX]]), specs);
    const { zip, charts } = await chartParts(buffer);
    expect(charts).toEqual(['xl/charts/chart1.xml']);

    const drawings = Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
    expect(drawings).toHaveLength(1);
    const drawingXml = await zip.file(drawings[0])!.async('string');
    expect(drawingXml).toContain('<xdr:pic>'); // ExcelJS PNG kept
    expect(drawingXml).toContain('<xdr:graphicFrame'); // native chart appended
    const rels = await zip.file(drawings[0].replace('drawings/', 'drawings/_rels/') + '.rels')!.async('string');
    expect(rels).toContain('relationships/image');
    expect(rels).toContain('relationships/chart');

    // Sheet names with quotes are escaped in references
    expect(toAbsoluteSheetRef("Ops' Q1", 'B1:B3')).toBe("'Ops'' Q1'!$B$1:$B$3");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet("Ops' Q1")!.getImages()).toHaveLength(1);
  });

  it('entity starter templates include grouped-dataset charts that do not stretch with the region', () => {
    const entity = {
      id: 'ent_orders',
      name: 'orders',
      label: 'Orders',
      fields: [
        { id: 'f1', name: 'status', type: 'text' },
        { id: 'f2', name: 'owner', type: 'text' },
        { id: 'f3', name: 'amount', type: 'currency' },
        { id: 'f4', name: 'order_date', type: 'date' },
      ],
    };

    for (const starter of GRID_STARTER_TEMPLATES.filter((s) => s.category === 'data')) {
      const template = buildGridStarterTemplate(entity, starter.id);
      expect(GridExportTemplateDefinitionSchema.safeParse(template).success).toBe(true);
      expect(template.charts!.length).toBe(2);

      const region = template.sheets[0].regions[0];
      for (const chart of template.charts!) {
        expect(chart.source.kind).toBe('dataset');
        if (chart.source.kind !== 'dataset') continue;
        const ds = template.datasets.find((d) => d.id === chart.source.datasetId)!;
        expect(ds.groupBy).toHaveLength(1);
        expect(chart.source.category).toBe(ds.groupBy[0].fieldPath);
        // Anchors start above or below the repeating region, never inside it
        const inside = chart.anchor.startRow >= region.startRow && chart.anchor.startRow <= region.endRow;
        expect(inside).toBe(false);
      }
    }

    const ops = buildGridStarterTemplate(entity, 'operations');
    expect(ops.charts![0].type).toBe('donut');
    expect(ops.charts![0].title).toBe('Records by status');
    const fin = buildGridStarterTemplate(entity, 'financial');
    expect(fin.charts![0].title).toBe('Total amount per month');
    const finDs = fin.datasets.find((d) => d.id === 'ds_chart_1')!;
    expect(finDs.sort).toEqual([{ fieldPath: 'order_date', direction: 'asc' }]);
  });

  it('entity with no chartable fields gets no charts', () => {
    const template = buildGridStarterTemplate({ id: 'e', name: 'notes', fields: [{ id: 'x', name: 'body', type: 'text' }] }, 'executive');
    expect(template.charts).toEqual([]);
  });
});
