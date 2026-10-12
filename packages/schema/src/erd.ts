import { z } from 'zod';
import { FieldTypeSchema } from './fields.js';

export const ErdColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  physicalColumnName: z.string(),
  type: FieldTypeSchema,
  required: z.boolean(),
  unique: z.boolean(),
  isPrimary: z.boolean(),
  position: z.number().default(0),
  isForeignKey: z.boolean().default(false),
  config: z.record(z.any()).optional().default({}),
  references: z.object({
    entityId: z.string(),
    fieldId: z.string(),
    tableName: z.string(),
  }).optional(),
});

export type ErdColumn = z.infer<typeof ErdColumnSchema>;

export const ErdTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  physicalTableName: z.string(),
  version: z.number(),
  displayFieldId: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  columns: z.array(ErdColumnSchema),
  fields: z.array(ErdColumnSchema).optional(),
});

export type ErdTable = z.infer<typeof ErdTableSchema>;

export const ErdRelationshipSchema = z.object({
  id: z.string(),
  name: z.string(),
  fromTable: z.string(),
  fromColumn: z.string(),
  toTable: z.string(),
  toColumn: z.string(),
  relationType: z.string(),
});

export type ErdRelationship = z.infer<typeof ErdRelationshipSchema>;

export const ErdModelSchema = z.object({
  tenantId: z.string(),
  tables: z.array(ErdTableSchema),
  relationships: z.array(ErdRelationshipSchema),
});

export type ErdModel = z.infer<typeof ErdModelSchema>;
