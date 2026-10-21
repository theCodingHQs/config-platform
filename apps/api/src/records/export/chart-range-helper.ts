import {
  CHART_LIMITS,
  type ChartRenderData,
  type GridCellDefinition,
  type GridChartDefinition,
  type GridSheetDefinition,
} from '@config-platform/schema';

/**
 * Converts column letter to 0-based column index.
 * E.g., 'A' -> 0, 'Z' -> 25, 'AA' -> 26
 */
export function colLetterToIndex(colStr: string): number {
  let index = 0;
  const upper = colStr.toUpperCase().trim();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Converts 0-based column index to column letter.
 * E.g., 0 -> 'A', 25 -> 'Z', 26 -> 'AA'
 */
export function indexToColLetter(colIndex: number): string {
  let temp = colIndex + 1;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

export interface ParsedRange {
  sheetName?: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

/**
 * Parses standard A1 range notation (e.g. "A1", "B2:D10", "Sheet1!C5:C20")
 * into 0-based row and column coordinates.
 */
export function parseA1Range(rangeStr: string): ParsedRange | null {
  if (!rangeStr || typeof rangeStr !== 'string') return null;

  let sheetName: string | undefined;
  let cleanRange = rangeStr.trim();

  if (cleanRange.includes('!')) {
    const parts = cleanRange.split('!');
    sheetName = parts[0].replace(/^['"]|['"]$/g, '');
    cleanRange = parts[1];
  }

  const match = cleanRange.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!match) return null;

  const startCol = colLetterToIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1; // Convert 1-based to 0-based
  const endCol = match[3] ? colLetterToIndex(match[3]) : startCol;
  const endRow = match[4] ? parseInt(match[4], 10) - 1 : startRow;

  return {
    sheetName,
    startCol: Math.min(startCol, endCol),
    startRow: Math.min(startRow, endRow),
    endCol: Math.max(startCol, endCol),
    endRow: Math.max(startRow, endRow),
  };
}

/**
 * Adjusts an A1 range string when rows in a repeating region expand by delta rows.
 * If range spans inside the repeating region, its endRow expands.
 * If range is below the region, its startRow and endRow shift down.
 */
export function shiftRangeByRegion(
  rangeStr: string,
  regionStartRow0: number,
  regionEndRow0: number,
  delta: number
): string {
  if (!rangeStr || delta === 0) return rangeStr;

  const parsed = parseA1Range(rangeStr);
  if (!parsed) return rangeStr;

  let newStartRow = parsed.startRow;
  let newEndRow = parsed.endRow;

  // Inside region: expand endRow
  if (parsed.startRow >= regionStartRow0 && parsed.startRow <= regionEndRow0) {
    if (parsed.endRow >= regionEndRow0) {
      newEndRow = parsed.endRow + delta;
    }
  } else if (parsed.startRow > regionEndRow0) {
    // Below region: shift down
    newStartRow = parsed.startRow + delta;
    newEndRow = parsed.endRow + delta;
  }

  const prefix = parsed.sheetName ? `'${parsed.sheetName}'!` : '';
  const startColLetter = indexToColLetter(parsed.startCol);
  const endColLetter = indexToColLetter(parsed.endCol);

  if (parsed.startCol === parsed.endCol && newStartRow === newEndRow) {
    return `${prefix}${startColLetter}${newStartRow + 1}`;
  }

  return `${prefix}${startColLetter}${newStartRow + 1}:${endColLetter}${newEndRow + 1}`;
}

/**
 * Reads ordered cell values from a hydrated sheet's cells map according to an A1 range string.
 */
export function readRangeValues(
  cells: Record<string, GridCellDefinition> | undefined,
  rangeStr: string
): any[] {
  if (!cells || !rangeStr) return [];

  const parsed = parseA1Range(rangeStr);
  if (!parsed) return [];

  const values: any[] = [];

  for (let r = parsed.startRow; r <= parsed.endRow; r++) {
    for (let c = parsed.startCol; c <= parsed.endCol; c++) {
      const coordKey = `${r}:${c}`;
      const cell = cells[coordKey];
      if (cell) {
        values.push(cell.value !== undefined && cell.value !== null ? cell.value : null);
      } else {
        values.push(null);
      }
    }
  }

  return values;
}

/**
 * Reads a range-sourced chart's categories and series from (formula-evaluated) sheet cells.
 * Pure: needs no tenant context, so it is shared by data exports and plain template previews.
 */
export function extractRangeChartData(
  chart: GridChartDefinition,
  sheets: GridSheetDefinition[]
): ChartRenderData {
  if (chart.source.kind !== 'range') {
    throw new Error(`Chart '${chart.id}' is not range-sourced`);
  }
  const sheetId = chart.source.sheetId;
  const targetSheet = sheets.find((s) => s.id === sheetId || s.name === sheetId);
  if (!targetSheet) {
    throw new Error(`Sheet '${sheetId}' referenced by chart '${chart.id}' not found`);
  }

  let categories: string[] = [];
  if (chart.source.categoryRange) {
    const rawCats = readRangeValues(targetSheet.cells, chart.source.categoryRange);
    categories = rawCats.map((v) => (v !== null && v !== undefined ? String(v) : ''));
  }

  const series = chart.source.series.map((s) => {
    const rawData = readRangeValues(targetSheet.cells, s.range);
    if (rawData.length > CHART_LIMITS.MAX_POINTS_PER_SERIES) {
      throw new Error(
        `Series '${s.name}' range '${s.range}' has ${rawData.length} cells, exceeding maximum limit of ${CHART_LIMITS.MAX_POINTS_PER_SERIES} points`
      );
    }
    const numericData = rawData.map((v) => {
      const num = Number(v);
      return isFinite(num) ? num : 0;
    });
    return {
      name: s.name,
      data: numericData,
      color: s.color,
      type: s.type,
    };
  });

  // If categoryRange was omitted, generate 1-based index categories
  if (categories.length === 0 && series.length > 0) {
    const maxLen = Math.max(...series.map((s) => s.data.length), 0);
    categories = Array.from({ length: maxLen }, (_, i) => String(i + 1));
  }

  return { categories, series };
}
