import { z } from 'zod';
import {
  GridChartDefinitionSchema,
  type GridChartDefinition,
  CHART_LIMITS,
} from './chart-spec.js';

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

/**
 * Cell input rules. `checkbox` cells store checkedValue/uncheckedValue (1/0 by default) so plain
 * SUM/COUNT formulas, and charts over those formulas, react when a box is ticked.
 */
export const GridDataValidationSchema = z.object({
  id: z.string().optional(),
  ref: z.string().min(1, 'ref is required'), // e.g. "C21:AG28"
  type: z.literal('checkbox'),
  checkedValue: z.number().optional().default(1),
  uncheckedValue: z.number().optional().default(0),
});
export type GridDataValidation = z.infer<typeof GridDataValidationSchema>;

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
  dataValidations: z.array(GridDataValidationSchema).optional(),
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
  MAX_CHARTS: CHART_LIMITS.MAX_CHARTS_PER_TEMPLATE,
  MAX_SERIES_PER_CHART: CHART_LIMITS.MAX_SERIES_PER_CHART,
  MAX_POINTS_PER_SERIES: CHART_LIMITS.MAX_POINTS_PER_SERIES,
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

  if (Array.isArray(tplAny.charts)) {
    if (tplAny.charts.length > GRID_LIMITS.MAX_CHARTS) {
      errors.push(`Template exceeds maximum limit of ${GRID_LIMITS.MAX_CHARTS} charts (current: ${tplAny.charts.length}).`);
    }
    for (const ch of tplAny.charts) {
      if (ch?.source?.series && Array.isArray(ch.source.series) && ch.source.series.length > GRID_LIMITS.MAX_SERIES_PER_CHART) {
        errors.push(`Chart '${ch.title || ch.id}' exceeds maximum limit of ${GRID_LIMITS.MAX_SERIES_PER_CHART} series (current: ${ch.source.series.length}).`);
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
    const validations = [...(s.dataValidation || []), ...(s.dataValidations || [])];
    if (validations.some((v: any) => v?.type !== 'checkbox')) unsupported.add('Data Validation');
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
  schemaVersion: z.number().int().default(3),
  parameters: z.array(GridParameterDefinitionSchema).optional().default([]),
  datasets: z
    .array(GridDatasetDefinitionSchema)
    .max(GRID_LIMITS.MAX_DATASETS, `Max ${GRID_LIMITS.MAX_DATASETS} datasets allowed per template`)
    .optional()
    .default([]),
  charts: z
    .array(GridChartDefinitionSchema)
    .max(GRID_LIMITS.MAX_CHARTS, `Max ${GRID_LIMITS.MAX_CHARTS} charts allowed per template`)
    .optional(),
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

/**
 * Migrates a Grid template (e.g. from schemaVersion 1 or 2) to schemaVersion 3 (Charts support).
 * Defaults schemaVersion to 3 and charts to [] if undefined.
 */
export function migrateGridTemplateToV3(template: any): GridExportTemplateDefinition {
  if (!template || typeof template !== 'object') {
    throw new Error('Invalid grid template object');
  }
  const v2 = migrateGridTemplateToV2(template);
  const cloned = JSON.parse(JSON.stringify(v2));
  cloned.schemaVersion = 3;
  cloned.charts = Array.isArray(cloned.charts) ? cloned.charts : [];
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
    charts: [],
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

export type GridStarterTemplateId = 'executive' | 'operations' | 'financial' | 'audit' | 'production';

export const GRID_STARTER_TEMPLATES: Array<{
  id: GridStarterTemplateId;
  name: string;
  description: string;
  /** 'interactive' starters are self-contained sheets driven by checkbox cells rather than entity data. */
  category: 'data' | 'interactive';
}> = [
  {
    id: 'executive',
    name: 'Executive Dashboard',
    description: 'KPI cards, a detail table, and charts of record distribution and trends.',
    category: 'data',
  },
  {
    id: 'operations',
    name: 'Operations Board',
    description: 'Status and ownership first, with a status breakdown donut and a weekly volume chart.',
    category: 'data',
  },
  {
    id: 'financial',
    name: 'Financial Overview',
    description: 'Formatted totals and averages, with a monthly trend chart and a category split.',
    category: 'data',
  },
  {
    id: 'audit',
    name: 'Audit Register',
    description: 'A date-first register with daily activity and change-breakdown charts.',
    category: 'data',
  },
  {
    id: 'production',
    name: 'Production Target Tracker',
    description: 'Machines × days checkbox grid: tick when a machine hits its daily target and the KPIs plus four charts update live, in the designer and in Excel.',
    category: 'interactive',
  },
];

/**
 * Generates a professional Executive KPI & Data Breakdown template dynamically connected to database data.
 * Features:
 * - Brand-styled header banner with dynamic timestamp and user email binding expressions
 * - 4 KPI summary cards at top (record count, sum, average, and maximum) bound to dataset aggregates
 * - Formatted repeating data region bound to entity dataset columns
 * - Banded repeating rows and a totals row with an Excel SUM formula
 */
export function buildExecutiveReportTemplate(entity: ExecutiveReportEntityInput): GridExportTemplateDefinition {
  const entityLabel = entity.label || entity.name || 'Entity';
  const entityName = entity.name || 'entity';
  const rawFields = (entity.columns || entity.fields || []).filter(Boolean);

  // Pick up to 8 meaningful fields, preferring non-system fields
  const nonSystemFields = rawFields.filter(
    (f) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name.toLowerCase())
  );
  const selectedFields = (nonSystemFields.length > 0 ? nonSystemFields : rawFields).slice(0, 8);

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
  const numericFormat = numericField
    ? (numericField.type || '').toLowerCase() === 'currency' ||
      /price|amount|cost|total|value|salary|revenue|budget/i.test(numericField.name)
      ? '$#,##0.00'
      : '#,##0.00'
    : '#,##0';

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
    aggregates.push({
      id: 'agg_max',
      name: 'Maximum Value',
      fn: 'max',
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

  const colCount = Math.max(selectedFields.length, 8);
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
  const VIOLET = '#7C3AED';
  const VIOLET_BG = '#F5F3FF';
  const CARD_BG = '#F8FAFC';

  const fontTitle = { bold: true, size: 14, color: WHITE, name: 'Calibri' };
  const fontSubtitle = { italic: true, size: 9, color: '#94A3B8', name: 'Calibri' };
  const fontCardLabel = { bold: true, size: 9, color: MUTED_LABEL, name: 'Calibri' };
  const fontCardBig = { bold: true, size: 18, color: NAVY, name: 'Calibri' };
  const fontCardBigIndigo = { bold: true, size: 18, color: INDIGO, name: 'Calibri' };
  const fontCardBigEmerald = { bold: true, size: 18, color: EMERALD, name: 'Calibri' };
  const fontCardBigViolet = { bold: true, size: 18, color: VIOLET, name: 'Calibri' };
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

  cells['2:0'] = {
    value: 'DATASET SNAPSHOT  •  VALUES REFRESH WHEN EXPORTED',
    style: {
      font: { bold: true, size: 8, color: MUTED_LABEL, name: 'Calibri' },
      fill: { fgColor: '#F1F5F9' },
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
    numFmt: numericField ? numericFormat : '#,##0',
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
    numFmt: numericField ? numericFormat : '#,##0',
    style: { font: fontCardBigEmerald, fill: { fgColor: EMERALD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['5:4'] = {
    value: 'Mean Benchmark Value',
    style: { font: { ...fontCardSub, color: '#10B981' }, fill: { fgColor: EMERALD_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };

  // Card 4: Maximum / Peak Value (Cols 6-7)
  cells['3:6'] = {
    value: numericField ? `MAX ${numericField.label?.toUpperCase() || numericField.name.toUpperCase()}` : 'DATA FIELDS',
    style: { font: { ...fontCardLabel, color: VIOLET }, fill: { fgColor: VIOLET_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['4:6'] = {
    value: 0,
    binding: {
      datasetId: 'ds_exec_report',
      aggregateId: numericField ? 'agg_max' : 'agg_count',
      displayLabel: numericField ? 'Maximum Value' : 'Total Records',
    },
    numFmt: numericField ? numericFormat : '#,##0',
    style: { font: fontCardBigViolet, fill: { fgColor: VIOLET_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
  };
  cells['5:6'] = {
    value: numericField ? 'Highest recorded value' : 'Records in this report',
    style: { font: { ...fontCardSub, color: VIOLET }, fill: { fgColor: VIOLET_BG }, alignment: { horizontal: 'center', vertical: 'middle' } },
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
  if (selectedFields.length === 0) {
    cells['7:0'] = {
      value: 'No fields available for this entity',
      style: { font: fontTableHeader, fill: { fgColor: SUBNAVY } },
    };
  }

  // 4. Repeating data area: keep the body empty and let bindings supply placeholders.
  for (let rIdx = 0; rIdx < 10; rIdx++) {
    const rowNum = 8 + rIdx;
    selectedFields.forEach((field, cIdx) => {
      const isNum = field === numericField;
      const isDate = field === dateField;

      cells[`${rowNum}:${cIdx}`] = {
        value: '',
        numFmt: isNum
          ? numericFormat
          : isDate ? 'YYYY-MM-DD' : undefined,
        style: {
          font: fontData,
          fill: { fgColor: rIdx % 2 === 1 ? '#F8FAFC' : WHITE },
          alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'middle' },
        },
      };
    });
  }

  // 5. Repeating Region
  const regions: GridRegionDefinition[] = selectedFields.length > 0
    ? [{
        id: 'reg_main',
        datasetId: 'ds_exec_report',
        startRow: 8,
        endRow: 17,
        startCol: 0,
        endCol: selectedFields.length - 1,
        columns: selectedFields.map((f, cIdx) => ({
          col: cIdx,
          fieldId: f.id,
          displayLabel: f.label || f.name,
        })),
      }]
    : [];

  // 6. Totals Row (Row 18)
  if (numColIndex !== 0 || selectedFields.length < 2) {
    cells['18:0'] = {
      value: 'Total / Summary',
      style: {
        font: fontTotal,
        fill: { fgColor: '#F1F5F9' },
        alignment: { horizontal: 'left', vertical: 'middle' },
      },
    };
  } else {
    cells[`18:${selectedFields.length - 1}`] = {
      value: 'Total / Summary',
      style: {
        font: fontTotal,
        fill: { fgColor: '#F1F5F9' },
        alignment: { horizontal: 'left', vertical: 'middle' },
      },
    };
  }

  selectedFields.forEach((field, cIdx) => {
    const totalStyle = {
      font: fontTotal,
      fill: { fgColor: '#F1F5F9' },
      alignment: { horizontal: cIdx === numColIndex ? 'right' as const : 'left' as const, vertical: 'middle' as const },
    };
    if (numericField && cIdx === numColIndex && selectedFields.length > 1) {
      const letter = String.fromCharCode(65 + cIdx);
      cells[`18:${cIdx}`] = {
        value: 0,
        formula: `SUM(${letter}9:${letter}18)`,
        numFmt: numericFormat,
        style: totalStyle,
      };
    } else if (cIdx !== 0 && !(numColIndex === 0 && cIdx === selectedFields.length - 1)) {
      cells[`18:${cIdx}`] = { value: '', style: totalStyle };
    }
  });

  // Merges
  const merges: GridMergeRange[] = [
    { startRow: 0, startCol: 0, endRow: 0, endCol: colCount - 1 },
    { startRow: 1, startCol: 0, endRow: 1, endCol: colCount - 1 },
    { startRow: 2, startCol: 0, endRow: 2, endCol: colCount - 1 },
    { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
    { startRow: 4, startCol: 0, endRow: 4, endCol: 1 },
    { startRow: 5, startCol: 0, endRow: 5, endCol: 1 },
    { startRow: 3, startCol: 2, endRow: 3, endCol: 3 },
    { startRow: 4, startCol: 2, endRow: 4, endCol: 3 },
    { startRow: 5, startCol: 2, endRow: 5, endCol: 3 },
    { startRow: 3, startCol: 4, endRow: 3, endCol: 5 },
    { startRow: 4, startCol: 4, endRow: 4, endCol: 5 },
    { startRow: 5, startCol: 4, endRow: 5, endCol: 5 },
    { startRow: 3, startCol: 6, endRow: 3, endCol: 7 },
    { startRow: 4, startCol: 6, endRow: 4, endCol: 7 },
    { startRow: 5, startCol: 6, endRow: 5, endCol: 7 },
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
      '2': 20,
      '3': 20,
      '4': 32,
      '5': 16,
      '6': 16,
      '7': 26,
      ...Object.fromEntries(Array.from({ length: 10 }, (_, idx) => [String(8 + idx), 22])),
      '18': 24,
    },
    colWidths,
    merges,
    cells,
    regions,
    conditionalFormats: [],
  };

  return {
    kind: 'grid',
    version: 1,
    schemaVersion: 2,
    parameters: [],
    datasets: [dataset],
    charts: [],
    sheets: [sheet],
    filenameExpression: `"${entityName}_executive_report"`,
    pdf: { mode: 'table' },
  };
}

function prioritizeStarterFields(
  entity: ExecutiveReportEntityInput,
  kind: Exclude<GridStarterTemplateId, 'executive' | 'production'>,
): ExecutiveReportEntityInput {
  const fields = entity.columns || entity.fields || [];
  const rank = (field: { name: string; type?: string }) => {
    const name = field.name.toLowerCase();
    if (kind === 'financial') {
      if (['number', 'integer', 'decimal', 'float', 'currency'].includes((field.type || '').toLowerCase()) ||
          /price|amount|cost|total|quantity|units|volume|value|salary|revenue|budget/i.test(name)) return 0;
      if (/date|time|created/i.test(name)) return 1;
    } else if (kind === 'operations') {
      if (/status|state|stage|active|priority/i.test(name)) return 0;
      if (/owner|assignee|assigned|team/i.test(name)) return 1;
      if (/date|time|due|created/i.test(name)) return 2;
    } else {
      if (/date|time|created|updated/i.test(name)) return 0;
      if (/user|owner|actor|changed|action|status/i.test(name)) return 1;
    }
    return 3;
  };
  return { ...entity, fields: [...fields].sort((a, b) => rank(a) - rank(b)) };
}

export function buildGridStarterTemplate(
  entity: ExecutiveReportEntityInput,
  kind: GridStarterTemplateId,
): GridExportTemplateDefinition {
  if (kind === 'production') return buildProductionTrackerTemplate();

  const template = buildExecutiveReportTemplate(
    kind === 'executive' ? entity : prioritizeStarterFields(entity, kind),
  );
  const sheet = template.sheets[0];
  const titles: Record<Exclude<GridStarterTemplateId, 'production'>, string> = {
    executive: `${entity.label || entity.name} EXECUTIVE DASHBOARD`,
    operations: `${entity.label || entity.name} OPERATIONS BOARD`,
    financial: `${entity.label || entity.name} FINANCIAL OVERVIEW`,
    audit: `${entity.label || entity.name} AUDIT REGISTER`,
  };
  const palettes: Record<Exclude<GridStarterTemplateId, 'executive' | 'production'>, Record<string, string>> = {
    operations: { '#0F172A': '#123047', '#1E293B': '#1D4ED8', '#4F46E5': '#2563EB', '#EEF2FF': '#EFF6FF', '#059669': '#0F766E', '#ECFDF5': '#F0FDFA', '#7C3AED': '#D97706', '#F5F3FF': '#FFFBEB' },
    financial: { '#0F172A': '#14291F', '#1E293B': '#1F5137', '#4F46E5': '#15803D', '#EEF2FF': '#ECFDF3', '#059669': '#047857', '#ECFDF5': '#D1FAE5', '#7C3AED': '#0F766E', '#F5F3FF': '#F0FDFA' },
    audit: { '#0F172A': '#1F2937', '#1E293B': '#374151', '#4F46E5': '#475569', '#EEF2FF': '#F1F5F9', '#059669': '#0F766E', '#ECFDF5': '#F0FDFA', '#7C3AED': '#334155', '#F5F3FF': '#F1F5F9' },
  };

  sheet.cells['0:0'].value = titles[kind];
  sheet.name = kind === 'executive'
    ? 'Executive Dashboard'
    : kind === 'operations'
      ? 'Operations Board'
      : kind === 'financial'
        ? 'Financial Overview'
        : 'Audit Register';
  template.filenameExpression = `"${(entity.name || 'entity').toLowerCase()}_${kind}_report"`;
  template.datasets[0].name = `${entity.label || entity.name} ${sheet.name} Dataset`;
  if (kind === 'audit') {
    const dateField = template.datasets[0].fields.find((field) =>
      /date|time/i.test(field.fieldPath || ''),
    );
    if (dateField?.fieldPath) {
      template.datasets[0].sort = [{ fieldPath: dateField.fieldPath, direction: 'desc' }];
    }
  }

  if (kind !== 'executive') {
    const palette = palettes[kind];
    for (const cell of Object.values(sheet.cells)) {
      const style = cell.style;
      if (!style) continue;
      const fillColor = style.fill?.fgColor;
      if (fillColor && palette[fillColor]) style.fill!.fgColor = palette[fillColor];
      const fontColor = style.font?.color;
      if (fontColor && palette[fontColor]) style.font!.color = palette[fontColor];
    }
  }

  addStarterCharts(template, entity, kind);
  return template;
}

// ─── Starter Charts ──────────────────────────────────────────────────────────

type StarterField = { id: string; name: string; type?: string; label?: string };

const STARTER_CHART_COLORS: Record<Exclude<GridStarterTemplateId, 'production'>, [string, string]> = {
  executive: ['#4F46E5', '#059669'],
  operations: ['#2563EB', '#D97706'],
  financial: ['#15803D', '#0F766E'],
  audit: ['#475569', '#0F766E'],
};

const isNumericStarterField = (f: StarterField) =>
  ['number', 'integer', 'decimal', 'float', 'currency'].includes((f.type || '').toLowerCase()) ||
  /price|amount|cost|total|quantity|units|volume|value|score|salary|revenue|budget/i.test(f.name);

const isDateStarterField = (f: StarterField) =>
  ['date', 'datetime', 'timestamp'].includes((f.type || '').toLowerCase()) || /date|time|created|updated|due/i.test(f.name);

const STATUS_FIELD_PATTERN = /status|state|stage|priority/i;
const CATEGORY_FIELD_PATTERN = /status|state|stage|priority|category|type|kind|department|team|region|owner|assignee|user|actor|action|group|segment/i;

interface StarterChartIntent {
  title: string;
  type: GridChartDefinition['type'];
  groupBy: GridDatasetGroupBy;
  aggregate: GridDatasetAggregate;
  /** Category charts show the top 10 by value; time series stay in date order. */
  timeSeries: boolean;
  options?: GridChartDefinition['options'];
}

/**
 * Adds up to two dataset-driven charts to an entity starter template: one beside the KPI cards
 * and table, one below the totals row. Each chart gets its own grouped dataset. Charts are only
 * added when the entity has suitable fields (a category, date, or numeric field).
 */
function addStarterCharts(
  template: GridExportTemplateDefinition,
  entity: ExecutiveReportEntityInput,
  kind: Exclude<GridStarterTemplateId, 'production'>,
): void {
  const sheet = template.sheets[0];
  const baseDataset = template.datasets[0];
  if (!sheet || !baseDataset) return;

  const fields = (entity.columns || entity.fields || []).filter((f): f is StarterField => Boolean(f?.name));
  const label = (f: StarterField) => f.label || f.name;
  const numeric = fields.find((f) => isNumericStarterField(f) && !isDateStarterField(f));
  const date =
    fields.find((f) => isDateStarterField(f) && /due|date/i.test(f.name) && kind === 'operations') ||
    fields.find((f) => isDateStarterField(f) && !/updated|deleted/i.test(f.name)) ||
    fields.find(isDateStarterField);
  const textFields = fields.filter((f) => !isNumericStarterField(f) && !isDateStarterField(f) && f.name.toLowerCase() !== 'id');
  const status = textFields.find((f) => STATUS_FIELD_PATTERN.test(f.name));
  const category = status || textFields.find((f) => CATEGORY_FIELD_PATTERN.test(f.name));

  const countAgg: GridDatasetAggregate = { id: 'agg_value', name: 'Records', fn: 'count' };
  const sumAgg = numeric
    ? { id: 'agg_value', name: `Total ${label(numeric)}`, fn: 'sum' as const, fieldPath: numeric.name }
    : null;

  const byCategory = (f: StarterField | undefined, type: GridChartDefinition['type'], agg = countAgg): StarterChartIntent | null =>
    f
      ? {
          title: `${agg.fn === 'count' ? 'Records' : agg.name} by ${label(f)}`,
          type,
          groupBy: { fieldPath: f.name },
          aggregate: agg,
          timeSeries: false,
        }
      : null;
  const overTime = (
    bucket: GridDatasetTimeBucket,
    type: GridChartDefinition['type'],
    agg = countAgg,
  ): StarterChartIntent | null =>
    date
      ? {
          title: `${agg.fn === 'count' ? 'Records' : agg.name} per ${bucket}`,
          type,
          groupBy: { fieldPath: date.name, dateBucket: bucket },
          aggregate: agg,
          timeSeries: true,
          options: { smooth: true, legend: false },
        }
      : null;

  const intentsByKind: Record<typeof kind, Array<StarterChartIntent | null>> = {
    executive: [
      byCategory(category, 'bar'),
      sumAgg ? overTime('month', 'area', sumAgg) : overTime('month', 'line'),
      overTime('month', 'line'),
    ],
    operations: [
      byCategory(status || category, 'donut'),
      overTime('week', 'bar'),
      byCategory(textFields.find((f) => /owner|assignee|team/i.test(f.name)), 'bar'),
    ],
    financial: [
      sumAgg ? overTime('month', 'area', sumAgg) : null,
      sumAgg ? byCategory(category, 'donut', sumAgg) : byCategory(category, 'donut'),
      overTime('month', 'line'),
    ],
    audit: [
      overTime('day', 'line'),
      byCategory(textFields.find((f) => /user|actor|owner|action|status/i.test(f.name)) || category, 'bar'),
    ],
  };

  const intents = intentsByKind[kind].filter((i): i is StarterChartIntent => Boolean(i)).slice(0, 2);
  if (intents.length === 0) return;

  // Layout: chart 1 sits right of the KPI cards and table (rows above the repeating region never
  // shift), chart 2 sits below the totals row and moves down as the region grows at export time.
  const colCount = Math.max(baseDataset.fields.length, 8);
  const tableEndCol = colCount - 1;
  const totalsRow = Math.max(...Object.keys(sheet.cells).map((k) => parseInt(k.split(':')[0], 10)));
  const anchors = [
    { startRow: 0, endRow: 17, startCol: colCount + 1, endCol: colCount + 7 },
    { startRow: totalsRow + 2, endRow: totalsRow + 16, startCol: 0, endCol: Math.min(tableEndCol, 7) },
  ];
  sheet.colWidths = { ...(sheet.colWidths || {}) };
  for (let c = colCount; c <= colCount + 7; c++) sheet.colWidths[String(c)] = c === colCount ? 24 : 90;

  const colors = STARTER_CHART_COLORS[kind];
  template.charts = intents.map((intent, idx) => {
    const datasetId = `ds_chart_${idx + 1}`;
    template.datasets.push({
      id: datasetId,
      name: `${intent.title} (chart)`,
      source: { baseEntityId: baseDataset.source.baseEntityId, joins: [] },
      fields: [],
      filters: [],
      sort: intent.timeSeries
        ? [{ fieldPath: intent.groupBy.fieldPath, direction: 'asc' }]
        : [{ fieldPath: intent.aggregate.id, direction: 'desc' }],
      ...(intent.timeSeries ? {} : { limit: 10 }),
      groupBy: [intent.groupBy],
      aggregates: [intent.aggregate],
      having: [],
    });
    return {
      id: `chart_${kind}_${idx + 1}`,
      title: intent.title,
      type: intent.type,
      source: {
        kind: 'dataset',
        datasetId,
        category: intent.groupBy.fieldPath,
        series: [{ aggregateId: intent.aggregate.id, name: intent.aggregate.name, color: colors[idx] }],
      },
      anchor: { sheetId: sheet.id, ...anchors[idx] },
      options: intent.options || { legend: intent.type === 'donut' || intent.type === 'pie' },
    };
  });
  template.schemaVersion = 3;
}

// ─── Production Target Tracker (interactive checkbox template) ──────────────

/** Machines on the line and their planned production days this month. */
const PRODUCTION_TRACKER_MACHINES: Array<{ name: string; planned: number }> = [
  { name: 'CNC Mill 01', planned: 26 },
  { name: 'CNC Mill 02', planned: 26 },
  { name: 'Lathe L-03', planned: 24 },
  { name: 'Press P-04', planned: 22 },
  { name: 'Injection Mold M-05', planned: 26 },
  { name: 'Welding Cell W-06', planned: 20 },
  { name: 'Paint Line PL-07', planned: 18 },
  { name: 'Assembly A-08', planned: 26 },
];

const PRODUCTION_WEEK_COLORS = ['#F43F5E', '#8B5CF6', '#0EA5E9', '#F59E0B', '#10B981'];

/** 0-based column index → A1 column letters. */
function gridColLetter(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

const PRODUCTION_DATASET_ID = 'ds_production';

/** Field name for a production_sheet day column: 1 → "day_01". */
export function productionDayField(day: number): string {
  return `day_${String(day).padStart(2, '0')}`;
}

export interface ProductionTrackerBinding {
  /** production_sheet entity: one record per machine per month. */
  productionEntityId: string;
  machineEntityId: string;
  /** production_sheet field referencing machine. */
  machineRefFieldId: string;
  /** Default for the month parameter, e.g. "2026-10-01". */
  defaultMonth: string;
}

/** production_sheet records for the month parameter, joined to machine for its name. */
function buildProductionTrackerDataset(binding: ProductionTrackerBinding): GridDatasetDefinition {
  return {
    id: PRODUCTION_DATASET_ID,
    name: 'Production sheets (selected month)',
    source: {
      baseEntityId: binding.productionEntityId,
      joins: [
        {
          id: 'j_machine',
          name: 'machine',
          referenceFieldId: binding.machineRefFieldId,
          targetEntityId: binding.machineEntityId,
          joinType: 'inner',
        },
      ],
    },
    fields: [
      { id: 'machine_name', name: 'Machine', fieldPath: 'machine.name' },
      { id: 'planned_days', name: 'Planned days', fieldPath: 'planned_days' },
      ...Array.from({ length: 31 }, (_, d) => ({
        id: productionDayField(d + 1),
        name: `Day ${d + 1}`,
        fieldPath: productionDayField(d + 1),
      })),
    ],
    filters: [{ fieldPath: 'month', operator: 'eq', parameterId: 'p_month' }],
    sort: [{ fieldPath: 'machine.name', direction: 'asc' }],
    groupBy: [],
    aggregates: [],
    having: [],
  };
}

/**
 * A self-contained monthly production target tracker. Each machine-day is a checkbox cell
 * (1 = daily production target met, 0 = missed or not run); every KPI, total and chart is a plain
 * SUM/IF/ROUND formula or a range chart over those formulas, so ticking a box updates everything
 * live in the designer and in the exported workbook.
 *
 * Layout (0-based rows):
 *   0-1   title + instructions          2-3  KPI cards
 *   5-16  charts: daily completion %, overall progress donut
 *   18    week bands                    19   header (machine, planned, days 1-31, met, gap, attainment)
 *   20-27 machines × 31 checkbox days   28   targets met per day   29  daily line attainment %
 *   30-34 per-week rows (feed the week-coloured bar chart)
 *   36-47 charts: targets met per day by week, machine attainment vs plan
 *   AL2:AM4 hold the two-cell data block behind the donut (kept above the machine rows).
 *
 * With `binding`, the machine rows come from a production_sheet dataset instead: row 20 becomes
 * a one-row repeating region (machine name, planned days, day_01..day_31 booleans) filtered by a
 * month parameter, and everything below it moves up so the region expands into place at export.
 * Range formulas, charts and the checkbox range that end on the region row grow with it.
 */
export function buildProductionTrackerTemplate(binding?: ProductionTrackerBinding): GridExportTemplateDefinition {
  const SHEET_ID = 'sheet_production';
  const NAVY = '#1E293B';
  const SLATE = '#334155';
  const MUTED = '#64748B';
  const LINE = '#E2E8F0';
  const SOFT = '#F8FAFC';
  const WHITE = '#FFFFFF';
  const EMERALD = '#10B981';
  const font = (size: number, color: string, bold = false) => ({ name: 'Calibri', size, color, bold });
  const thinBorder = { style: 'thin' as const, color: LINE };
  const boxBorder = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // Bound templates hold a single region row that expands to one row per production_sheet record
  const MACHINE_COUNT = binding ? 1 : PRODUCTION_TRACKER_MACHINES.length;
  const DAYS = 31;
  const FIRST_DAY_COL = 2; // C
  const LAST_DAY_COL = FIRST_DAY_COL + DAYS - 1; // AG
  const DONE_COL = LAST_DAY_COL + 1; // AH
  const LEFT_COL = DONE_COL + 1; // AI
  const PROGRESS_COL = LEFT_COL + 1; // AJ
  const LAST_COL = PROGRESS_COL;
  const DATA_LABEL_COL = LAST_COL + 2; // AL
  const DATA_VALUE_COL = DATA_LABEL_COL + 1; // AM

  const WEEK_ROW = 18;
  const HEADER_ROW = 19;
  const FIRST_MACHINE_ROW = 20;
  const LAST_MACHINE_ROW = FIRST_MACHINE_ROW + MACHINE_COUNT - 1; // 27
  const COMPLETED_ROW = LAST_MACHINE_ROW + 1; // 28
  const PERCENT_ROW = COMPLETED_ROW + 1; // 29
  const FIRST_WEEK_SERIES_ROW = PERCENT_ROW + 1; // 30..34

  const L = gridColLetter;
  const A1 = (row: number, col: number) => `${L(col)}${row + 1}`;
  const rangeA1 = (r1: number, c1: number, r2: number, c2: number) => `${A1(r1, c1)}:${A1(r2, c2)}`;

  const cells: Record<string, GridCellDefinition> = {};
  const merges: GridMergeRange[] = [];
  const set = (row: number, col: number, cell: GridCellDefinition) => {
    cells[`${row}:${col}`] = cell;
  };
  const band = (row: number, c1: number, c2: number, cell: GridCellDefinition) => {
    for (let c = c1; c <= c2; c++) set(row, c, c === c1 ? cell : { style: cell.style });
    if (c2 > c1) merges.push({ startRow: row, startCol: c1, endRow: row, endCol: c2 });
  };

  // Title + instructions
  band(0, 0, LAST_COL, {
    value: 'PRODUCTION TARGET TRACKER',
    style: { font: font(18, WHITE, true), fill: { fgColor: NAVY }, alignment: { horizontal: 'left', vertical: 'middle' } },
  });
  band(1, 0, LAST_COL, {
    value: 'Tick a box when a machine meets its daily production target. Every total, KPI and chart on this sheet updates instantly.',
    style: { font: { ...font(10, '#CBD5E1'), italic: true }, fill: { fgColor: SLATE }, alignment: { horizontal: 'left', vertical: 'middle' } },
  });

  // KPI cards (labels row 2, values row 3)
  const machinesRef = rangeA1(FIRST_MACHINE_ROW, 0, LAST_MACHINE_ROW, 0);
  const kpis: Array<{ label: string; c1: number; c2: number; formula: string; numFmt: string; color: string; bg: string }> = [
    { label: 'MACHINES', c1: 0, c2: 1, formula: `COUNTA(${machinesRef})`, numFmt: '0', color: NAVY, bg: SOFT },
    { label: 'PLANNED RUN DAYS', c1: 2, c2: 9, formula: `SUM(${rangeA1(FIRST_MACHINE_ROW, 1, LAST_MACHINE_ROW, 1)})`, numFmt: '#,##0', color: '#4F46E5', bg: '#EEF2FF' },
    { label: 'TARGETS MET', c1: 10, c2: 17, formula: `SUM(${rangeA1(FIRST_MACHINE_ROW, DONE_COL, LAST_MACHINE_ROW, DONE_COL)})`, numFmt: '#,##0', color: '#047857', bg: '#ECFDF5' },
    { label: 'TARGETS MISSED', c1: 18, c2: 25, formula: `SUM(${rangeA1(FIRST_MACHINE_ROW, LEFT_COL, LAST_MACHINE_ROW, LEFT_COL)})`, numFmt: '#,##0', color: '#B45309', bg: '#FFFBEB' },
    { label: 'TARGET ATTAINMENT', c1: 26, c2: LAST_COL, formula: `IF(C4>0,ROUND(K4/MAX(C4,1),3),0)`, numFmt: '0.0%', color: '#7C3AED', bg: '#F5F3FF' },
  ];
  for (const k of kpis) {
    band(2, k.c1, k.c2, {
      value: k.label,
      style: { font: font(9, MUTED, true), fill: { fgColor: k.bg }, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
    band(3, k.c1, k.c2, {
      value: 0,
      formula: k.formula,
      numFmt: k.numFmt,
      style: { font: font(18, k.color, true), fill: { fgColor: k.bg }, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
  }

  // Week bands + header row
  const headerStyle = (horizontal: 'left' | 'center' = 'center'): GridCellStyle => ({
    font: font(9, WHITE, true),
    fill: { fgColor: NAVY },
    alignment: { horizontal, vertical: 'middle' },
  });
  for (let w = 0; w < 5; w++) {
    const c1 = FIRST_DAY_COL + w * 7;
    const c2 = Math.min(c1 + 6, LAST_DAY_COL);
    band(WEEK_ROW, c1, c2, {
      value: `WEEK ${w + 1}`,
      style: {
        font: font(9, PRODUCTION_WEEK_COLORS[w], true),
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: { bottom: { style: 'medium', color: PRODUCTION_WEEK_COLORS[w] } },
      },
    });
  }
  set(HEADER_ROW, 0, { value: 'MACHINE / WORK CENTER', style: headerStyle('left') });
  set(HEADER_ROW, 1, { value: 'PLAN', style: headerStyle() });
  for (let d = 0; d < DAYS; d++) set(HEADER_ROW, FIRST_DAY_COL + d, { value: d + 1, style: headerStyle() });
  set(HEADER_ROW, DONE_COL, { value: 'MET', style: headerStyle() });
  set(HEADER_ROW, LEFT_COL, { value: 'GAP', style: headerStyle() });
  set(HEADER_ROW, PROGRESS_COL, { value: 'ATTAIN.', style: headerStyle() });

  // Machine rows: sample ticks for the first 20 days so the charts read well out of the box.
  // Row formulas read the plan as MAX(B21:B21,0) so a bound template's text placeholder
  // ("{{ Plan }}" in design view) evaluates to 0 rather than #VALUE! / #DIV/0!. (Univer's SUM over
  // text-only cells returns the string "0", which then fails comparisons and subtraction.)
  // A bound template has one empty region row whose values come from the dataset.
  const machineRows = binding ? [null] : PRODUCTION_TRACKER_MACHINES;
  machineRows.forEach((machine, h) => {
    const row = FIRST_MACHINE_ROW + h;
    const fill = { fgColor: h % 2 === 0 ? WHITE : SOFT };
    const rate = machine ? Math.round((machine.planned / DAYS) * 10) : 0;
    set(row, 0, { value: machine ? machine.name : '', style: { font: font(10, NAVY, true), fill, border: boxBorder, alignment: { horizontal: 'left', vertical: 'middle' } } });
    set(row, 1, { value: machine ? machine.planned : '', numFmt: '0', style: { font: font(10, SLATE), fill, border: boxBorder, alignment: { horizontal: 'center', vertical: 'middle' } } });
    for (let d = 0; d < DAYS; d++) {
      const ticked = d < 20 && (h * 7 + d * 3) % 10 < rate;
      set(row, FIRST_DAY_COL + d, {
        value: machine ? (ticked ? 1 : 0) : '',
        style: { font: font(10, EMERALD, true), fill, border: boxBorder, alignment: { horizontal: 'center', vertical: 'middle' } },
      });
    }
    const r1 = row + 1;
    set(row, DONE_COL, {
      value: 0,
      formula: `SUM(${L(FIRST_DAY_COL)}${r1}:${L(LAST_DAY_COL)}${r1})`,
      numFmt: '0',
      style: { font: font(10, '#047857', true), fill, border: boxBorder, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
    set(row, LEFT_COL, {
      value: 0,
      formula: `IF(MAX(B${r1}:B${r1},0)>${L(DONE_COL)}${r1},MAX(B${r1}:B${r1},0)-${L(DONE_COL)}${r1},0)`,
      numFmt: '0',
      style: { font: font(10, '#B45309'), fill, border: boxBorder, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
    set(row, PROGRESS_COL, {
      value: 0,
      formula: `IF(MAX(B${r1}:B${r1},0)>0,ROUND(${L(DONE_COL)}${r1}/MAX(B${r1}:B${r1},1),2),0)`,
      numFmt: '0%',
      style: { font: font(10, '#7C3AED', true), fill, border: boxBorder, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
  });

  // Daily totals, daily completion %, and per-week rows behind the week-coloured bar chart
  const summaryLabel = (row: number, text: string, color = SLATE) =>
    set(row, 0, { value: text, style: { font: font(9, color, true), fill: { fgColor: '#F1F5F9' }, alignment: { horizontal: 'left', vertical: 'middle' } } });
  summaryLabel(COMPLETED_ROW, 'TARGETS MET');
  summaryLabel(PERCENT_ROW, 'LINE ATTAIN. %');
  set(COMPLETED_ROW, 1, { style: { fill: { fgColor: '#F1F5F9' } } });
  set(PERCENT_ROW, 1, { style: { fill: { fgColor: '#F1F5F9' } } });
  for (let d = 0; d < DAYS; d++) {
    const col = FIRST_DAY_COL + d;
    const colL = L(col);
    set(COMPLETED_ROW, col, {
      value: 0,
      formula: `SUM(${colL}${FIRST_MACHINE_ROW + 1}:${colL}${LAST_MACHINE_ROW + 1})`,
      numFmt: '0',
      style: { font: font(9, NAVY, true), fill: { fgColor: '#F1F5F9' }, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
    set(PERCENT_ROW, col, {
      value: 0,
      formula: `IF(A4>0,ROUND(${colL}${COMPLETED_ROW + 1}*100/MAX(A4,1),0),0)`,
      numFmt: '0',
      style: { font: font(8, MUTED), fill: { fgColor: '#F1F5F9' }, alignment: { horizontal: 'center', vertical: 'middle' } },
    });
  }
  for (let w = 0; w < 5; w++) {
    const row = FIRST_WEEK_SERIES_ROW + w;
    summaryLabel(row, `Week ${w + 1}`, PRODUCTION_WEEK_COLORS[w]);
    for (let d = w * 7; d < Math.min(w * 7 + 7, DAYS); d++) {
      const col = FIRST_DAY_COL + d;
      set(row, col, {
        value: 0,
        formula: `${L(col)}${COMPLETED_ROW + 1}`,
        numFmt: '0',
        style: { font: font(8, PRODUCTION_WEEK_COLORS[w]), alignment: { horizontal: 'center', vertical: 'middle' } },
      });
    }
  }

  // Donut data block (AL2:AM4), above the machine rows so a repeating region never touches it
  const DONUT_FIRST_ROW = 2;
  set(1, DATA_LABEL_COL, { value: 'CHART DATA', style: headerStyle('left') });
  set(1, DATA_VALUE_COL, { value: '', style: headerStyle() });
  set(DONUT_FIRST_ROW, DATA_LABEL_COL, { value: 'Target met', style: { font: font(9, SLATE), border: boxBorder } });
  set(DONUT_FIRST_ROW, DATA_VALUE_COL, { value: 0, formula: 'K4', numFmt: '0', style: { font: font(9, SLATE, true), border: boxBorder } });
  set(DONUT_FIRST_ROW + 1, DATA_LABEL_COL, { value: 'Target missed', style: { font: font(9, SLATE), border: boxBorder } });
  set(DONUT_FIRST_ROW + 1, DATA_VALUE_COL, { value: 0, formula: 'S4', numFmt: '0', style: { font: font(9, SLATE, true), border: boxBorder } });

  const CHART2_START_ROW = FIRST_WEEK_SERIES_ROW + 6; // 36 for the sample layout
  const CHART2_END_ROW = CHART2_START_ROW + 11;

  const dayCategories = rangeA1(HEADER_ROW, FIRST_DAY_COL, HEADER_ROW, LAST_DAY_COL);
  const rangeChart = (
    id: string,
    title: string,
    type: GridChartDefinition['type'],
    categoryRange: string,
    series: Array<{ name: string; range: string; color: string }>,
    anchor: { startRow: number; endRow: number; startCol: number; endCol: number },
    options: GridChartDefinition['options'],
  ): GridChartDefinition => ({
    id,
    title,
    type,
    source: { kind: 'range', sheetId: SHEET_ID, categoryRange, series },
    anchor: { sheetId: SHEET_ID, ...anchor },
    options,
  });

  const charts: GridChartDefinition[] = [
    rangeChart(
      'chart_production_daily_pct',
      'Daily Line Attainment %',
      'area',
      dayCategories,
      [{ name: 'Attainment %', range: rangeA1(PERCENT_ROW, FIRST_DAY_COL, PERCENT_ROW, LAST_DAY_COL), color: EMERALD }],
      { startRow: 5, endRow: 16, startCol: 0, endCol: 23 },
      { legend: false, yAxisTitle: '% of machines on target' },
    ),
    rangeChart(
      'chart_production_overall',
      'Monthly Target Attainment',
      'donut',
      rangeA1(DONUT_FIRST_ROW, DATA_LABEL_COL, DONUT_FIRST_ROW + 1, DATA_LABEL_COL),
      [{ name: 'Machine-days', range: rangeA1(DONUT_FIRST_ROW, DATA_VALUE_COL, DONUT_FIRST_ROW + 1, DATA_VALUE_COL), color: EMERALD }],
      { startRow: 5, endRow: 16, startCol: 24, endCol: LAST_COL },
      { legend: true, sliceColors: [EMERALD, '#CBD5E1'] },
    ),
    rangeChart(
      'chart_production_per_day',
      'Machines on Target per Day',
      'bar',
      dayCategories,
      PRODUCTION_WEEK_COLORS.map((color, w) => ({
        name: `Week ${w + 1}`,
        range: rangeA1(FIRST_WEEK_SERIES_ROW + w, FIRST_DAY_COL, FIRST_WEEK_SERIES_ROW + w, LAST_DAY_COL),
        color,
      })),
      { startRow: CHART2_START_ROW, endRow: CHART2_END_ROW, startCol: 0, endCol: 23 },
      { stacked: true, legend: true },
    ),
    rangeChart(
      'chart_production_progress',
      'Machine Days on Target vs Plan',
      'bar',
      machinesRef,
      [
        { name: 'Met', range: rangeA1(FIRST_MACHINE_ROW, DONE_COL, LAST_MACHINE_ROW, DONE_COL), color: EMERALD },
        { name: 'Planned', range: rangeA1(FIRST_MACHINE_ROW, 1, LAST_MACHINE_ROW, 1), color: '#94A3B8' },
      ],
      { startRow: CHART2_START_ROW, endRow: CHART2_END_ROW, startCol: 24, endCol: LAST_COL },
      { legend: true },
    ),
  ];

  const colWidths: Record<string, number> = { '0': 150, '1': 50 };
  for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) colWidths[String(c)] = 30;
  colWidths[String(DONE_COL)] = 56;
  colWidths[String(LEFT_COL)] = 56;
  colWidths[String(PROGRESS_COL)] = 76;
  colWidths[String(LAST_COL + 1)] = 20;
  colWidths[String(DATA_LABEL_COL)] = 90;
  colWidths[String(DATA_VALUE_COL)] = 60;

  const rowHeights: Record<string, number> = { '0': 40, '1': 22, '2': 20, '3': 34, '4': 10, '17': 14 };
  rowHeights[String(CHART2_START_ROW - 1)] = 14;
  for (let r = 5; r <= 16; r++) rowHeights[String(r)] = 22;
  for (let r = CHART2_START_ROW; r <= CHART2_END_ROW; r++) rowHeights[String(r)] = 22;
  rowHeights[String(WEEK_ROW)] = 20;
  rowHeights[String(HEADER_ROW)] = 24;
  for (let r = FIRST_MACHINE_ROW; r <= LAST_MACHINE_ROW; r++) rowHeights[String(r)] = 24;

  return {
    kind: 'grid',
    version: 1,
    schemaVersion: 3,
    parameters: binding
      ? [{ id: 'p_month', name: 'month', label: 'Month', type: 'date', required: false, defaultValue: binding.defaultMonth }]
      : [],
    datasets: binding ? [buildProductionTrackerDataset(binding)] : [],
    charts,
    sheets: [
      {
        id: SHEET_ID,
        name: 'Production Tracker',
        order: 0,
        rowHeights,
        colWidths,
        merges,
        cells,
        regions: binding
          ? [
              {
                id: 'reg_machines',
                datasetId: PRODUCTION_DATASET_ID,
                displayLabel: 'Machines',
                startRow: FIRST_MACHINE_ROW,
                endRow: FIRST_MACHINE_ROW,
                startCol: 0,
                endCol: LAST_DAY_COL,
                columns: [
                  { col: 0, fieldId: 'machine_name', displayLabel: 'Machine' },
                  { col: 1, fieldId: 'planned_days', displayLabel: 'Plan' },
                  ...Array.from({ length: DAYS }, (_, d) => ({
                    col: FIRST_DAY_COL + d,
                    fieldId: productionDayField(d + 1),
                    displayLabel: String(d + 1),
                  })),
                ],
              },
            ]
          : [],
        conditionalFormats: [],
        dataValidations: [
          {
            id: 'dv_production_checks',
            ref: rangeA1(FIRST_MACHINE_ROW, FIRST_DAY_COL, LAST_MACHINE_ROW, LAST_DAY_COL),
            type: 'checkbox',
            checkedValue: 1,
            uncheckedValue: 0,
          },
        ],
      },
    ],
    filenameExpression: '"production_target_tracker"',
    pdf: { mode: 'table' },
  };
}
