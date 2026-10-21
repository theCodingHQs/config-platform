import { z } from 'zod';

export const DataSourceFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.any()),
]);

export const DataSourceSortSchema = z.object({
  fieldId: z.string(),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type DataSourceSort = z.infer<typeof DataSourceSortSchema>;

export const DataSourceDefinitionSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  filter: z.record(DataSourceFilterValueSchema).optional(),
  sort: DataSourceSortSchema.optional(),
  limit: z.number().int().positive().optional().default(10),
});

export type DataSourceDefinition = z.infer<typeof DataSourceDefinitionSchema>;

/** Record filter operators understood by the records API (`filter[field][op]=value`). */
export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'isNull';

/** Operators each field type accepts; the records API rejects any other combination. */
export const FILTER_OPS_BY_FIELD_TYPE: Record<string, FilterOp[]> = {
  text: ['eq', 'neq', 'contains', 'in', 'isNull'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  boolean: ['eq', 'neq', 'isNull'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull'],
  select: ['eq', 'neq', 'in', 'isNull'],
  reference: ['eq', 'neq', 'in', 'isNull'],
  // System fields
  id: ['eq', 'neq', 'in'],
  created_at: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  updated_at: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};
