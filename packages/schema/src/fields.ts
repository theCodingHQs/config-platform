import { z } from 'zod';

export const FieldTypeSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'reference',
]);

export type FieldType = z.infer<typeof FieldTypeSchema>;

export const TextFieldConfigSchema = z.object({
  maxLength: z.number().int().positive().optional(),
  multiline: z.boolean().optional(),
  defaultValue: z.string().optional(),
});

export const NumberFieldConfigSchema = z.object({
  precision: z.number().int().optional(),
  scale: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  defaultValue: z.number().optional(),
});

export const BooleanFieldConfigSchema = z.object({
  defaultValue: z.boolean().optional(),
});

export const DateFieldConfigSchema = z.object({
  /** Date & time (a moment, shown in the viewer's time zone) instead of a calendar date. */
  includeTime: z.boolean().optional(),
  defaultNow: z.boolean().optional(),
  /** Calendar dates only: 'month' stores the 1st of the month and shows/picks a month. */
  granularity: z.enum(['day', 'month']).optional(),
});

export const SelectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  color: z.string().optional(),
});

export const SelectFieldConfigSchema = z.object({
  options: z.array(SelectOptionSchema).default([]),
  defaultValue: z.string().optional(),
});

export const ReferenceFieldConfigSchema = z.object({
  targetEntityId: z.string(),
  targetFieldId: z.string().optional(), // usually targets the primary key 'id'
  onDelete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT']).default('RESTRICT'),
  displayFieldId: z.string().optional(), // field to display in UI for lookup
});

export const FieldConfigSchema = z.object({
  // Select
  options: z.array(SelectOptionSchema).optional(),
  // Reference
  targetEntityId: z.string().optional(),
  targetFieldId: z.string().optional(),
  onDelete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT']).optional(),
  displayFieldId: z.string().optional(),
  // Text
  maxLength: z.number().int().positive().optional(),
  multiline: z.boolean().optional(),
  // Number
  precision: z.number().int().optional(),
  scale: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  // Date ('precision' above is for numbers; a date's day/month choice is 'granularity')
  includeTime: z.boolean().optional(),
  defaultNow: z.boolean().optional(),
  granularity: z.enum(['day', 'month']).optional(),
  // Calculated (number, text, yes/no): the value comes from this formula, never from input
  formula: z.string().max(500).optional(),
  // Common
  defaultValue: z.any().optional(),
}).passthrough();

export type FieldConfig = z.infer<typeof FieldConfigSchema>;

export const FieldDefSchema = z.object({
  id: z.string(), // e.g. c_91bd
  tenantId: z.string(),
  entityId: z.string(), // e.g. t_8f2a
  name: z.string(), // semantic name/slug
  label: z.string(), // human label
  physicalColumnName: z.string(), // stable identifier e.g. c_91bd
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
  position: z.number().int().default(0),
  config: FieldConfigSchema.default({}),
  createdAt: z.string().or(z.date()).optional(),
  updatedAt: z.string().or(z.date()).optional(),
});

export type FieldDef = z.infer<typeof FieldDefSchema>;
