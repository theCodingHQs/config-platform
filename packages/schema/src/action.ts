import { z } from 'zod';

export const ActionTypeSchema = z.enum([
  'navigate',
  'setState',
  'openModal',
  'closeModal',
  'createRecord',
  'updateRecord',
  'deleteRecord',
  'refetch',
  'showToast',
  'confirm',
  'exportCsv',
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export interface ActionDefinition {
  type: ActionType;
  if?: string;
  params?: Record<string, any>;
  onError?: ActionDefinition[];
}

export const ActionDefinitionSchema: z.ZodType<ActionDefinition> = z.lazy(() =>
  z.object({
    type: ActionTypeSchema,
    if: z.string().optional(),
    params: z.record(z.any()).optional().default({}),
    onError: z.array(ActionDefinitionSchema).optional(),
  })
);
