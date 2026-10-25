import { z } from 'zod';
import { ActionDefinitionSchema, type ActionDefinition } from './action.js';
import { DataSourceDefinitionSchema, type DataSourceDefinition } from './data-source.js';
import { AllowedIconNameSchema } from './icons.js';

/** Workspace roles a page can be restricted to. */
export const PageRoleSchema = z.enum(['owner', 'admin', 'builder', 'editor', 'viewer']);
export type PageRole = z.infer<typeof PageRoleSchema>;

export const NodeTypeSchema = z.enum([
  'stack',
  'text',
  'button',
  'exportButton',
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
  'visual',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const LayoutPropsSchema = z.object({
  flex: z.union([z.number(), z.string()]).optional(),
  width: z.union([z.number(), z.string()]).optional(),
  minWidth: z.union([z.number(), z.string()]).optional(),
  maxWidth: z.union([z.number(), z.string()]).optional(),
  alignSelf: z.enum(['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline']).optional(),
});
export type LayoutProps = z.infer<typeof LayoutPropsSchema>;

/** Default space between a container's children (px), shared by stack, card and modal. */
export const DEFAULT_CONTENT_GAP = 16;

/**
 * How a container lays out its children: the same controls as a stack, so a card or a
 * modal doesn't need a stack inside it just to space its content. All optional; defaults
 * are a vertical column with DEFAULT_CONTENT_GAP between children.
 */
export const ContentLayoutPropsSchema = z.object({
  direction: z.enum(['vertical', 'horizontal']).optional(),
  gap: z.union([z.number(), z.string()]).optional(),
  align: z.string().optional(),
  justify: z.string().optional(),
  wrap: z.boolean().optional(),
});
export type ContentLayoutProps = z.infer<typeof ContentLayoutPropsSchema>;

export const StackPropsSchema = z.object({
  direction: z.enum(['vertical', 'horizontal']).default('vertical'),
  gap: z.union([z.number(), z.string()]).default(16),
  align: z.string().optional(),
  justify: z.string().optional(),
  wrap: z.boolean().default(false),
  padding: z.union([z.number(), z.string()]).optional(),
  background: z.enum(['transparent', 'surface', 'surface-subtle', 'surface-2']).optional(),
  border: z.boolean().optional(),
  borderRadius: z.union([z.number(), z.string()]).optional(),
}).merge(LayoutPropsSchema);
export type StackProps = z.infer<typeof StackPropsSchema>;

export const TextPropsSchema = z.object({
  value: z.string(),
  variant: z.enum(['h1', 'h2', 'h3', 'body', 'caption', 'muted']).default('body'),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  weight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  color: z.enum(['default', 'muted', 'primary', 'success', 'danger', 'warning']).optional(),
  truncate: z.boolean().optional(),
  noWrap: z.boolean().optional(),
}).merge(LayoutPropsSchema);
export type TextProps = z.infer<typeof TextPropsSchema>;

export const ButtonPropsSchema = z.object({
  label: z.string(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).default('primary'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  icon: z.string().optional(),
  iconPosition: z.enum(['left', 'right']).default('left'),
  fullWidth: z.boolean().default(false),
  disabled: z.boolean().optional(),
  onClick: z.array(ActionDefinitionSchema).optional(),
}).merge(LayoutPropsSchema);
export type ButtonProps = z.infer<typeof ButtonPropsSchema>;

export const ExportButtonPropsSchema = z.object({
  label: z.string().default('Export'),
  template: z.string().optional(),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
  parameters: z.union([z.string(), z.record(z.any())]).optional(),
  filters: z.union([z.string(), z.array(z.any()), z.record(z.any())]).optional(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).default('secondary'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
}).merge(LayoutPropsSchema);
export type ExportButtonProps = z.infer<typeof ExportButtonPropsSchema>;

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
    striped: z.boolean().optional(),
    compact: z.boolean().optional(),
    bordered: z.boolean().optional(),
    emptyMessage: z.string().optional(),
    onRowClick: z.array(ActionDefinitionSchema).optional(),
  })
  .merge(LayoutPropsSchema)
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
  icon: z.string().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormPropsSchema = z.object({
  entityId: z.string(),
  fields: z.array(FormFieldSchema).min(1),
  mode: z.enum(['create', 'edit']).default('create'),
  recordId: z.union([z.string(), z.number()]).optional(),
  showHeader: z.boolean().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  showFooter: z.boolean().optional(),
  submitLabel: z.string().optional(),
  showCancel: z.boolean().optional(),
  cancelLabel: z.string().optional(),
  onCancel: z.array(ActionDefinitionSchema).optional(),
  showDelete: z.boolean().optional(),
  deleteLabel: z.string().optional(),
  onDelete: z.array(ActionDefinitionSchema).optional(),
  onSubmit: z.array(ActionDefinitionSchema).optional(),
  onSuccess: z.array(ActionDefinitionSchema).optional(),
  onError: z.array(ActionDefinitionSchema).optional(),
}).merge(LayoutPropsSchema);
export type FormProps = z.infer<typeof FormPropsSchema>;

export const InputPropsSchema = z.object({
  label: z.string().optional(),
  valueKey: z.string(),
  placeholder: z.string().optional(),
  type: z.enum(['text', 'number', 'email', 'password', 'search', 'url', 'date']).default('text'),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  prefixIcon: z.string().optional(),
  onChangeAction: z.array(ActionDefinitionSchema).optional(),
}).merge(LayoutPropsSchema);
export type InputProps = z.infer<typeof InputPropsSchema>;

export const ComponentSelectOptionSchema = z.object({
  label: z.string(),
  value: z.any(),
});

export const SelectPropsSchema = z.object({
  label: z.string().optional(),
  valueKey: z.string(),
  options: z.union([z.array(ComponentSelectOptionSchema), z.string()]).default([]),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  disabled: z.boolean().optional(),
  clearable: z.boolean().optional(),
  onChangeAction: z.array(ActionDefinitionSchema).optional(),
}).merge(LayoutPropsSchema);
export type SelectProps = z.infer<typeof SelectPropsSchema>;

export const ModalPropsSchema = z.object({
  title: z.string().default('Modal'),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  entityId: z.string().optional(),
  openStateKey: z.string(),
  size: z.enum(['sm', 'md', 'lg', 'xl', 'full']).default('md'),
  showCloseButton: z.boolean().default(true),
}).merge(ContentLayoutPropsSchema);
export type ModalProps = z.infer<typeof ModalPropsSchema>;

export const DetailsPropsSchema = z
  .object({
    source: z.string().optional(),
    entityId: z.string().optional(),
    recordId: z.union([z.string(), z.number()]).optional(),
    fields: z.array(z.object({ fieldId: z.string() })).default([]),
    columns: z.number().int().min(1).max(4).default(2),
  })
  .merge(LayoutPropsSchema)
  .refine((data) => Boolean(data.source || data.entityId), {
    message: 'Details component must specify either source or entityId',
  });
export type DetailsProps = z.infer<typeof DetailsPropsSchema>;

export const GridPropsSchema = z.object({
  columns: z.number().int().min(1).max(12).default(2),
  gap: z.union([z.number(), z.string()]).default(16),
  responsiveCollapse: z.boolean().default(true),
  align: z.string().optional(),
  minColWidth: z.union([z.number(), z.string()]).optional(),
}).merge(LayoutPropsSchema);
export type GridProps = z.infer<typeof GridPropsSchema>;

export const CardPropsSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  headerIcon: z.string().optional(),
  variant: z.enum(['default', 'bordered', 'flat', 'elevated']).default('default'),
  padding: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
}).merge(LayoutPropsSchema).merge(ContentLayoutPropsSchema);
export type CardProps = z.infer<typeof CardPropsSchema>;

export const TabItemSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type TabItem = z.infer<typeof TabItemSchema>;

export const TabsPropsSchema = z.object({
  tabs: z.array(TabItemSchema).default([]),
  defaultTab: z.string().optional(),
  variant: z.enum(['line', 'pills', 'enclosed']).optional().default('line'),
  size: z.enum(['sm', 'md', 'lg']).optional().default('md'),
}).merge(LayoutPropsSchema);
export type TabsProps = z.infer<typeof TabsPropsSchema>;

export const StatPropsSchema = z.object({
  entityId: z.string(),
  op: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count'),
  fieldId: z.string().optional(),
  filter: z.record(z.any()).optional(),
  label: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  icon: z.string().optional(),
  trend: z.enum(['up', 'down', 'neutral']).optional(),
  trendValue: z.string().optional(),
  color: z.enum(['default', 'accent', 'success', 'warning', 'danger']).optional(),
}).merge(LayoutPropsSchema);
export type StatProps = z.infer<typeof StatPropsSchema>;

export const ChartPropsSchema = z.object({
  entityId: z.string().optional(),
  source: z.string().optional(),
  type: z.enum(['bar', 'line']).default('bar'),
  groupByFieldId: z.string(),
  aggregateOp: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count'),
  aggregateFieldId: z.string().optional(),
  title: z.string().optional(),
  /** Icon shown before the title. */
  icon: AllowedIconNameSchema.optional(),
  /** Axis titles are shown unless explicitly turned off. */
  showAxisTitles: z.boolean().optional(),
  /** Custom axis titles; when empty they are derived from the group-by and aggregate fields. */
  xAxisTitle: z.string().max(120).optional(),
  yAxisTitle: z.string().max(120).optional(),
}).merge(LayoutPropsSchema);
export type ChartProps = z.infer<typeof ChartPropsSchema>;

/** Shows a visual from Studio → Visuals, its shapes moving with live data */
export const VisualPropsSchema = z.object({
  visualId: z.string().optional(),
  /** Height in px; the drawing scales to fit. Empty = its own proportions at full width. */
  height: z.number().int().min(80).max(3000).optional(),
  title: z.string().max(120).optional(),
}).merge(LayoutPropsSchema);
export type VisualProps = z.infer<typeof VisualPropsSchema>;

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

function validateNodeFormIcons(node: NodeDefinition, ctx: z.RefinementCtx, path: (string | number)[]) {
  if (node.type === 'form' && node.props && Array.isArray(node.props.fields)) {
    for (let i = 0; i < node.props.fields.length; i++) {
      const field = node.props.fields[i];
      if (field && field.icon !== undefined && field.icon !== null && field.icon !== '') {
        const res = AllowedIconNameSchema.safeParse(field.icon);
        if (!res.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid form field icon '${field.icon}' on field '${field.fieldId || i}'. Must be an allowed icon name.`,
            path: [...path, 'props', 'fields', i, 'icon'],
          });
        }
      }
    }
  }
  if (node.children && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      validateNodeFormIcons(node.children[i], ctx, [...path, 'children', i]);
    }
  }
}

/**
 * Page width: 'theme' follows the workspace Layout content width (the default when
 * absent); 'full' always uses the full window width. Deliberately limited to these two
 * so published pages stay visually consistent.
 */
export const PageWidthSchema = z.enum(['theme', 'full']);
export type PageWidth = z.infer<typeof PageWidthSchema>;

export const PageDefinitionSchema = z
  .object({
    schemaVersion: z.number().int().default(2),
    id: z.string(),
    version: z.number().int().default(1),
    name: z.string().optional(),
    route: z.string(),
    /**
     * Roles that may open the published page (in addition to builder, admin and owner, who see
     * every page). Absent or empty = every signed-in role. Takes effect when the page is published.
     */
    allowedRoles: z.array(PageRoleSchema).optional(),
    width: PageWidthSchema.optional(),
    /** Navigation icon; when absent the sidebar derives one (bound entity icon, then name). */
    icon: AllowedIconNameSchema.optional(),
    state: z.record(z.any()).optional().default({}),
    dataSources: z.array(DataSourceDefinitionSchema).optional().default([]),
    root: NodeSchema,
  })
  .superRefine((page, ctx) => {
    if (page.root) {
      validateNodeFormIcons(page.root, ctx, ['root']);
    }
  });

export type PageDefinition = z.infer<typeof PageDefinitionSchema>;
