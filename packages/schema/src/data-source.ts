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
