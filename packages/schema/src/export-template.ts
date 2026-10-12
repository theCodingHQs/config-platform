import { z } from 'zod';

export const ExportColumnFormatSchema = z.enum([
  'text',
  'number',
  'currency',
  'percentage',
  'date_iso',
  'date_locale',
  'datetime_iso',
  'boolean_true_false',
  'boolean_yes_no',
]).default('text');
export type ExportColumnFormat = z.infer<typeof ExportColumnFormatSchema>;

export const ExportTemplateColumnSchema = z.object({
  fieldId: z.string().min(1, 'Field ID is required'),
  header: z.string().optional(),
  format: z.string().optional().default('text'),
});
export type ExportTemplateColumn = z.infer<typeof ExportTemplateColumnSchema>;

export const ExportTemplateSortSchema = z.object({
  fieldId: z.string().min(1, 'Field ID is required'),
  direction: z.enum(['asc', 'desc', 'ASC', 'DESC']).default('asc'),
});
export type ExportTemplateSort = z.infer<typeof ExportTemplateSortSchema>;

export const ExportTemplateFilterSchema = z.object({
  fieldId: z.string().min(1, 'Field ID is required'),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'isNull']),
  value: z.any().optional(),
});
export type ExportTemplateFilter = z.infer<typeof ExportTemplateFilterSchema>;

export const SimpleExportTemplateDefinitionSchema = z.object({
  kind: z.literal('simple').default('simple'),
  columns: z.array(ExportTemplateColumnSchema).default([]),
  defaultSort: z.array(ExportTemplateSortSchema).optional().default([]),
  defaultFilters: z.array(ExportTemplateFilterSchema).optional().default([]),
  includeHeader: z.boolean().default(true),
  csv: z.object({
    delimiter: z.enum([',', ';', '\t', '|']).default(','),
    bom: z.boolean().default(false),
  }).default({ delimiter: ',', bom: false }),
  filenameExpression: z.string().optional().default(''),
  pdf: z.object({
    mode: z.enum(['table', 'layout']).default('table'),
  }).default({ mode: 'table' }),
});
export type SimpleExportTemplateDefinition = z.infer<typeof SimpleExportTemplateDefinitionSchema>;

import { BaseGridExportTemplateDefinitionSchema, GridExportTemplateDefinitionSchema } from './export-template-grid.js';

export const ExportTemplateDefinitionSchema = z
  .discriminatedUnion('kind', [
    SimpleExportTemplateDefinitionSchema,
    BaseGridExportTemplateDefinitionSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.kind === 'grid') {
      const res = GridExportTemplateDefinitionSchema.safeParse(val);
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue(issue);
        }
      }
    }
  });
export type ExportTemplateDefinition = z.infer<typeof ExportTemplateDefinitionSchema>;

export const ExportTemplateSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  name: z.string().min(1, 'Template name is required'),
  entityId: z.string().min(1, 'Entity is required'),
  draft: ExportTemplateDefinitionSchema,
  published: ExportTemplateDefinitionSchema.nullable().optional(),
  version: z.number().int().default(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ExportTemplate = z.infer<typeof ExportTemplateSchema>;
