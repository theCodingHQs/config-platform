import { z } from 'zod';
import { FieldTypeSchema, FieldConfigSchema } from './fields.js';

export const CreateEntityInputSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/, 'Name must be alphanumeric'),
  label: z.string().min(1),
  displayFieldId: z.string().nullable().optional(),
  fields: z.array(z.object({
    name: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
    label: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    unique: z.boolean().default(false),
    config: FieldConfigSchema.default({}),
  })).optional().default([]),
});

export type CreateEntityInput = z.infer<typeof CreateEntityInputSchema>;

export const UpdateEntityInputSchema = z.object({
  entityId: z.string(),
  expectedVersion: z.number().int(),
  label: z.string().min(1).optional(),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/).optional(),
  displayFieldId: z.string().nullable().optional(),
});

export type UpdateEntityInput = z.infer<typeof UpdateEntityInputSchema>;

export const AddFieldInputSchema = z.object({
  entityId: z.string(),
  expectedVersion: z.number().int(),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
  label: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  config: FieldConfigSchema.default({}),
});

export type AddFieldInput = z.infer<typeof AddFieldInputSchema>;

export const UpdateFieldInputSchema = z.object({
  entityId: z.string(),
  fieldId: z.string(),
  expectedVersion: z.number().int(),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/).optional(),
  label: z.string().min(1).optional(),
  type: FieldTypeSchema.optional(), // triggers expand/contract if changed
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  config: FieldConfigSchema.optional(),
});

export type UpdateFieldInput = z.infer<typeof UpdateFieldInputSchema>;

export const DropFieldInputSchema = z.object({
  entityId: z.string(),
  fieldId: z.string(),
  expectedVersion: z.number().int(),
});

export type DropFieldInput = z.infer<typeof DropFieldInputSchema>;

export const DropEntityInputSchema = z.object({
  entityId: z.string(),
  expectedVersion: z.number().int(),
});

export type DropEntityInput = z.infer<typeof DropEntityInputSchema>;

export const AddRelationInputSchema = z.object({
  name: z.string().min(1),
  sourceEntityId: z.string(),
  sourceFieldId: z.string(),
  targetEntityId: z.string(),
  targetFieldId: z.string().optional(),
  relationType: z.enum(['many_to_one', 'one_to_many', 'one_to_one']).default('many_to_one'),
  onDelete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT']).default('RESTRICT'),
});

export type AddRelationInput = z.infer<typeof AddRelationInputSchema>;

export const MigrationResultSchema = z.object({
  success: z.boolean(),
  migrationId: z.string(),
  version: z.number().int(),
  ddl: z.string(),
  appliedAt: z.string(),
  entityId: z.string().optional(),
});

export type MigrationResult = z.infer<typeof MigrationResultSchema>;
