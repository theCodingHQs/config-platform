import { z } from 'zod';
import { FieldDefSchema } from './fields.js';
import { AllowedIconNameSchema } from './icons.js';

export const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  schemaVersion: z.number().int().default(1),
  createdAt: z.string().or(z.date()).optional(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const EntityDefSchema = z.object({
  id: z.string(), // stable table id e.g. t_8f2a
  tenantId: z.string(),
  name: z.string(), // semantic name e.g. "customer"
  label: z.string(), // friendly display label e.g. "Customer"
  physicalTableName: z.string(), // same as id or physical identifier e.g. t_8f2a
  version: z.number().int().default(1), // for optimistic locking
  displayFieldId: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  createdAt: z.string().or(z.date()).optional(),
  updatedAt: z.string().or(z.date()).optional(),
});

export type EntityDef = z.infer<typeof EntityDefSchema>;

export const RelationDefSchema = z.object({
  id: z.string(), // e.g. r_1a2b
  tenantId: z.string(),
  name: z.string(),
  sourceEntityId: z.string(),
  sourceFieldId: z.string(),
  targetEntityId: z.string(),
  targetFieldId: z.string().optional(),
  relationType: z.enum(['many_to_one', 'one_to_many', 'one_to_one']).default('many_to_one'),
  createdAt: z.string().or(z.date()).optional(),
});

export type RelationDef = z.infer<typeof RelationDefSchema>;

export const PageDefSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  route: z.string(),
  draft: z.record(z.any()), // JSON component tree
  published: z.record(z.any()).nullable().optional(),
  version: z.number().int().default(1),
  createdAt: z.string().or(z.date()).optional(),
  updatedAt: z.string().or(z.date()).optional(),
});

export type PageDef = z.infer<typeof PageDefSchema>;

export const SchemaMigrationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  version: z.number().int(),
  ddl: z.string(),
  status: z.enum(['applied', 'failed', 'rolled_back']),
  createdAt: z.string().or(z.date()).optional(),
});

export type SchemaMigration = z.infer<typeof SchemaMigrationSchema>;

export const CompleteEntitySchema = EntityDefSchema.extend({
  fields: z.array(FieldDefSchema),
  relations: z.array(RelationDefSchema).optional(),
});

export type CompleteEntity = z.infer<typeof CompleteEntitySchema>;
