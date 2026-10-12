import ExcelJS from 'exceljs';
import type {
  GridExportTemplateDefinition,
  GridSheetDefinition,
  GridCellDefinition,
  GridCellStyle,
} from '@config-platform/schema';

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
  public renderToWorkbook(template: GridExportTemplateDefinition): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ConfigPlatform Grid Engine';
    workbook.created = new Date();

    let hasUncachedFormula = false;

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
          if (cellDef.value === undefined || cellDef.value === null) {
            hasUncachedFormula = true;
          }
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

    if (hasUncachedFormula) {
      workbook.calcProperties.fullCalcOnLoad = true;
    }

    return workbook;
  }

  public async renderToBuffer(template: GridExportTemplateDefinition): Promise<Buffer> {
    const workbook = this.renderToWorkbook(template);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }
}

export const gridXlsxRenderer = new GridXlsxRenderer();

export async function renderGridTemplateToXlsxBuffer(
  template: GridExportTemplateDefinition
): Promise<Buffer> {
  return gridXlsxRenderer.renderToBuffer(template);
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

