import { z } from 'zod';

export const GridBorderLineStyleSchema = z.enum([
  'thin',
  'medium',
  'thick',
  'dotted',
  'hair',
  'dashed',
  'double',
]);

export const GridBorderSchema = z.object({
  style: GridBorderLineStyleSchema.optional().default('thin'),
  color: z.string().optional(), // Hex color e.g. '#CBD5E1'
});

export const GridCellStyleSchema = z.object({
  font: z
    .object({
      name: z.string().optional(),
      size: z.number().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      strike: z.boolean().optional(),
      color: z.string().optional(), // Hex color
    })
    .optional(),
  fill: z
    .object({
      type: z.literal('solid').optional(),
      fgColor: z.string().optional(), // Hex color
      bgColor: z.string().optional(),
    })
    .optional(),
  alignment: z
    .object({
      horizontal: z.enum(['left', 'center', 'right', 'justify']).optional(),
      vertical: z.enum(['top', 'middle', 'bottom']).optional(),
      wrapText: z.boolean().optional(),
    })
    .optional(),
  border: z
    .object({
      top: GridBorderSchema.optional(),
      bottom: GridBorderSchema.optional(),
      left: GridBorderSchema.optional(),
      right: GridBorderSchema.optional(),
    })
    .optional(),
});
export type GridCellStyle = z.infer<typeof GridCellStyleSchema>;

export const GridCellBindingSchema = z.object({
  datasetId: z.string().optional(),
  fieldId: z.string().optional(),
  aggregateId: z.string().optional(),
  parameterId: z.string().optional(),
  entityId: z.string().optional(), // backward compatibility for 2B
  expression: z.string().optional(),
  displayLabel: z.string().optional(), // display only label, never used for binding resolution
});
export type GridCellBinding = z.infer<typeof GridCellBindingSchema>;

export const GridRegionColumnBindingSchema = z.object({
  col: z.number().int().min(0),
  fieldId: z.string().min(1, 'fieldId is required'),
  displayLabel: z.string().optional(), // display only label
});
export type GridRegionColumnBinding = z.infer<typeof GridRegionColumnBindingSchema>;

export const GridRegionDefinitionSchema = z.object({
  id: z.string().min(1, 'id is required'),
  datasetId: z.string().optional(),
  entityId: z.string().optional(), // backward compatibility for 2B
  displayLabel: z.string().optional(),
  startRow: z.number().int().min(0),
  endRow: z.number().int().min(0),
  startCol: z.number().int().min(0),
  endCol: z.number().int().min(0),
  filter: z.any().optional(),
  sort: z.any().optional(),
  columns: z.array(GridRegionColumnBindingSchema).optional().default([]),
});
export type GridRegionDefinition = z.infer<typeof GridRegionDefinitionSchema>;

export const GridCellDefinitionSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  formula: z.string().optional(), // e.g. "SUM(C12:C21)"
  binding: z.union([GridCellBindingSchema, z.string()]).optional(), // binds by stable entityId/fieldId or template expression string
  numFmt: z.string().optional(), // e.g. "$#,##0", "$#,##0.00", "0.0%"
  style: GridCellStyleSchema.optional(),
});
export type GridCellDefinition = z.infer<typeof GridCellDefinitionSchema>;

export const GridMergeRangeSchema = z.object({
  startRow: z.number().int().min(0),
  startCol: z.number().int().min(0),
  endRow: z.number().int().min(0),
  endCol: z.number().int().min(0),
});
export type GridMergeRange = z.infer<typeof GridMergeRangeSchema>;

export const GridConditionalFormatRuleSchema = z.object({
  ref: z.string(), // e.g. "E12:E21"
  type: z.enum(['iconSet', 'colorScale', 'cellIs', 'expression']),
  iconSet: z
    .object({
      iconSet: z.string().default('3TrafficLights1'), // '3TrafficLights1', '3Arrows', '3Symbols', etc.
      reverse: z.boolean().optional().default(false),
      showValue: z.boolean().optional().default(true),
      cfvo: z
        .array(
          z.object({
            type: z.enum(['num', 'percent', 'max', 'min', 'formula']),
            value: z.any().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  cellIs: z
    .object({
      operator: z.enum(['equal', 'greaterThan', 'lessThan', 'between', 'notEqual']),
      formulae: z.array(z.string()),
      style: GridCellStyleSchema.optional(),
    })
    .optional(),
  colorScale: z
    .object({
      cfvo: z.array(
        z.object({
          type: z.enum(['min', 'max', 'num', 'percent']),
          value: z.any().optional(),
          color: z.string(),
        })
      ),
    })
    .optional(),
});
export type GridConditionalFormatRule = z.infer<typeof GridConditionalFormatRuleSchema>;

export const GridSheetDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int().default(0),
  freezePanes: z
    .object({
      rowSplit: z.number().int().min(0).optional(),
      colSplit: z.number().int().min(0).optional(),
    })
    .optional(),
  rowHeights: z.record(z.string(), z.number()).optional(), // "0": 45, "1": 24
  colWidths: z.record(z.string(), z.number()).optional(), // "0": 180, "1": 120
  merges: z.array(GridMergeRangeSchema).optional().default([]),
  cells: z.record(z.string(), GridCellDefinitionSchema).default({}), // key: `${row}:${col}`
  regions: z.array(GridRegionDefinitionSchema).optional().default([]),
  conditionalFormats: z.array(GridConditionalFormatRuleSchema).optional().default([]),
});
export type GridSheetDefinition = z.infer<typeof GridSheetDefinitionSchema>;

export const GRID_LIMITS = {
  MAX_SHEETS: 10,
  MAX_STORED_NON_EMPTY_CELLS: 20_000,
  MAX_STORED_TOTAL_CELLS: 20_000,
  MAX_TOTAL_CELLS: 20_000, // stored template non-empty cells
  MAX_JSON_BYTES: 2 * 1024 * 1024, // 2 MB
  MAX_RENDERED_DATA_ROWS: 10_000,
  MAX_RENDERED_CELLS: 200_000,
  MAX_DATASETS: 10,
  MAX_JOINS: 4,
  MAX_GROUPS: 10_000,
  MAX_QUERIES_PER_EXPORT: 50,
};

export const ALLOWED_FORMULA_FUNCTIONS = [
  'SUM',
  'AVERAGE',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'IF',
  'ROUND',
  'ABS',
  'SUBTOTAL',
] as const;

export const FORBIDDEN_FORMULA_PATTERNS = [
  { pattern: /\[.*?\]/, message: 'External workbook references are not allowed in formulas' },
  { pattern: /(?:cmd|powershell)\s*\|/i, message: 'DDE / shell execution commands are not allowed' },
  { pattern: /\|\s*['"][^'"]*['"]/i, message: 'DDE execution strings are not allowed' },
  { pattern: /\b(WEBSERVICE|FILTERXML|INDIRECT|OFFSET|EXEC|CALL|REGISTER|SHELL)\b/i, message: 'Restricted functions are not allowed in formulas' },
];

export function validateSingleFormula(formula: string): { valid: boolean; error?: string } {
  if (!formula || typeof formula !== 'string') return { valid: true };
  const raw = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
  if (!raw) return { valid: true };

  for (const { pattern, message } of FORBIDDEN_FORMULA_PATTERNS) {
    if (pattern.test(raw)) {
      return { valid: false, error: message };
    }
  }

  const hyperlinkMatch = raw.match(/\bHYPERLINK\s*\(\s*(['"][^'"]*['"])/i);
  if (hyperlinkMatch) {
    const target = hyperlinkMatch[1].replace(/['"]/g, '').trim();
    if (!target.startsWith('http://') && !target.startsWith('https://') && !target.startsWith('#')) {
      return { valid: false, error: 'HYPERLINK function only allows http://, https://, or sheet anchors' };
    }
  }

  const fnRegex = /\b([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\(/g;
  let match: RegExpExecArray | null;
  const allowedSet = new Set<string>(ALLOWED_FORMULA_FUNCTIONS.map((f) => f.toUpperCase()));
  allowedSet.add('HYPERLINK');

  while ((match = fnRegex.exec(raw)) !== null) {
    const fnName = match[1].toUpperCase();
    if (!allowedSet.has(fnName)) {
      return {
        valid: false,
        error: `Formula uses unsupported function "${match[1]}". Allowed functions: ${ALLOWED_FORMULA_FUNCTIONS.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

export function validateGridFormulas(template: { sheets: Array<{ cells?: Record<string, any> }> }): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  for (let sIdx = 0; sIdx < template.sheets.length; sIdx++) {
    const sheet = template.sheets[sIdx];
    const cells = sheet.cells || {};
    for (const [coord, cell] of Object.entries(cells)) {
      if (cell && typeof cell === 'object' && cell.formula) {
        const check = validateSingleFormula(cell.formula);
        if (!check.valid) {
          errors.push(`Sheet ${sIdx + 1} cell ${coord}: ${check.error}`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function getUtf8ByteLength(str: string): number {
  let bytes = str.length;
  for (let i = str.length - 1; i >= 0; i--) {
    const code = str.charCodeAt(i);
    if (code > 0x7f && code <= 0x7ff) bytes++;
    else if (code > 0x7ff && code <= 0xffff) bytes += 2;
    if (code >= 0xdc00 && code <= 0xdfff) i--; // trail surrogate
  }
  return bytes;
}

export function validateGridCaps(template: { sheets: Array<{ cells?: Record<string, any> }> }): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (template.sheets.length > GRID_LIMITS.MAX_SHEETS) {
    errors.push(`Template exceeds maximum limit of ${GRID_LIMITS.MAX_SHEETS} sheets (current: ${template.sheets.length}).`);
  }

  let nonEmptyCells = 0;
  for (const s of template.sheets) {
    const cells = s.cells || {};
    for (const c of Object.values(cells)) {
      if (!c) continue;
      if (
        (c.value !== undefined && c.value !== null && c.value !== '') ||
        c.formula ||
        c.binding
      ) {
        nonEmptyCells++;
      }
    }
  }

  if (nonEmptyCells > GRID_LIMITS.MAX_STORED_NON_EMPTY_CELLS) {
    errors.push(`Template exceeds maximum limit of ${GRID_LIMITS.MAX_STORED_NON_EMPTY_CELLS.toLocaleString()} non-empty cells (maximum limit of 200,000 cells) (current: ${nonEmptyCells.toLocaleString()}).`);
  }

  const jsonString = JSON.stringify(template);
  const bytes = getUtf8ByteLength(jsonString);

  if (bytes > GRID_LIMITS.MAX_JSON_BYTES) {
    errors.push(`Template size (${(bytes / (1024 * 1024)).toFixed(2)} MB) exceeds maximum limit of 2 MB.`);
  }

  const tplAny = template as any;
  if (Array.isArray(tplAny.datasets)) {
    if (tplAny.datasets.length > GRID_LIMITS.MAX_DATASETS) {
      errors.push(`Template exceeds maximum limit of ${GRID_LIMITS.MAX_DATASETS} datasets (current: ${tplAny.datasets.length}).`);
    }
    for (const ds of tplAny.datasets) {
      if (ds?.source?.joins && Array.isArray(ds.source.joins) && ds.source.joins.length > GRID_LIMITS.MAX_JOINS) {
        errors.push(`Dataset '${ds.name || ds.id}' exceeds maximum limit of ${GRID_LIMITS.MAX_JOINS} joins (current: ${ds.source.joins.length}).`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function detectUnsupportedContent(univerSnapshotOrSheet: any): string[] {
  const unsupported: Set<string> = new Set();
  if (!univerSnapshotOrSheet || typeof univerSnapshotOrSheet !== 'object') return [];

  const sheets = univerSnapshotOrSheet.sheets
    ? Object.values(univerSnapshotOrSheet.sheets)
    : Array.isArray(univerSnapshotOrSheet)
    ? univerSnapshotOrSheet
    : [univerSnapshotOrSheet];

  for (const s of sheets as any[]) {
    if (!s) continue;
    if (s.drawings?.length || s.images?.length || s.image) unsupported.add('Images / Drawings');
    if (s.charts?.length || s.chart) unsupported.add('Charts');
    if (s.comments?.length || s.threadComments?.length || s.comment) unsupported.add('Comments');
    if (s.dataValidation?.length || s.dataValidations?.length) unsupported.add('Data Validation');
    if (s.pivotTable || s.pivots?.length) unsupported.add('Pivot Tables');
    if (s.protection || s.rangeProtection?.length || s.worksheetProtection) unsupported.add('Sheet Protection');
  }

  return Array.from(unsupported);
}

export const GridParameterTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'date_range',
  'select',
  'boolean',
]);
export type GridParameterType = z.infer<typeof GridParameterTypeSchema>;

export const GridParameterDefinitionSchema = z.object({
  id: z.string().min(1, 'Parameter id is required'),
  name: z.string().min(1, 'Parameter name is required'),
  label: z.string().optional(),
  type: GridParameterTypeSchema.default('text'),
  required: z.boolean().optional().default(false),
  defaultValue: z.any().optional(),
  entityId: z.string().optional(), // For 'select' from entity
});
export type GridParameterDefinition = z.infer<typeof GridParameterDefinitionSchema>;

export const GridDatasetJoinSchema = z.object({
  id: z.string().min(1, 'Join id is required'),
  name: z.string().optional(), // Alias or friendly name (e.g. 'machine', 'line')
  referenceFieldId: z.string().min(1, 'referenceFieldId is required'),
  targetEntityId: z.string().optional(),
  parentJoinId: z.string().optional(), // for chained joins (e.g. base -> j1 -> j2)
  joinType: z.enum(['left', 'inner']).optional().default('left'),
});
export type GridDatasetJoin = z.infer<typeof GridDatasetJoinSchema>;

export const GridDatasetFieldSchema = z.object({
  id: z.string().min(1, 'Field id is required'),
  name: z.string().min(1, 'Field name is required'),
  fieldPath: z.string().min(1, 'fieldPath is required'), // e.g. "machineLog.machine.line.name" or "price" or "fld_..."
  fieldId: z.string().optional(),
  expression: z.string().optional(), // Sandboxed expression over row: e.g. "units * price". No JavaScript.
});
export type GridDatasetField = z.infer<typeof GridDatasetFieldSchema>;

export const GridDatasetFilterOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
  'is_null',
  'not_null',
  'between',
]);
export type GridDatasetFilterOp = z.infer<typeof GridDatasetFilterOpSchema>;

export const GridDatasetFilterSchema = z.object({
  fieldPath: z.string().min(1, 'fieldPath is required'),
  operator: GridDatasetFilterOpSchema.default('eq'),
  value: z.any().optional(),
  parameterId: z.string().optional(),
});
export type GridDatasetFilter = z.infer<typeof GridDatasetFilterSchema>;

export const GridDatasetSortSchema = z.object({
  fieldPath: z.string().min(1, 'fieldPath is required'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
export type GridDatasetSort = z.infer<typeof GridDatasetSortSchema>;

export const GridDatasetTimeBucketSchema = z.enum([
  'hour',
  'day',
  'week',
  'month',
  'year',
]);
export type GridDatasetTimeBucket = z.infer<typeof GridDatasetTimeBucketSchema>;

export const GridDatasetGroupBySchema = z.object({
  fieldPath: z.string().min(1, 'fieldPath is required'),
  dateBucket: GridDatasetTimeBucketSchema.optional(),
});
export type GridDatasetGroupBy = z.infer<typeof GridDatasetGroupBySchema>;

export const GridDatasetAggregateFnSchema = z.enum([
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
]);
export type GridDatasetAggregateFn = z.infer<typeof GridDatasetAggregateFnSchema>;

export const GridDatasetAggregateSchema = z.object({
  id: z.string().min(1, 'Aggregate id is required'),
  name: z.string().min(1, 'Aggregate name is required'),
  fn: GridDatasetAggregateFnSchema,
  fieldPath: z.string().optional(), // optional for count(*)
});
export type GridDatasetAggregate = z.infer<typeof GridDatasetAggregateSchema>;

export const GridDatasetHavingSchema = z.object({
  aggregateId: z.string().min(1, 'aggregateId is required'),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).default('gt'),
  value: z.any().optional(),
  parameterId: z.string().optional(),
});
export type GridDatasetHaving = z.infer<typeof GridDatasetHavingSchema>;

export const GridDatasetSourceSchema = z.object({
  baseEntityId: z.string().min(1, 'baseEntityId is required'),
  joins: z
    .array(GridDatasetJoinSchema)
    .max(GRID_LIMITS.MAX_JOINS, `Max ${GRID_LIMITS.MAX_JOINS} joins allowed`)
    .optional()
    .default([]),
});
export type GridDatasetSource = z.infer<typeof GridDatasetSourceSchema>;

export const GridDatasetDefinitionSchema = z.object({
  id: z.string().min(1, 'Dataset id is required'),
  name: z.string().min(1, 'Dataset name is required'),
  isImplicit: z.boolean().optional(),
  source: GridDatasetSourceSchema,
  fields: z.array(GridDatasetFieldSchema).optional().default([]),
  filters: z.array(GridDatasetFilterSchema).optional().default([]),
  sort: z.array(GridDatasetSortSchema).optional().default([]),
  limit: z.number().int().positive().optional(),
  groupBy: z.array(GridDatasetGroupBySchema).optional().default([]),
  aggregates: z.array(GridDatasetAggregateSchema).optional().default([]),
  having: z.array(GridDatasetHavingSchema).optional().default([]),
});
export type GridDatasetDefinition = z.infer<typeof GridDatasetDefinitionSchema>;

export const BaseGridExportTemplateDefinitionSchema = z.object({
  kind: z.literal('grid'),
  version: z.number().int().default(1),
  schemaVersion: z.number().int().default(2),
  parameters: z.array(GridParameterDefinitionSchema).optional().default([]),
  datasets: z
    .array(GridDatasetDefinitionSchema)
    .max(GRID_LIMITS.MAX_DATASETS, `Max ${GRID_LIMITS.MAX_DATASETS} datasets allowed per template`)
    .optional()
    .default([]),
  sheets: z.array(GridSheetDefinitionSchema).min(1),
  filenameExpression: z.string().optional().default('"budget_report"'),
  pdf: z
    .object({
      mode: z.enum(['table', 'layout']).default('table'),
    })
    .optional()
    .default({ mode: 'table' }),
});

/**
 * Migrates a Grid template (e.g. from schemaVersion 1 / 2B) to schemaVersion 2 (Phase 2C).
 * Every entity-bound region becomes an implicit dataset (same entity, same filter and sort)
 * without altering rendered output.
 */
export function migrateGridTemplateToV2(template: any): GridExportTemplateDefinition {
  if (!template || typeof template !== 'object') {
    throw new Error('Invalid grid template object');
  }

  const cloned = JSON.parse(JSON.stringify(template));
  cloned.schemaVersion = cloned.schemaVersion || 2;
  cloned.parameters = Array.isArray(cloned.parameters) ? cloned.parameters : [];
  cloned.datasets = Array.isArray(cloned.datasets) ? cloned.datasets : [];

  const existingDatasetIds = new Set(cloned.datasets.map((d: any) => d.id));

  // Find all regions across sheets that are entity-bound
  if (Array.isArray(cloned.sheets)) {
    for (let sIdx = 0; sIdx < cloned.sheets.length; sIdx++) {
      const sheet = cloned.sheets[sIdx];
      if (Array.isArray(sheet.regions)) {
        for (let rIdx = 0; rIdx < sheet.regions.length; rIdx++) {
          const region = sheet.regions[rIdx];
          if (region.entityId && !region.datasetId) {
            const dsId = `ds_${region.id}`;
            let uniqueDsId = dsId;
            let counter = 1;
            while (existingDatasetIds.has(uniqueDsId)) {
              uniqueDsId = `${dsId}_${counter++}`;
            }
            existingDatasetIds.add(uniqueDsId);

            // Build fields from region columns
            const dsFields: GridDatasetField[] = (region.columns || []).map((col: any) => ({
              id: col.fieldId,
              name: col.displayLabel || col.fieldId,
              fieldPath: col.fieldId,
              fieldId: col.fieldId,
            }));

            // Build filters from region filter if present
            const dsFilters: GridDatasetFilter[] = [];
            if (region.filter) {
              if (Array.isArray(region.filter)) {
                for (const f of region.filter) {
                  if (f?.fieldId) {
                    dsFilters.push({
                      fieldPath: f.fieldId,
                      operator: f.operator || 'eq',
                      value: f.value,
                    });
                  }
                }
              } else if (region.filter.fieldId) {
                dsFilters.push({
                  fieldPath: region.filter.fieldId,
                  operator: region.filter.operator || 'eq',
                  value: region.filter.value,
                });
              }
            }

            // Build sort from region sort if present
            const dsSort: GridDatasetSort[] = [];
            if (region.sort) {
              if (Array.isArray(region.sort)) {
                for (const s of region.sort) {
                  if (s?.fieldId) {
                    dsSort.push({
                      fieldPath: s.fieldId,
                      direction: s.direction?.toLowerCase() === 'desc' ? 'desc' : 'asc',
                    });
                  }
                }
              } else if (region.sort.fieldId) {
                dsSort.push({
                  fieldPath: region.sort.fieldId,
                  direction: region.sort.direction?.toLowerCase() === 'desc' ? 'desc' : 'asc',
                });
              }
            }

            const implicitDataset: GridDatasetDefinition = {
              id: uniqueDsId,
              name: region.displayLabel || `Dataset for Region ${rIdx + 1}`,
              isImplicit: true,
              source: {
                baseEntityId: region.entityId,
                joins: [],
              },
              fields: dsFields,
              filters: dsFilters,
              sort: dsSort,
              groupBy: [],
              aggregates: [],
              having: [],
            };

            cloned.datasets.push(implicitDataset);
            region.datasetId = uniqueDsId;
          }
        }
      }
    }
  }

  return cloned as GridExportTemplateDefinition;
}

export const GridExportTemplateDefinitionSchema = BaseGridExportTemplateDefinitionSchema.superRefine((val, ctx) => {
  // 1. Enforce caps
  const capCheck = validateGridCaps(val);
  if (!capCheck.valid) {
    for (const err of capCheck.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err,
      });
    }
  }

  // 2. Enforce formula allowlist
  const formulaCheck = validateGridFormulas(val);
  if (!formulaCheck.valid) {
    for (const err of formulaCheck.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err,
      });
    }
  }
});
export type GridExportTemplateDefinition = z.infer<typeof BaseGridExportTemplateDefinitionSchema>;

/**
 * Builds the canonical benchmark "Personal Monthly Budget" layout as our exact kind: "grid" template definition.
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
export function buildPersonalMonthlyBudgetBenchmark(): GridExportTemplateDefinition {
  const cells: Record<string, GridCellDefinition> = {};

  const LIME_BANNER = '#C6D92D';
  const DARK_NAVY = '#1F384C';
  const PALE_GREEN_BAND = '#EAF2E8';
  const WHITE = '#FFFFFF';
  const TOTAL_NAVY = '#1F384C';
  const TOTAL_LIME = '#C6D92D';

  const fontTitle = { bold: true, size: 20, color: DARK_NAVY, name: 'Calibri' };
  const fontHeaderWhite = { bold: true, size: 10, color: WHITE, name: 'Calibri' };
  const fontHeaderNavy = { bold: true, size: 10, color: DARK_NAVY, name: 'Calibri' };
  const fontHeaderLime = { bold: true, size: 10, color: LIME_BANNER, name: 'Calibri' };
  const fontData = { size: 10, color: '#334155', name: 'Calibri' };
  const fontDataBold = { bold: true, size: 10, color: '#0F172A', name: 'Calibri' };
  const fontTotalNavy = { bold: true, size: 10, color: WHITE, name: 'Calibri' };
  const fontTotalLime = { bold: true, size: 10, color: DARK_NAVY, name: 'Calibri' };

  const borderThin = {
    top: { style: 'thin' as const, color: '#CBD5E1' },
    bottom: { style: 'thin' as const, color: '#CBD5E1' },
    left: { style: 'thin' as const, color: '#CBD5E1' },
    right: { style: 'thin' as const, color: '#CBD5E1' },
  };

  // 1. Title Banner (Row 0, Cols 0..10)
  cells['0:0'] = {
    value: 'Personal Monthly Budget',
    style: {
      font: fontTitle,
      fill: { fgColor: LIME_BANNER },
      alignment: { horizontal: 'left', vertical: 'middle' },
    },
  };

  // 2. Projected Income Block (Rows 2..4, Cols 0..3)
  cells['2:0'] = {
    value: 'PROJECTED MONTHLY INCOME',
    style: {
      font: fontHeaderLime,
      fill: { fgColor: DARK_NAVY },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    },
  };
  cells['2:1'] = { value: 'Income 1', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['2:2'] = { value: 2500, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  cells['3:1'] = { value: 'Extra income', style: { font: fontData, fill: { fgColor: WHITE } } };
  cells['3:2'] = { value: 500, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: WHITE }, alignment: { horizontal: 'right' } } };

  cells['4:1'] = { value: 'Total monthly income', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['4:2'] = {
    value: 3000,
    formula: 'SUM(C3:C4)',
    numFmt: '$#,##0',
    style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } },
  };

  // 3. Actual Income Block (Rows 6..8, Cols 0..3)
  cells['6:0'] = {
    value: 'ACTUAL MONTHLY INCOME',
    style: {
      font: fontHeaderLime,
      fill: { fgColor: DARK_NAVY },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    },
  };
  cells['6:1'] = { value: 'Income 1', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['6:2'] = { value: 2500, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  cells['7:1'] = { value: 'Extra income', style: { font: fontData, fill: { fgColor: WHITE } } };
  cells['7:2'] = { value: 500, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: WHITE }, alignment: { horizontal: 'right' } } };

  cells['8:1'] = { value: 'Total monthly income', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['8:2'] = {
    value: 3000,
    formula: 'SUM(C7:C8)',
    numFmt: '$#,##0',
    style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } },
  };

  // 4. Summary & Balance Block (Rows 2..7, Cols 5..7)
  cells['2:5'] = { value: 'TOTAL PROJECTED EXPENSE', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['2:6'] = { value: '(Projected income minus expenses)', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['2:7'] = { value: 2060, numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  cells['3:5'] = { value: 'TOTAL ACTUAL EXPENSE', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['3:6'] = { value: '(Actual income minus expenses)', style: { font: fontData, fill: { fgColor: WHITE } } };
  cells['3:7'] = { value: 2040, numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: WHITE }, alignment: { horizontal: 'right' } } };

  cells['4:6'] = { value: 'Total Expense Difference', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['4:7'] = { value: 20, formula: 'H3-H4', numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  cells['5:5'] = { value: 'PROJECTED BALANCE', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['5:6'] = { value: '(Projected income minus expenses)', style: { font: fontData, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['5:7'] = { value: 940, formula: 'C5-H3', numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  cells['6:5'] = { value: 'ACTUAL BALANCE', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['6:6'] = { value: '(Actual income minus expenses)', style: { font: fontData, fill: { fgColor: WHITE } } };
  cells['6:7'] = { value: 960, formula: 'C9-H4', numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: WHITE }, alignment: { horizontal: 'right' } } };

  cells['7:6'] = { value: 'BALANCE DIFFERENCE (Actual minus projected)', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND } } };
  cells['7:7'] = { value: 20, formula: 'H7-H6', numFmt: '$#,##0', style: { font: fontDataBold, fill: { fgColor: PALE_GREEN_BAND }, alignment: { horizontal: 'right' } } };

  // 5. Table 1 (Left): HOUSING (Rows 10..21, Cols 0..4)
  cells['10:0'] = { value: 'HOUSING', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['10:1'] = { value: '', style: { fill: { fgColor: DARK_NAVY } } };
  cells['10:2'] = { value: 'Projected Cost', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };
  cells['10:3'] = { value: 'Actual Cost', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };
  cells['10:4'] = { value: 'Difference', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };

  const housingItems = [
    { label: 'Mortgage or rent', proj: 1500, act: 1400 },
    { label: 'Phone', proj: 60, act: 100 },
    { label: 'Electricity', proj: 50, act: 60 },
    { label: 'Gas', proj: 200, act: 180 },
    { label: 'Water and sewer', proj: 0, act: 0 },
    { label: 'Cable', proj: 0, act: 0 },
    { label: 'Waste removal', proj: 0, act: 0 },
    { label: 'Maintenance or repairs', proj: 0, act: 0 },
    { label: 'Supplies', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
  ];

  housingItems.forEach((item, idx) => {
    const r = 11 + idx;
    const isBanded = idx % 2 === 0;
    const bg = isBanded ? PALE_GREEN_BAND : WHITE;
    cells[`${r}:0`] = { value: item.label, style: { font: fontData, fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:1`] = { value: '', style: { fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:2`] = { value: item.proj, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:3`] = { value: item.act, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:4`] = {
      value: item.proj - item.act,
      formula: `C${r + 1}-D${r + 1}`,
      numFmt: '$#,##0;($#,##0);$0',
      style: { font: fontDataBold, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin },
    };
  });

  // Housing Total Row
  cells['21:0'] = { value: 'Total', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY } } };
  cells['21:1'] = { value: '', style: { fill: { fgColor: TOTAL_NAVY } } };
  cells['21:2'] = { value: 1810, formula: 'SUM(C12:C21)', numFmt: '$#,##0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };
  cells['21:3'] = { value: 1740, formula: 'SUM(D12:D21)', numFmt: '$#,##0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };
  cells['21:4'] = { value: 70, formula: 'C22-D22', numFmt: '$#,##0;($#,##0);$0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };

  // 6. Table 2 (Right): ENTERTAINMENT (Rows 10..21, Cols 6..10)
  cells['10:6'] = { value: 'ENTERTAINMENT', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER } } };
  cells['10:7'] = { value: '', style: { fill: { fgColor: LIME_BANNER } } };
  cells['10:8'] = { value: 'Projected Cost', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };
  cells['10:9'] = { value: 'Actual Cost', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };
  cells['10:10'] = { value: 'Difference', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };

  const entertainmentItems = [
    { label: 'Video/DVD', proj: 0, act: 50 },
    { label: 'CDs', proj: 0, act: 0 },
    { label: 'Movies', proj: 0, act: 0 },
    { label: 'Concerts', proj: 0, act: 0 },
    { label: 'Sporting events', proj: 0, act: 0 },
    { label: 'Live theater', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
  ];

  entertainmentItems.forEach((item, idx) => {
    const r = 11 + idx;
    const isBanded = idx % 2 === 0;
    const bg = isBanded ? PALE_GREEN_BAND : WHITE;
    cells[`${r}:6`] = { value: item.label, style: { font: fontData, fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:7`] = { value: '', style: { fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:8`] = { value: item.proj, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:9`] = { value: item.act, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:10`] = {
      value: item.proj - item.act,
      formula: `I${r + 1}-J${r + 1}`,
      numFmt: '$#,##0;($#,##0);$0',
      style: { font: fontDataBold, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin },
    };
  });

  // Entertainment Total Row
  cells['20:6'] = { value: 'Total', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME } } };
  cells['20:7'] = { value: '', style: { fill: { fgColor: TOTAL_LIME } } };
  cells['20:8'] = { value: 0, formula: 'SUM(I12:I20)', numFmt: '$#,##0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };
  cells['20:9'] = { value: 50, formula: 'SUM(J12:J20)', numFmt: '$#,##0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };
  cells['20:10'] = { value: -50, formula: 'I21-J21', numFmt: '$#,##0;($#,##0);$0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };

  // 7. Table 3 (Lower Left): TRANSPORTATION (Rows 22..30, Cols 0..4)
  cells['22:0'] = { value: 'TRANSPORTATION', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER } } };
  cells['22:1'] = { value: '', style: { fill: { fgColor: LIME_BANNER } } };
  cells['22:2'] = { value: 'Projected Cost', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };
  cells['22:3'] = { value: 'Actual Cost', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };
  cells['22:4'] = { value: 'Difference', style: { font: fontHeaderNavy, fill: { fgColor: LIME_BANNER }, alignment: { horizontal: 'right' } } };

  const transItems = [
    { label: 'Vehicle payment', proj: 250, act: 250 },
    { label: 'Bus/taxi fare', proj: 0, act: 0 },
    { label: 'Insurance', proj: 0, act: 0 },
    { label: 'Licensing', proj: 0, act: 0 },
    { label: 'Fuel', proj: 0, act: 0 },
    { label: 'Maintenance', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
  ];

  transItems.forEach((item, idx) => {
    const r = 23 + idx;
    const isBanded = idx % 2 === 0;
    const bg = isBanded ? PALE_GREEN_BAND : WHITE;
    cells[`${r}:0`] = { value: item.label, style: { font: fontData, fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:1`] = { value: '', style: { fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:2`] = { value: item.proj, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:3`] = { value: item.act, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:4`] = {
      value: item.proj - item.act,
      formula: `C${r + 1}-D${r + 1}`,
      numFmt: '$#,##0;($#,##0);$0',
      style: { font: fontDataBold, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin },
    };
  });

  cells['30:0'] = { value: 'Total', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME } } };
  cells['30:1'] = { value: '', style: { fill: { fgColor: TOTAL_LIME } } };
  cells['30:2'] = { value: 250, formula: 'SUM(C24:C30)', numFmt: '$#,##0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };
  cells['30:3'] = { value: 250, formula: 'SUM(D24:D30)', numFmt: '$#,##0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };
  cells['30:4'] = { value: 0, formula: 'C31-D31', numFmt: '$#,##0;($#,##0);$0', style: { font: fontTotalNavy, fill: { fgColor: TOTAL_LIME }, alignment: { horizontal: 'right' } } };

  // 8. Table 4 (Lower Right): LOANS (Rows 22..29, Cols 6..10)
  cells['22:6'] = { value: 'LOANS', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY } } };
  cells['22:7'] = { value: '', style: { fill: { fgColor: DARK_NAVY } } };
  cells['22:8'] = { value: 'Projected Cost', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };
  cells['22:9'] = { value: 'Actual Cost', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };
  cells['22:10'] = { value: 'Difference', style: { font: fontHeaderLime, fill: { fgColor: DARK_NAVY }, alignment: { horizontal: 'right' } } };

  const loanItems = [
    { label: 'Personal', proj: 0, act: 0 },
    { label: 'Student', proj: 0, act: 0 },
    { label: 'Credit card', proj: 0, act: 0 },
    { label: 'Credit card', proj: 0, act: 0 },
    { label: 'Credit card', proj: 0, act: 0 },
    { label: 'Other', proj: 0, act: 0 },
  ];

  loanItems.forEach((item, idx) => {
    const r = 23 + idx;
    const isBanded = idx % 2 === 0;
    const bg = isBanded ? PALE_GREEN_BAND : WHITE;
    cells[`${r}:6`] = { value: item.label, style: { font: fontData, fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:7`] = { value: '', style: { fill: { fgColor: bg }, border: borderThin } };
    cells[`${r}:8`] = { value: item.proj, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:9`] = { value: item.act, numFmt: '$#,##0', style: { font: fontData, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin } };
    cells[`${r}:10`] = {
      value: item.proj - item.act,
      formula: `I${r + 1}-J${r + 1}`,
      numFmt: '$#,##0;($#,##0);$0',
      style: { font: fontDataBold, fill: { fgColor: bg }, alignment: { horizontal: 'right' }, border: borderThin },
    };
  });

  cells['29:6'] = { value: 'Total', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY } } };
  cells['29:7'] = { value: '', style: { fill: { fgColor: TOTAL_NAVY } } };
  cells['29:8'] = { value: 0, formula: 'SUM(I24:I29)', numFmt: '$#,##0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };
  cells['29:9'] = { value: 0, formula: 'SUM(J24:J29)', numFmt: '$#,##0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };
  cells['29:10'] = { value: 0, formula: 'I30-J30', numFmt: '$#,##0;($#,##0);$0', style: { font: fontTotalLime, fill: { fgColor: TOTAL_NAVY }, alignment: { horizontal: 'right' } } };

  // 9. Merged Ranges
  const merges: GridMergeRange[] = [
    // Banner
    { startRow: 0, startCol: 0, endRow: 0, endCol: 10 },
    // Projected income vertical side-header
    { startRow: 2, startCol: 0, endRow: 4, endCol: 0 },
    // Actual income vertical side-header
    { startRow: 6, startCol: 0, endRow: 8, endCol: 0 },
    // Housing header
    { startRow: 10, startCol: 0, endRow: 10, endCol: 1 },
    { startRow: 21, startCol: 0, endRow: 21, endCol: 1 },
    // Entertainment header
    { startRow: 10, startCol: 6, endRow: 10, endCol: 7 },
    { startRow: 20, startCol: 6, endRow: 20, endCol: 7 },
    // Transportation header
    { startRow: 22, startCol: 0, endRow: 22, endCol: 1 },
    { startRow: 30, startCol: 0, endRow: 30, endCol: 1 },
    // Loans header
    { startRow: 22, startCol: 6, endRow: 22, endCol: 7 },
    { startRow: 29, startCol: 6, endRow: 29, endCol: 7 },
  ];

  // Merge items in table rows (Col 0 and Col 1 merged for item labels)
  for (let r = 11; r <= 20; r++) merges.push({ startRow: r, startCol: 0, endRow: r, endCol: 1 });
  for (let r = 11; r <= 19; r++) merges.push({ startRow: r, startCol: 6, endRow: r, endCol: 7 });
  for (let r = 23; r <= 29; r++) merges.push({ startRow: r, startCol: 0, endRow: r, endCol: 1 });
  for (let r = 23; r <= 28; r++) merges.push({ startRow: r, startCol: 6, endRow: r, endCol: 7 });

  const sheet: GridSheetDefinition = {
    id: 'sheet_budget',
    name: 'Personal Budget',
    order: 0,
    freezePanes: { rowSplit: 1, colSplit: 0 },
    rowHeights: {
      '0': 48, // Large banner
      '1': 16,
      '2': 24,
      '3': 24,
      '4': 24,
      '10': 28,
      '21': 26,
      '22': 28,
      '30': 26,
    },
    colWidths: {
      '0': 150,
      '1': 60,
      '2': 100,
      '3': 100,
      '4': 100,
      '5': 30, // spacer
      '6': 150,
      '7': 60,
      '8': 100,
      '9': 100,
      '10': 100,
    },
    merges,
    cells,
    regions: [],
    conditionalFormats: [
      {
        ref: 'E12:E21',
        type: 'iconSet',
        iconSet: {
          iconSet: '3TrafficLights1',
          reverse: false,
          showValue: true,
          cfvo: [
            { type: 'percent', value: 0 },
            { type: 'percent', value: 33 },
            { type: 'percent', value: 67 },
          ],
        },
      },
      {
        ref: 'K12:K20',
        type: 'iconSet',
        iconSet: {
          iconSet: '3TrafficLights1',
          reverse: false,
          showValue: true,
          cfvo: [
            { type: 'percent', value: 0 },
            { type: 'percent', value: 33 },
            { type: 'percent', value: 67 },
          ],
        },
      },
      {
        ref: 'E24:E30',
        type: 'iconSet',
        iconSet: {
          iconSet: '3TrafficLights1',
          reverse: false,
          showValue: true,
          cfvo: [
            { type: 'percent', value: 0 },
            { type: 'percent', value: 33 },
            { type: 'percent', value: 67 },
          ],
        },
      },
      {
        ref: 'K24:K29',
        type: 'iconSet',
        iconSet: {
          iconSet: '3TrafficLights1',
          reverse: false,
          showValue: true,
          cfvo: [
            { type: 'percent', value: 0 },
            { type: 'percent', value: 33 },
            { type: 'percent', value: 67 },
          ],
        },
      },
    ],
  };

  return {
    kind: 'grid',
    version: 1,
    schemaVersion: 2,
    parameters: [],
    datasets: [],
    sheets: [sheet],
    filenameExpression: '"personal_monthly_budget"',
    pdf: { mode: 'table' },
  };
}

export interface ExecutiveReportEntityInput {
  id: string;
  name: string;
  label?: string;
  columns?: Array<{ id: string; name: string; type?: string; label?: string }>;
  fields?: Array<{ id: string; name: string; type?: string; label?: string }>;
}

/**
 * Generates a professional Executive KPI & Data Breakdown template dynamically connected to database data.
 * Features:
 * - Brand-styled header banner with dynamic timestamp and user email binding expressions
 * - 3 KPI summary cards at top (Total Records, Volume Sum, and Average Value) bound to dataset aggregates
 * - Formatted repeating data region bound to entity dataset columns
 * - Totals row with Excel SUM formula
 */
export function buildExecutiveReportTemplate(entity: ExecutiveReportEntityInput): GridExportTemplateDefinition {
  const entityLabel = entity.label || entity.name || 'Entity';
  const entityName = entity.name || 'entity';
  const rawFields = (entity.columns || entity.fields || []).filter(Boolean);

  // Pick up to 6 meaningful fields, preferring non-system fields
  const nonSystemFields = rawFields.filter(
    (f) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name.toLowerCase())
  );
  const selectedFields = (nonSystemFields.length > 0 ? nonSystemFields : rawFields).slice(0, 6);

  // If no fields provided, synthesize starter fields
  if (selectedFields.length === 0) {
    selectedFields.push(
      { id: 'f_title', name: 'title', label: 'Title', type: 'text' },
      { id: 'f_amount', name: 'amount', label: 'Amount', type: 'number' }
    );
  }

  // Identify numeric & date columns for KPI aggregates & formatting
  const numericField = selectedFields.find(
    (f) =>
      ['number', 'integer', 'decimal', 'float', 'currency'].includes((f.type || '').toLowerCase()) ||
      /price|amount|cost|total|quantity|units|volume|value|score/i.test(f.name)
  );
  const dateField = selectedFields.find(
    (f) =>
      ['date', 'datetime', 'timestamp'].includes((f.type || '').toLowerCase()) ||
      /date|time|created/i.test(f.name)
  );

  const numColIndex = numericField ? selectedFields.findIndex((f) => f.id === numericField.id) : -1;

  // Build Dataset
  const dsFields: GridDatasetField[] = selectedFields.map((f) => ({
    id: f.id,
    name: f.label || f.name,
    fieldPath: f.name,
    fieldId: f.id,
  }));

  const aggregates: GridDatasetAggregate[] = [
    { id: 'agg_count', name: 'Total Records', fn: 'count' },
  ];

  if (numericField) {
    aggregates.push({
      id: 'agg_sum',
      name: 'Total Volume',
      fn: 'sum',
      fieldPath: numericField.name,
    });
    aggregates.push({
      id: 'agg_avg',
      name: 'Average Value',
      fn: 'avg',
      fieldPath: numericField.name,
    });
  }

  const dataset: GridDatasetDefinition = {
    id: 'ds_exec_report',
    name: `${entityLabel} Executive Dataset`,
    source: {
      baseEntityId: entity.id,
      joins: [],
    },
    fields: dsFields,
    filters: [],
    sort: [],
    groupBy: [],
    aggregates,
    having: [],
  };

  const colCount = Math.max(selectedFields.length, 6);
  const cells: Record<string, GridCellDefinition> = {};

  // Palette
  const NAVY = '#0F172A';
  const SUBNAVY = '#1E293B';
  const WHITE = '#FFFFFF';
  const MUTED_LABEL = '#64748B';
  const INDIGO = '#4F46E5';
  const INDIGO_BG = '#EEF2FF';
  const EMERALD = '#059669';
  const EMERALD_BG = '#ECFDF5';
  const CARD_BG = '#F8FAFC';

  const fontTitle = { bold: true, size: 14, color: WHITE, name: 'Calibri' };
  const fontSubtitle = { italic: true, size: 9, color: '#94A3B8', name: 'Calibri' };
  const fontCardLabel = { bold: true, size: 9, color: MUTED_LABEL, name: 'Calibri' };
  const fontCardBig = { bold: true, size: 18, color: NAVY, name: 'Calibri' };
  const fontCardBigIndigo = { bold: true, size: 18, color: INDIGO, name: 'Calibri' };
  const fontCardBigEmerald = { bold: true, size: 18, color: EMERALD, name: 'Calibri' };
  const fontCardSub = { size: 8, color: '#94A3B8', name: 'Calibri' };
  const fontTableHeader = { bold: true, size: 10, color: WHITE, name: 'Calibri' };
  const fontData = { size: 10, color: '#1E293B', name: 'Calibri' };
  const fontTotal = { bold: true, size: 10, color: NAVY, name: 'Calibri' };

  // 1. Header Banner (Row 0, Cols 0..colCount-1)
  cells['0:0'] = {
    value: `${entityLabel.toUpperCase()} EXECUTIVE SUMMARY REPORT`,
    style: {
      font: fontTitle,
      fill: { fgColor: NAVY },
      alignment: { horizontal: 'left', vertical: 'middle' },
    },
  };

  // Row 1: Subtitle
  cells['1:0'] = {
    value: `Generated on {{ date.today }} | Exported by {{ user.email }}`,
    binding: '{{ "Generated on " + date.today + " | Exported by " + user.email }}',
    style: {
      font: fontSubtitle,
      fill: { fgColor: SUBNAVY },
      alignment: { horizontal: 'left', vertical: 'middle' },
    },
  };

  // 2. KPI Cards (Rows 3..5)
  // Card 1: Total Records (Cols 0-1)
  cells['3:0'] = {
    value: 'TOTAL RECORDS',
    style: { font: fontCardLabel, fill: { fgColor: CARD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['4:0'] = {
    value: 0,
    binding: { datasetId: 'ds_exec_report', aggregateId: 'agg_count', displayLabel: 'Total Records' },
    numFmt: '#,##0',
    style: { font: fontCardBig, fill: { fgColor: CARD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['5:0'] = {
    value: 'Active Database Entries',
    style: { font: fontCardSub, fill: { fgColor: CARD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };

  // Card 2: Total Volume / Amount (Cols 2-3)
  cells['3:2'] = {
    value: numericField ? `TOTAL ${numericField.label?.toUpperCase() || numericField.name.toUpperCase()}` : 'RECORD VOLUME',
    style: { font: { ...fontCardLabel, color: INDIGO }, fill: { fgColor: INDIGO_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['4:2'] = {
    value: 0,
    binding: {
      datasetId: 'ds_exec_report',
      aggregateId: numericField ? 'agg_sum' : 'agg_count',
      displayLabel: 'Total Volume',
    },
    numFmt: numericField ? '$#,##0.00' : '#,##0',
    style: { font: fontCardBigIndigo, fill: { fgColor: INDIGO_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['5:2'] = {
    value: 'Cumulative Portfolio Total',
    style: { font: { ...fontCardSub, color: '#6366F1' }, fill: { fgColor: INDIGO_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };

  // Card 3: Average / Distribution (Cols 4-5)
  cells['3:4'] = {
    value: numericField ? `AVG ${numericField.label?.toUpperCase() || numericField.name.toUpperCase()}` : 'BENCHMARK METRIC',
    style: { font: { ...fontCardLabel, color: EMERALD }, fill: { fgColor: EMERALD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['4:4'] = {
    value: 0,
    binding: {
      datasetId: 'ds_exec_report',
      aggregateId: numericField ? 'agg_avg' : 'agg_count',
      displayLabel: 'Average',
    },
    numFmt: numericField ? '$#,##0.00' : '#,##0',
    style: { font: fontCardBigEmerald, fill: { fgColor: EMERALD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['5:4'] = {
    value: 'Mean Benchmark Value',
    style: { font: { ...fontCardSub, color: '#10B981' }, fill: { fgColor: EMERALD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };

  // 3. Table Headers (Row 7)
  selectedFields.forEach((field, cIdx) => {
    const isNum = field === numericField;
    cells[`7:${cIdx}`] = {
      value: field.label || field.name,
      style: {
        font: fontTableHeader,
        fill: { fgColor: SUBNAVY },
        alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'middle' },
      },
    };
  });

  // 4. Sample Rows for repeating region (Rows 8..10)
  const sampleValues = [
    ['Alpha Record', 1250.0, '2026-01-15', 'Active', 'High', 'Approved'],
    ['Beta Record', 890.5, '2026-02-20', 'Pending', 'Medium', 'Review'],
    ['Gamma Record', 2410.75, '2026-03-10', 'Active', 'High', 'Approved'],
  ];

  for (let rIdx = 0; rIdx < 3; rIdx++) {
    const rowNum = 8 + rIdx;
    selectedFields.forEach((field, cIdx) => {
      const isNum = field === numericField;
      const isDate = field === dateField;
      const rawVal = sampleValues[rIdx][cIdx % sampleValues[rIdx].length];
      const val = isNum ? (typeof rawVal === 'number' ? rawVal : 100 * (rIdx + 1)) : rawVal;

      cells[`${rowNum}:${cIdx}`] = {
        value: val,
        numFmt: isNum ? '$#,##0.00' : isDate ? 'YYYY-MM-DD' : undefined,
        style: {
          font: fontData,
          fill: { fgColor: rIdx % 2 === 1 ? '#F8FAFC' : WHITE },
          alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'middle' },
        },
      };
    });
  }

  // 5. Repeating Region
  const region: GridRegionDefinition = {
    id: 'reg_main',
    datasetId: 'ds_exec_report',
    startRow: 8,
    endRow: 10,
    startCol: 0,
    endCol: selectedFields.length - 1,
    columns: selectedFields.map((f, cIdx) => ({
      col: cIdx,
      fieldId: f.id,
      displayLabel: f.label || f.name,
    })),
  };

  // 6. Totals Row (Row 11)
  cells['11:0'] = {
    value: 'Total / Summary',
    style: {
      font: fontTotal,
      fill: { fgColor: '#F1F5F9' },
      alignment: { horizontal: 'left', vertical: 'middle' },
    },
  };

  for (let cIdx = 1; cIdx < selectedFields.length; cIdx++) {
    if (cIdx === numColIndex) {
      const letter = String.fromCharCode(65 + cIdx);
      cells[`11:${cIdx}`] = {
        value: 0,
        formula: `SUM(${letter}9:${letter}11)`,
        numFmt: '$#,##0.00',
        style: {
          font: fontTotal,
          fill: { fgColor: '#F1F5F9' },
          alignment: { horizontal: 'right', vertical: 'middle' },
        },
      };
    } else {
      cells[`11:${cIdx}`] = {
        value: '',
        style: { fill: { fgColor: '#F1F5F9' } },
      };
    }
  }

  // Merges
  const merges: GridMergeRange[] = [
    { startRow: 0, startCol: 0, endRow: 0, endCol: colCount - 1 },
    { startRow: 1, startCol: 0, endRow: 1, endCol: colCount - 1 },
    { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
    { startRow: 4, startCol: 0, endRow: 4, endCol: 1 },
    { startRow: 5, startCol: 0, endRow: 5, endCol: 1 },
    { startRow: 3, startCol: 2, endRow: 3, endCol: 3 },
    { startRow: 4, startCol: 2, endRow: 4, endCol: 3 },
    { startRow: 5, startCol: 2, endRow: 5, endCol: 3 },
    { startRow: 3, startCol: 4, endRow: 3, endCol: 5 },
    { startRow: 4, startCol: 4, endRow: 4, endCol: 5 },
    { startRow: 5, startCol: 4, endRow: 5, endCol: 5 },
  ];

  const colWidths: Record<string, number> = {};
  for (let c = 0; c < colCount; c++) {
    colWidths[String(c)] = c === numColIndex ? 130 : 150;
  }

  const sheet: GridSheetDefinition = {
    id: 'sheet_executive',
    name: 'Executive Summary',
    order: 0,
    freezePanes: { rowSplit: 8, colSplit: 0 },
    rowHeights: {
      '0': 38,
      '1': 20,
      '2': 12,
      '3': 20,
      '4': 32,
      '5': 16,
      '6': 16,
      '7': 26,
      '8': 22,
      '9': 22,
      '10': 22,
      '11': 24,
    },
    colWidths,
    merges,
    cells,
    regions: [region],
    conditionalFormats: [],
  };

  return {
    kind: 'grid',
    version: 1,
    schemaVersion: 2,
    parameters: [],
    datasets: [dataset],
    sheets: [sheet],
    filenameExpression: `"${entityName}_executive_report"`,
    pdf: { mode: 'table' },
  };
}

