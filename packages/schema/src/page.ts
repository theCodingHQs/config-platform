import { z } from 'zod';
import { ActionDefinitionSchema, type ActionDefinition } from './action.js';
import { DataSourceDefinitionSchema, type DataSourceDefinition } from './data-source.js';

export const NodeTypeSchema = z.enum([
  'stack',
  'text',
  'button',
  'table',
  'form',
  'modal',
  'select',
  'input',
  'details',
  'grid',
  'card',
  'tabs',
  'stat',
  'chart',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const StackPropsSchema = z.object({
  direction: z.enum(['vertical', 'horizontal']).default('vertical'),
  gap: z.union([z.number(), z.string()]).default(16),
  align: z.string().optional(),
  justify: z.string().optional(),
  wrap: z.boolean().default(false),
});
export type StackProps = z.infer<typeof StackPropsSchema>;

export const TextPropsSchema = z.object({
  value: z.string(),
  variant: z.enum(['h1', 'h2', 'h3', 'body', 'caption', 'muted']).default('body'),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

export const ButtonPropsSchema = z.object({
  label: z.string(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).default('primary'),
  onClick: z.array(ActionDefinitionSchema).optional(),
});
export type ButtonProps = z.infer<typeof ButtonPropsSchema>;

export const TableColumnSchema = z.object({
  fieldId: z.string(),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

export const TablePropsSchema = z
  .object({
    source: z.string().optional(),
    entityId: z.string().optional(),
    columns: z.array(TableColumnSchema).min(1),
    pageSize: z.number().int().positive().default(10),
    onRowClick: z.array(ActionDefinitionSchema).optional(),
  })
  .refine((data) => Boolean(data.source || data.entityId), {
    message: 'Table must specify either source (data source name) or entityId',
  });
export type TableProps = z.infer<typeof TablePropsSchema>;

export const FormFieldSchema = z.object({
  fieldId: z.string(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  readOnly: z.boolean().optional(),
  hidden: z.boolean().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormPropsSchema = z.object({
  entityId: z.string(),
  fields: z.array(FormFieldSchema).min(1),
  mode: z.enum(['create', 'edit']).default('create'),
  recordId: z.union([z.string(), z.number()]).optional(),
  onSubmit: z.array(ActionDefinitionSchema).optional(),
  onSuccess: z.array(ActionDefinitionSchema).optional(),
  onError: z.array(ActionDefinitionSchema).optional(),
});
export type FormProps = z.infer<typeof FormPropsSchema>;

export const InputPropsSchema = z.object({
  label: z.string().optional(),
  valueKey: z.string(),
  placeholder: z.string().optional(),
  type: z.enum(['text', 'number']).default('text'),
  onChangeAction: z.array(ActionDefinitionSchema).optional(),
});
export type InputProps = z.infer<typeof InputPropsSchema>;

export const ComponentSelectOptionSchema = z.object({
  label: z.string(),
  value: z.any(),
});

export const SelectPropsSchema = z.object({
  label: z.string().optional(),
  valueKey: z.string(),
  options: z.union([z.array(ComponentSelectOptionSchema), z.string()]).default([]),
  onChangeAction: z.array(ActionDefinitionSchema).optional(),
});
export type SelectProps = z.infer<typeof SelectPropsSchema>;

export const ModalPropsSchema = z.object({
  title: z.string().default('Modal'),
  openStateKey: z.string(),
});
export type ModalProps = z.infer<typeof ModalPropsSchema>;

export const DetailsPropsSchema = z
  .object({
    source: z.string().optional(),
    entityId: z.string().optional(),
    recordId: z.union([z.string(), z.number()]).optional(),
    fields: z.array(z.object({ fieldId: z.string() })).default([]),
  })
  .refine((data) => Boolean(data.source || data.entityId), {
    message: 'Details component must specify either source or entityId',
  });
export type DetailsProps = z.infer<typeof DetailsPropsSchema>;

export const GridPropsSchema = z.object({
  columns: z.number().int().min(1).max(12).default(2),
  gap: z.union([z.number(), z.string()]).default(16),
  responsiveCollapse: z.boolean().default(true),
});
export type GridProps = z.infer<typeof GridPropsSchema>;

export const CardPropsSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
});
export type CardProps = z.infer<typeof CardPropsSchema>;

export const TabItemSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type TabItem = z.infer<typeof TabItemSchema>;

export const TabsPropsSchema = z.object({
  tabs: z.array(TabItemSchema).default([]),
  defaultTab: z.string().optional(),
});
export type TabsProps = z.infer<typeof TabsPropsSchema>;

export const StatPropsSchema = z.object({
  entityId: z.string(),
  op: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count'),
  fieldId: z.string().optional(),
  filter: z.record(z.any()).optional(),
  label: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});
export type StatProps = z.infer<typeof StatPropsSchema>;

export const ChartPropsSchema = z.object({
  entityId: z.string().optional(),
  source: z.string().optional(),
  type: z.enum(['bar', 'line']).default('bar'),
  groupByFieldId: z.string(),
  aggregateOp: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count'),
  aggregateFieldId: z.string().optional(),
  title: z.string().optional(),
});
export type ChartProps = z.infer<typeof ChartPropsSchema>;

export interface NodeDefinition {
  id: string;
  type: NodeType;
  visibleIf?: string;
  props?: Record<string, any>;
  children?: NodeDefinition[];
}

export const NodeSchema: z.ZodType<NodeDefinition> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: NodeTypeSchema,
    visibleIf: z.string().optional(),
    props: z.record(z.any()).optional().default({}),
    children: z.array(NodeSchema).optional(),
  })
);

export const PageDefinitionSchema = z.object({
  schemaVersion: z.number().int().default(2),
  id: z.string(),
  version: z.number().int().default(1),
  name: z.string().optional(),
  route: z.string(),
  allowedRoles: z.array(z.string()).optional(),
  state: z.record(z.any()).optional().default({}),
  dataSources: z.array(DataSourceDefinitionSchema).optional().default([]),
  root: NodeSchema,
});

export type PageDefinition = z.infer<typeof PageDefinitionSchema>;
