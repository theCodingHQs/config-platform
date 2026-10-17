import { z } from 'zod';

export const ChartTypeSchema = z.enum(['bar', 'line', 'area', 'pie', 'donut', 'combo']);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const CHART_LIMITS = {
  MAX_CHARTS_PER_TEMPLATE: 20,
  MAX_SERIES_PER_CHART: 8,
  MAX_POINTS_PER_SERIES: 1_000,
  MAX_TITLE_LENGTH: 120,
};

export const ChartColorSchema = z.string().refine((val) => {
  if (!val || typeof val !== 'string') return false;
  // Valid hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val.trim())) return true;
  // Valid theme token name: e.g. "accent", "primary", "success", "danger", "neutral"
  if (/^[a-zA-Z][a-zA-Z0-9_\-\.]*$/.test(val.trim())) return true;
  return false;
}, { message: 'Color must be a valid hex color string (e.g. #4F46E5) or theme token name' });

export const ChartAnchorSchema = z.object({
  sheetId: z.string().min(1, 'sheetId is required in chart anchor'),
  startRow: z.number().int().min(0, 'startRow must be >= 0'),
  startCol: z.number().int().min(0, 'startCol must be >= 0'),
  endRow: z.number().int().min(0, 'endRow must be >= 0'),
  endCol: z.number().int().min(0, 'endCol must be >= 0'),
}).refine((a) => a.endRow >= a.startRow && a.endCol >= a.startCol, {
  message: 'endRow and endCol must be greater than or equal to startRow and startCol',
});
export type ChartAnchor = z.infer<typeof ChartAnchorSchema>;

export const ChartDatasetSeriesSchema = z.object({
  fieldId: z.string().optional(),
  aggregateId: z.string().optional(),
  name: z.string().optional(),
  color: ChartColorSchema.optional(),
  type: z.enum(['bar', 'line', 'area']).optional(),
}).refine((s) => Boolean(s.fieldId || s.aggregateId), {
  message: 'Dataset chart series must specify either fieldId or aggregateId',
});
export type ChartDatasetSeries = z.infer<typeof ChartDatasetSeriesSchema>;

export const ChartTimeBucketSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type ChartTimeBucket = z.infer<typeof ChartTimeBucketSchema>;

export const ChartDatasetCategorySchema = z.union([
  z.string().min(1),
  z.object({
    fieldId: z.string().min(1),
    timeBucket: ChartTimeBucketSchema.optional(),
  }),
]);
export type ChartDatasetCategory = z.infer<typeof ChartDatasetCategorySchema>;

export const ChartDatasetSourceSchema = z.object({
  kind: z.literal('dataset'),
  datasetId: z.string().min(1, 'datasetId is required'),
  category: ChartDatasetCategorySchema,
  series: z.array(ChartDatasetSeriesSchema)
    .min(1, 'At least 1 series required')
    .max(CHART_LIMITS.MAX_SERIES_PER_CHART, `Max ${CHART_LIMITS.MAX_SERIES_PER_CHART} series allowed per chart`),
});
export type ChartDatasetSource = z.infer<typeof ChartDatasetSourceSchema>;

export const ChartRangeSeriesSchema = z.object({
  name: z.string().min(1, 'Series name is required'),
  range: z.string().min(1, 'Series range is required'),
  color: ChartColorSchema.optional(),
  type: z.enum(['bar', 'line', 'area']).optional(),
});
export type ChartRangeSeries = z.infer<typeof ChartRangeSeriesSchema>;

export const ChartRangeSourceSchema = z.object({
  kind: z.literal('range'),
  sheetId: z.string().min(1, 'sheetId is required for range source'),
  categoryRange: z.string().optional(),
  series: z.array(ChartRangeSeriesSchema)
    .min(1, 'At least 1 series required')
    .max(CHART_LIMITS.MAX_SERIES_PER_CHART, `Max ${CHART_LIMITS.MAX_SERIES_PER_CHART} series allowed per chart`),
});
export type ChartRangeSource = z.infer<typeof ChartRangeSourceSchema>;

export const ChartSourceSchema = z.discriminatedUnion('kind', [
  ChartDatasetSourceSchema,
  ChartRangeSourceSchema,
]);
export type ChartSource = z.infer<typeof ChartSourceSchema>;

export const ChartOptionsSchema = z.object({
  stacked: z.boolean().optional(),
  legend: z.boolean().optional(),
  smooth: z.boolean().optional(),
  area: z.boolean().optional(),
  xAxisTitle: z.string().optional(),
  yAxisTitle: z.string().optional(),
});
export type ChartOptions = z.infer<typeof ChartOptionsSchema>;

export const GridChartDefinitionSchema = z.object({
  id: z.string().min(1, 'Chart id is required'),
  title: z.string().max(CHART_LIMITS.MAX_TITLE_LENGTH, `Title cannot exceed ${CHART_LIMITS.MAX_TITLE_LENGTH} characters`).default(''),
  type: ChartTypeSchema,
  source: ChartSourceSchema,
  anchor: ChartAnchorSchema,
  options: ChartOptionsSchema.optional().default({}),
});
export type GridChartDefinition = z.infer<typeof GridChartDefinitionSchema>;
