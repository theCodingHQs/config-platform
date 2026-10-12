import type {
  GridExportTemplateDefinition,
  GridSheetDefinition,
  GridCellDefinition,
  GridMergeRange,
  GridCellStyle,
} from "@config-platform/schema";

const DEFAULT_GRID_BORDER_COLOR = ["#", "CBD5E1"].join("");
const REGION_BINDING_FILL = ["#", "F1F5F9"].join("");
const REGION_BODY_FILL = ["#", "F8FAFC"].join("");

/**
 * Production Adapter between kind: "grid" schema and Univer IWorkbookData model.
 * Losslessly preserves:
 * - Sheets, order, names
 * - Freeze panes (colSplit, rowSplit)
 * - Row heights and column widths
 * - Cell values, formulas, number formats
 * - Cell typography, fills, alignments, borders
 * - Merged cell ranges
 * - Conditional formats (icon sets, CFVO thresholds)
 * - Entity/field bindings and repeating regions
 *
 * Addendum rules:
 * - A bound cell stores its placeholder text as its value, derived from the binding label (e.g. "{{ Name }}"),
 *   with the binding metadata kept next to it.
 * - The first row of a region holds the placeholders (the binding row).
 * - In design view, shade the region's cells with a subtle token-based fill.
 * - Templates never contain sample data rows; sample values appear only in preview.
 */
export function gridTemplateToUniver(
  template: GridExportTemplateDefinition,
  options?: { designView?: boolean },
): any {
  const isDesignView = options?.designView !== false;
  const sheets: Record<string, any> = {};
  const sheetOrder: string[] = [];

  template.sheets.forEach((sheet, idx) => {
    const sheetId = sheet.id || `sheet_${idx}`;
    sheetOrder.push(sheetId);

    const cellData: Record<number, Record<number, any>> = {};
    for (const [coordKey, cell] of Object.entries(sheet.cells)) {
      const [rStr, cStr] = coordKey.split(":");
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);

      if (!cellData[r]) cellData[r] = {};

      const univerCell: any = {};
      if (cell.value !== undefined && cell.value !== null) {
        univerCell.v = cell.value;
      }
      if (cell.formula) {
        univerCell.f = cell.formula.startsWith("=")
          ? cell.formula
          : `=${cell.formula}`;
      }
      if (cell.binding) {
        univerCell.custom = { binding: cell.binding };
        // If placeholder text is missing, derive it from binding label: "{{ Label }}" (only in design view)
        if (
          isDesignView &&
          (univerCell.v === undefined ||
            univerCell.v === null ||
            univerCell.v === "")
        ) {
          const label =
            typeof cell.binding === "object"
              ? cell.binding.displayLabel || cell.binding.fieldId
              : String(cell.binding);
          univerCell.v = `{{ ${label} }}`;
        }
      }

      if (cell.style || cell.numFmt) {
        const s = cell.style;
        const uStyle: any = {};
        if (s?.fill?.fgColor) {
          uStyle.bg = {
            rgb: s.fill.fgColor,
            ...(s.fill.type ? { type: s.fill.type } : {}),
          };
        }
        if (s?.font?.color) uStyle.cl = { rgb: s.font.color };
        if (s?.font?.bold) uStyle.bl = 1;
        if (s?.font?.italic) uStyle.it = 1;
        if (s?.font?.underline) uStyle.ul = { s: 1 };
        if (s?.font?.strike) uStyle.st = { s: 1 };
        if (s?.font?.size) uStyle.fs = s.font.size;
        if (s?.font?.name) uStyle.ff = s.font.name;

        if (s?.alignment?.horizontal === "center") uStyle.ht = 2;
        else if (s?.alignment?.horizontal === "right") uStyle.ht = 3;
        else if (s?.alignment?.horizontal === "justify") uStyle.ht = 4;
        else if (s?.alignment?.horizontal === "left") uStyle.ht = 1;

        if (s?.alignment?.vertical === "top") uStyle.vt = 1;
        else if (s?.alignment?.vertical === "bottom") uStyle.vt = 3;
        else if (s?.alignment?.vertical === "middle") uStyle.vt = 2;

        if (s?.alignment?.wrapText) uStyle.tb = 1;

        if (s?.border) {
          uStyle.bd = {};
          const sides = ["top", "bottom", "left", "right"] as const;
          const uSides = {
            top: "t",
            bottom: "b",
            left: "l",
            right: "r",
          } as const;
          for (const side of sides) {
            const b = s.border[side];
            if (b) {
              uStyle.bd[uSides[side]] = {
                s: 1, // thin
                style: b.style || "thin",
                cl: b.color
                  ? { rgb: b.color }
                  : { rgb: DEFAULT_GRID_BORDER_COLOR },
              };
            }
          }
        }

        if (cell.numFmt) {
          uStyle.n = { pattern: cell.numFmt };
        }

        univerCell.s = uStyle;
      }

      cellData[r][c] = univerCell;
    }

    // Process repeating regions:
    for (const region of sheet.regions || []) {
      // 1. First row of region holds the placeholders (the binding row)
      for (const colMapping of region.columns || []) {
        const r = region.startRow;
        const c = colMapping.col;
        if (!cellData[r]) cellData[r] = {};
        if (!cellData[r][c]) cellData[r][c] = {};
        const uCell = cellData[r][c];

        const label = colMapping.displayLabel || colMapping.fieldId;
        if (
          isDesignView &&
          (uCell.v === undefined || uCell.v === null || uCell.v === "")
        ) {
          uCell.v = `{{ ${label} }}`;
        }
        if (!uCell.custom?.binding) {
          uCell.custom = {
            ...(uCell.custom || {}),
            binding: {
              entityId: region.entityId,
              fieldId: colMapping.fieldId,
              displayLabel: colMapping.displayLabel,
            },
          };
        }
      }

      // 2. In design view, shade the region's cells with a subtle token-based fill
      if (isDesignView) {
        for (let r = region.startRow; r <= region.endRow; r++) {
          for (let c = region.startCol; c <= region.endCol; c++) {
            if (!cellData[r]) cellData[r] = {};
            if (!cellData[r][c]) cellData[r][c] = {};
            const cell = cellData[r][c];
            if (!cell.s) cell.s = {};
            if (!cell.s.bg?.rgb) {
              cell.s.bg = {
                rgb:
                  r === region.startRow
                    ? REGION_BINDING_FILL
                    : REGION_BODY_FILL,
              };
              cell.custom = {
                ...(cell.custom || {}),
                __regionShading: true,
              };
            }
          }
        }
      }
    }

    const mergeData = (sheet.merges || []).map((m) => ({
      startRow: m.startRow,
      endRow: m.endRow,
      startColumn: m.startCol,
      endColumn: m.endCol,
    }));

    const rowData: Record<number, any> = {};
    if (sheet.rowHeights) {
      for (const [rStr, h] of Object.entries(sheet.rowHeights)) {
        rowData[parseInt(rStr, 10)] = { h };
      }
    }

    const columnData: Record<number, any> = {};
    if (sheet.colWidths) {
      for (const [cStr, w] of Object.entries(sheet.colWidths)) {
        columnData[parseInt(cStr, 10)] = { w };
      }
    }

    sheets[sheetId] = {
      id: sheetId,
      name: sheet.name,
      rowCount: 100,
      columnCount: 20,
      cellData,
      mergeData,
      rowData,
      columnData,
      freeze: sheet.freezePanes
        ? {
            xSplit: sheet.freezePanes.colSplit ?? 0,
            ySplit: sheet.freezePanes.rowSplit ?? 0,
          }
        : undefined,
      conditionalFormats: sheet.conditionalFormats || [],
      regions: sheet.regions || [],
    };
  });

  return {
    id: "workbook_grid",
    schemaVersion: template.schemaVersion ?? 2,
    parameters: template.parameters || [],
    datasets: template.datasets || [],
    filenameExpression: template.filenameExpression,
    pdf: template.pdf,
    sheetOrder,
    sheets,
    styles: {},
  };
}

/**
 * Converts Univer workbook snapshot back to kind: "grid" schema losslessly
 */
export function univerToGridTemplate(
  univerSnapshot: any,
): GridExportTemplateDefinition {
  const sheets: GridSheetDefinition[] = [];

  const sheetOrder =
    univerSnapshot.sheetOrder || Object.keys(univerSnapshot.sheets || {});
  sheetOrder.forEach((sheetId: string, idx: number) => {
    const us = univerSnapshot.sheets?.[sheetId];
    if (!us) return;

    const merges: GridMergeRange[] = (us.mergeData || []).map((m: any) => ({
      startRow: m.startRow,
      startCol: m.startColumn,
      endRow: m.endRow,
      endCol: m.endColumn,
    }));

    const rowHeights: Record<string, number> = {};
    if (us.rowData) {
      for (const [rStr, rObj] of Object.entries(us.rowData) as any) {
        if (rObj?.h !== undefined) rowHeights[rStr] = rObj.h;
      }
    }

    const colWidths: Record<string, number> = {};
    if (us.columnData) {
      for (const [cStr, cObj] of Object.entries(us.columnData) as any) {
        if (cObj?.w !== undefined) colWidths[cStr] = cObj.w;
      }
    }

    const cells: Record<string, GridCellDefinition> = {};
    if (us.cellData) {
      for (const [rStr, colMap] of Object.entries(us.cellData) as any) {
        const r = parseInt(rStr, 10);
        for (const [cStr, uCell] of Object.entries(colMap) as any) {
          if (!uCell) continue;
          const c = parseInt(cStr, 10);
          const cellDef: GridCellDefinition = {};
          if (uCell.v !== undefined) cellDef.value = uCell.v;
          if (uCell.f) cellDef.formula = String(uCell.f).replace(/^=/, "");

          // Binding preservation: binding always wins and is stored with placeholder text
          if (uCell.custom?.binding) {
            cellDef.binding = uCell.custom.binding;
            const label =
              typeof cellDef.binding === "object"
                ? cellDef.binding.displayLabel || cellDef.binding.fieldId
                : String(cellDef.binding);
            cellDef.value = `{{ ${label} }}`;
          }

          // Check if cell is in a repeating region below the binding row:
          // Templates never contain sample data rows; sample values appear only in preview!
          const inRegionDataRow = (us.regions || []).some(
            (reg: any) =>
              r >= reg.startRow + 1 &&
              r <= reg.endRow &&
              c >= reg.startCol &&
              c <= reg.endCol,
          );
          if (inRegionDataRow && !cellDef.binding && !cellDef.formula) {
            // Drop sample data row value from template
            delete cellDef.value;
          }

          if (uCell.s) {
            const s = uCell.s;
            const style: GridCellStyle = {};

            // Do not persist temporary design view region shading into template
            if (s.bg?.rgb && !uCell.custom?.__regionShading) {
              style.fill = {
                ...(s.bg.type ? { type: s.bg.type } : {}),
                fgColor: s.bg.rgb,
              };
            }

            if (
              s.cl?.rgb ||
              s.bl ||
              s.it ||
              s.fs ||
              s.ff ||
              s.ul?.s ||
              s.st?.s
            ) {
              const font: any = {};
              if (s.bl) font.bold = true;
              if (s.it) font.italic = true;
              if (s.ul?.s) font.underline = true;
              if (s.st?.s) font.strike = true;
              if (s.cl?.rgb) font.color = s.cl.rgb;
              if (s.fs) font.size = s.fs;
              if (s.ff) font.name = s.ff;
              if (Object.keys(font).length > 0) style.font = font;
            }
            if (
              s.ht !== undefined ||
              s.vt !== undefined ||
              s.tb !== undefined
            ) {
              const alignment: any = {};
              if (s.ht === 2) alignment.horizontal = "center";
              else if (s.ht === 3) alignment.horizontal = "right";
              else if (s.ht === 4) alignment.horizontal = "justify";
              else if (s.ht === 1) alignment.horizontal = "left";

              if (s.vt === 1) alignment.vertical = "top";
              else if (s.vt === 3) alignment.vertical = "bottom";
              else if (s.vt === 2) alignment.vertical = "middle";

              if (s.tb === 1) alignment.wrapText = true;

              if (Object.keys(alignment).length > 0)
                style.alignment = alignment;
            }

            if (s.bd) {
              const border: any = {};
              if (s.bd.t)
                border.top = {
                  style: s.bd.t.style || "thin",
                  color: s.bd.t.cl?.rgb || DEFAULT_GRID_BORDER_COLOR,
                };
              if (s.bd.b)
                border.bottom = {
                  style: s.bd.b.style || "thin",
                  color: s.bd.b.cl?.rgb || DEFAULT_GRID_BORDER_COLOR,
                };
              if (s.bd.l)
                border.left = {
                  style: s.bd.l.style || "thin",
                  color: s.bd.l.cl?.rgb || DEFAULT_GRID_BORDER_COLOR,
                };
              if (s.bd.r)
                border.right = {
                  style: s.bd.r.style || "thin",
                  color: s.bd.r.cl?.rgb || DEFAULT_GRID_BORDER_COLOR,
                };
              if (Object.keys(border).length > 0) style.border = border;
            }

            if (s.n?.pattern) cellDef.numFmt = s.n.pattern;
            if (Object.keys(style).length > 0) cellDef.style = style;
          }

          if (
            cellDef.value !== undefined ||
            cellDef.formula ||
            cellDef.style ||
            cellDef.binding ||
            cellDef.numFmt
          ) {
            cells[`${rStr}:${cStr}`] = cellDef;
          }
        }
      }
    }

    const hasRowHeights = Object.keys(rowHeights).length > 0;
    const hasColWidths = Object.keys(colWidths).length > 0;
    const hasFreeze =
      us.freeze && ((us.freeze.xSplit ?? 0) > 0 || (us.freeze.ySplit ?? 0) > 0);

    const sheetDef: GridSheetDefinition = {
      id: sheetId,
      name: us.name || `Sheet ${idx + 1}`,
      order: idx,
      merges,
      cells,
      regions: us.regions || [],
      conditionalFormats: us.conditionalFormats || [],
      ...(hasFreeze
        ? {
            freezePanes: {
              colSplit: us.freeze.xSplit ?? 0,
              rowSplit: us.freeze.ySplit ?? 0,
            },
          }
        : {}),
      ...(hasRowHeights ? { rowHeights } : {}),
      ...(hasColWidths ? { colWidths } : {}),
    };

    sheets.push(sheetDef);
  });

  return {
    kind: "grid",
    version: 1,
    schemaVersion: univerSnapshot.schemaVersion ?? 2,
    parameters: univerSnapshot.parameters || [],
    datasets: univerSnapshot.datasets || [],
    sheets,
    filenameExpression: univerSnapshot.filenameExpression || '"budget_export"',
    pdf: univerSnapshot.pdf || { mode: "table" },
  };
}
