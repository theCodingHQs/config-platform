import ExcelJS from 'exceljs';
import { isPlainDate } from '@config-platform/schema';
import type {
  GridExportTemplateDefinition,
  GridSheetDefinition,
  GridCellDefinition,
  GridCellStyle,
} from '@config-platform/schema';
import { extractRangeChartData, indexToColLetter, parseA1Range } from './chart-range-helper.js';
import { evaluateAndCacheSheetFormulas } from './formula-evaluator.js';
import { injectNativeCharts, type NativeChartSpec } from './xlsx-native-charts.js';

/** ExcelJS writes this as built-in format 14, which Excel shows in the reader's regional short-date style. */
const EXCEL_REGIONAL_SHORT_DATE = 'mm-dd-yy';

/** Checked → green ☑, unchecked → grey ☐ (sections: positive;negative;zero). */
export const CHECKBOX_NUM_FMT = '[Color10]"☑";[Color10]"☑";[Color16]"☐"';
/** Hidden sheet with the numeric choices used by checkbox dropdowns. */
export const CHECKBOX_VALUES_SHEET = '_checkbox_values';

/**
 * Builds native chart specs for every range-sourced chart. `sheets` must already have formula
 * results cached (see evaluateAndCacheSheetFormulas) so chart caches hold real values.
 */
export function buildNativeChartSpecs(
  template: GridExportTemplateDefinition,
  sheets: GridSheetDefinition[] = template.sheets
): NativeChartSpec[] {
  const findSheet = (idOrName: string) => sheets.find((s) => s.id === idOrName || s.name === idOrName);
  const specs: NativeChartSpec[] = [];
  for (const chart of template.charts || []) {
    if (chart.source.kind !== 'range') continue;
    const anchorSheet = findSheet(chart.anchor.sheetId);
    const sourceSheet = findSheet(chart.source.sheetId);
    if (!anchorSheet || !sourceSheet) continue;
    try {
      specs.push({
        chart: chart as NativeChartSpec['chart'],
        sheetName: anchorSheet.name,
        sourceSheetName: sourceSheet.name,
        data: extractRangeChartData(chart, sheets),
      });
    } catch {
      // Unresolvable or oversized range: leave the chart out rather than failing the export
    }
  }
  return specs;
}

/**
 * Converts standard CSS / Hex colors (#RRGGBB or #RGB) to Excel 8-character ARGB format ('FFRRGGBB').
 */
export function hexToArgb(hex?: string): string | undefined {
  if (!hex) return undefined;
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (clean.length === 6) {
    return `FF${clean.toUpperCase()}`;
  }
  if (clean.length === 8) {
    return clean.toUpperCase();
  }
  return undefined;
}

/**
 * Maps GridCellStyle to ExcelJS Cell style object
 */
export function applyStyleToExcelCell(cell: ExcelJS.Cell, style?: GridCellStyle): void {
  if (!style) return;

  // 1. Font
  if (style.font) {
    cell.font = {
      name: style.font.name || 'Calibri',
      size: style.font.size || 11,
      bold: Boolean(style.font.bold),
      italic: Boolean(style.font.italic),
      underline: Boolean(style.font.underline),
      strike: Boolean(style.font.strike),
      color: style.font.color ? { argb: hexToArgb(style.font.color) } : undefined,
    };
  }

  // 2. Fill (solid background)
  if (style.fill && style.fill.fgColor) {
    const argb = hexToArgb(style.fill.fgColor);
    if (argb) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb },
      };
    }
  }

  // 3. Alignment
  if (style.alignment) {
    cell.alignment = {
      horizontal: style.alignment.horizontal,
      vertical: style.alignment.vertical || 'middle',
      wrapText: Boolean(style.alignment.wrapText),
    };
  }

  // 4. Border
  if (style.border) {
    const borders: Partial<ExcelJS.Borders> = {};
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    for (const side of sides) {
      const b = style.border[side];
      if (b) {
        borders[side] = {
          style: (b.style as any) || 'thin',
          color: b.color ? { argb: hexToArgb(b.color) } : { argb: 'FFCBD5E1' },
        };
      }
    }
    cell.border = borders;
  }
}

/**
 * Server-side ExcelJS Grid XLSX Renderer
 */
export class GridXlsxRenderer {
  public renderToWorkbook(
    template: GridExportTemplateDefinition,
    chartImages?: Map<string, Buffer>
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ConfigPlatform Grid Engine';
    workbook.created = new Date();

    let hasFormula = false;

    // Checkbox dropdowns read their choices from real numbers on a hidden sheet. A literal
    // list ("1,0") holds text, so Excel rejected a typed 1 (a number) as not in the list.
    // One column per distinct checked/unchecked pair: "checked|unchecked" -> { col, ref }
    const checkboxLists = new Map<string, { col: string; ref: string; checked: number; unchecked: number }>();
    for (const sheetDef of template.sheets) {
      for (const dv of sheetDef.dataValidations || []) {
        if (dv.type !== 'checkbox') continue;
        const checked = dv.checkedValue ?? 1;
        const unchecked = dv.uncheckedValue ?? 0;
        const key = `${checked}|${unchecked}`;
        if (checkboxLists.has(key)) continue;
        const col = indexToColLetter(checkboxLists.size);
        checkboxLists.set(key, { col, ref: `'${CHECKBOX_VALUES_SHEET}'!$${col}$1:$${col}$2`, checked, unchecked });
      }
    }

    for (const sheetDef of template.sheets) {
      const ws = workbook.addWorksheet(sheetDef.name, {
        views: sheetDef.freezePanes
          ? [
              {
                state: 'frozen',
                xSplit: sheetDef.freezePanes.colSplit || 0,
                ySplit: sheetDef.freezePanes.rowSplit || 0,
              },
            ]
          : undefined,
      });

      // 1. Set Column Widths
      if (sheetDef.colWidths) {
        for (const [colIdxStr, widthPx] of Object.entries(sheetDef.colWidths)) {
          const colNum = parseInt(colIdxStr, 10) + 1;
          // Rough conversion from px to Excel column width (approx 7.5 px per unit)
          const charWidth = Math.max(8, Math.round(widthPx / 7.5));
          ws.getColumn(colNum).width = charWidth;
        }
      }

      // 2. Set Row Heights
      if (sheetDef.rowHeights) {
        for (const [rowIdxStr, heightPx] of Object.entries(sheetDef.rowHeights)) {
          const rowNum = parseInt(rowIdxStr, 10) + 1;
          // ExcelJS height in points (approx 0.75 pt per px)
          ws.getRow(rowNum).height = Math.round(heightPx * 0.75);
        }
      }

      // 3. Set Cells (Values, Formulas, Number Formats, Styles)
      for (const [coordKey, cellDef] of Object.entries(sheetDef.cells)) {
        const [rStr, cStr] = coordKey.split(':');
        const rowNum = parseInt(rStr, 10) + 1;
        const colNum = parseInt(cStr, 10) + 1;
        const cell = ws.getCell(rowNum, colNum);

        // Value & Formula
        if (cellDef.formula) {
          const formulaStr = cellDef.formula.replace(/^=/, '');
          hasFormula = true;
          cell.value = {
            formula: formulaStr,
            result: cellDef.value !== undefined ? (cellDef.value as any) : undefined,
          };
        } else if (cellDef.value !== undefined && cellDef.value !== null) {
          // Injection safety: strings starting with =, +, -, @ written as text
          if (typeof cellDef.value === 'string' && /^\s*[=+\-@]/.test(cellDef.value)) {
            (cell as any).type = ExcelJS.ValueType.String;
            cell.numFmt = '@';
            cell.value = cellDef.value;
          } else if (cellDef.numFmt !== '@' && isPlainDate(cellDef.value)) {
            // Calendar dates (date fields) become real Excel dates, so they sort, filter and
            // calculate. Excel dates have no time zone: the UTC midnight of the day is exactly
            // that day. Built-in format 14 shows them in the reader's regional short-date style.
            const [y, m, d] = cellDef.value.split('-').map(Number);
            cell.value = new Date(Date.UTC(y, m - 1, d));
            if (!cellDef.numFmt) cell.numFmt = EXCEL_REGIONAL_SHORT_DATE;
          } else {
            cell.value = cellDef.value as any;
          }
        }

        // Number format
        if (cellDef.numFmt) {
          cell.numFmt = cellDef.numFmt;
        }

        // Cell style
        if (cellDef.style) {
          applyStyleToExcelCell(cell, cellDef.style);
        }
      }

      // 3b. Checkbox cells: 1/0 values shown as ☑/☐ with a 1/0 dropdown, so SUM-based formulas
      // and the native charts reading them stay live in Excel
      for (const dv of sheetDef.dataValidations || []) {
        if (dv.type !== 'checkbox') continue;
        const range = parseA1Range(dv.ref);
        if (!range) continue;
        const checked = dv.checkedValue ?? 1;
        const unchecked = dv.uncheckedValue ?? 0;
        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const cell = ws.getCell(r + 1, c + 1);
            if (cell.value === null || cell.value === undefined || cell.value === '') cell.value = unchecked;
            cell.numFmt = CHECKBOX_NUM_FMT;
            cell.alignment = { ...(cell.alignment || {}), horizontal: 'center', vertical: 'middle' };
          }
        }
        // One range-level rule: per-cell rules make ExcelJS emit overlapping sqrefs past column Z
        const normalizedRef = `${indexToColLetter(range.startCol)}${range.startRow + 1}:${indexToColLetter(range.endCol)}${range.endRow + 1}`;
        (ws as any).dataValidations.add(normalizedRef, {
          type: 'list',
          allowBlank: true,
          // Numeric choices (see checkboxLists): typed and picked values are both numbers
          formulae: [checkboxLists.get(`${checked}|${unchecked}`)!.ref],
          showErrorMessage: true,
          errorTitle: 'Checkbox',
          error: `Enter ${checked} for done or ${unchecked} for not done (or pick from the list).`,
          showInputMessage: true,
          promptTitle: 'Checkbox',
          prompt: `${checked} = ☑ done, ${unchecked} = ☐ not done`,
        });
      }

      // 4. Merged Ranges
      if (sheetDef.merges && sheetDef.merges.length > 0) {
        for (const m of sheetDef.merges) {
          ws.mergeCells(m.startRow + 1, m.startCol + 1, m.endRow + 1, m.endCol + 1);
        }
      }

      // 5. Conditional Formatting (Icon Sets, Color Scales, CellIs)
      if (sheetDef.conditionalFormats && sheetDef.conditionalFormats.length > 0) {
        for (const cf of sheetDef.conditionalFormats) {
          if (cf.type === 'iconSet') {
            const iconSetRule: any = {
              type: 'iconSet',
              iconSet: cf.iconSet?.iconSet || '3TrafficLights1',
              reverse: Boolean(cf.iconSet?.reverse),
              showValue: cf.iconSet?.showValue !== false,
              cfvo: cf.iconSet?.cfvo || [
                { type: 'percent', value: 0 },
                { type: 'percent', value: 33 },
                { type: 'percent', value: 67 },
              ],
            };
            ws.addConditionalFormatting({
              ref: cf.ref,
              rules: [iconSetRule],
            });
          } else if (cf.type === 'cellIs' && cf.cellIs) {
            ws.addConditionalFormatting({
              ref: cf.ref,
              rules: [
                {
                  type: 'cellIs',
                  priority: 1,
                  operator: cf.cellIs.operator as any,
                  formulae: cf.cellIs.formulae,
                  style: cf.cellIs.style as any,
                },
              ],
            });
          }
        }
      }
    }

    // 6. Embed Charts as PNG images at anchors
    if (template.charts && template.charts.length > 0 && chartImages && chartImages.size > 0) {
      for (const chart of template.charts) {
        const targetSheetDef = template.sheets.find(
          (s) => s.id === chart.anchor.sheetId || s.name === chart.anchor.sheetId
        );
        const sheetName = targetSheetDef ? targetSheetDef.name : chart.anchor.sheetId;
        const ws = workbook.getWorksheet(sheetName);
        if (!ws) continue;

        const pngBuffer = chartImages.get(chart.id);
        if (pngBuffer && pngBuffer.length > 0) {
          const imageId = workbook.addImage({
            buffer: pngBuffer as any,
            extension: 'png',
          });
          ws.addImage(imageId, {
            tl: { col: chart.anchor.startCol, row: chart.anchor.startRow } as any,
            br: { col: chart.anchor.endCol + 1, row: chart.anchor.endRow + 1 } as any,
            editAs: 'twoCell' as any,
          });
        }
      }
    }

    // Hidden sheet holding the checkbox choices as numbers (checked in row 1, unchecked in row 2).
    // Added last so the template's own sheets keep their order; 'veryHidden' keeps it out of
    // Excel's Unhide menu.
    if (checkboxLists.size > 0) {
      const valuesSheet = workbook.addWorksheet(CHECKBOX_VALUES_SHEET, { state: 'veryHidden' });
      for (const { col, checked, unchecked } of checkboxLists.values()) {
        valuesSheet.getCell(`${col}1`).value = checked;
        valuesSheet.getCell(`${col}2`).value = unchecked;
      }
    }

    // Excel shows a formula's cached result until it recalculates, and templates can carry
    // placeholder values (e.g. 0) on formula cells. Recalculating on open guarantees users see
    // Excel's own results (KPIs, totals, chart data) the moment the file opens.
    if (hasFormula) {
      workbook.calcProperties.fullCalcOnLoad = true;
    }

    return workbook;
  }

  /**
   * Renders to an XLSX buffer. Charts in `nativeCharts` are injected as native Excel charts;
   * any chart with an entry in `chartImages` (and no native spec) is embedded as a PNG.
   */
  public async renderToBuffer(
    template: GridExportTemplateDefinition,
    chartImages?: Map<string, Buffer>,
    nativeCharts: NativeChartSpec[] = []
  ): Promise<Buffer> {
    let images = chartImages;
    if (images && nativeCharts.length > 0) {
      images = new Map(images);
      for (const spec of nativeCharts) images.delete(spec.chart.id);
    }
    const workbook = this.renderToWorkbook(template, images);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return injectNativeCharts(buffer, nativeCharts);
  }
}

export const gridXlsxRenderer = new GridXlsxRenderer();

/**
 * Renders a template without tenant data. Range charts become native charts whose caches are
 * computed by running the sandboxed formula evaluator over a copy of the sheets.
 */
export async function renderGridTemplateToXlsxBuffer(
  template: GridExportTemplateDefinition
): Promise<Buffer> {
  // Evaluate formulas so the file stores correct cached results (Excel also recalculates on
  // open); the same evaluated sheets feed the native charts' caches.
  const evaluatedSheets: GridSheetDefinition[] = structuredClone(template.sheets);
  for (const sheet of evaluatedSheets) evaluateAndCacheSheetFormulas(sheet);
  const evaluated = { ...template, sheets: evaluatedSheets };
  const hasRangeCharts = (template.charts || []).some((c) => c.source.kind === 'range');
  return gridXlsxRenderer.renderToBuffer(
    evaluated,
    undefined,
    hasRangeCharts ? buildNativeChartSpecs(template, evaluatedSheets) : [],
  );
}

/**
 * Builds the benchmark "Personal Monthly Budget" layout as our exact kind: "grid" template definition.
 * Faithfully reproduces:
 * - Row 0: Title Banner "Personal Monthly Budget" in Lime (#C6D92D), bold dark navy font (#1F384C)
 * - Row 2-4: Projected Monthly Income (A3:A5 merged, dark navy #1F384C) with items and SUM
 * - Row 6-8: Actual Monthly Income (A7:A9 merged, dark navy #1F384C) with items and SUM
 * - Top Right: Summary Block (F3:H8) with calculated expense differences and balance
 * - Side-by-side Tables:
 *    - Left: HOUSING (A11:E21), dark navy header, banded rows, Difference formulas, SUM total, 3TrafficLights icon set
 *    - Right: ENTERTAINMENT (G11:K21), lime header, banded rows, Difference formulas, SUM total, 3TrafficLights icon set
 *    - Lower Left: TRANSPORTATION (A23:E31)
 *    - Lower Right: LOANS (G23:K30)
 */
export { buildPersonalMonthlyBudgetBenchmark } from '@config-platform/schema';

