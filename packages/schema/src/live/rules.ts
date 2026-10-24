/**
 * Live rules: when a tag changes in a certain way, write a record. For example, log downtime:
 *   when line1.status becomes "stopped"  → create a Downtime Log record (start = ts)
 *   when it becomes "running" again      → update the latest open one (end = ts)
 *
 * Conditions and field values are expressions over:
 *   value, previous  the tag's new and previous value
 *   tag, ts, now     the tag name, when the value arrived, when the rule runs (ISO)
 *   live             every tag of the workspace, as in pages: live.line1.speed
 */
import { z } from 'zod';
import { TagNameSchema } from './tags.js';

const ExpressionSchema = z.string().trim().min(1, 'Enter an expression').max(500);

export const FieldAssignmentSchema = z.object({
  /** Field name in the entity */
  field: z.string().trim().min(1, 'Choose a field').max(100),
  /** e.g. ts, value, "Line 1", round(live.line1.speed, 1) */
  value: ExpressionSchema,
});
export type FieldAssignment = z.infer<typeof FieldAssignmentSchema>;

export const RecordMatchSchema = z.object({
  field: z.string().trim().min(1, 'Choose a field').max(100),
  op: z.enum(['isEmpty', 'equals']),
  /** equals: the expression to compare with */
  value: z.string().trim().max(500).optional(),
});
export type RecordMatch = z.infer<typeof RecordMatchSchema>;

export const LiveRuleActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('createRecord'),
    entityId: z.string().min(1, 'Choose where to save'),
    fields: z.array(FieldAssignmentSchema).min(1, 'Fill in at least one field').max(50),
  }),
  z.object({
    /** The newest record matching every condition gets the fields; none = nothing happens */
    type: z.literal('updateLatest'),
    entityId: z.string().min(1, 'Choose where to save'),
    match: z.array(RecordMatchSchema).min(1, 'Say which record to update, e.g. the one whose End is empty').max(10),
    fields: z.array(FieldAssignmentSchema).min(1, 'Fill in at least one field').max(50),
  }),
]);
export type LiveRuleAction = z.infer<typeof LiveRuleActionSchema>;

export const LiveRuleInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the rule a name').max(120),
    enabled: z.boolean().default(true),
    trigger: z.object({
      tag: TagNameSchema,
      /** Runs when this is true for a new value; default: whenever the value changes */
      when: z.string().trim().max(500).optional(),
    }),
    /** Seconds the rule waits before it can run again (a flickering signal makes one record) */
    cooldownSec: z.number().int().min(0).max(86_400).default(0),
    action: LiveRuleActionSchema,
  })
  .superRefine((rule, ctx) => {
    if (rule.action.type === 'updateLatest') {
      rule.action.match.forEach((m, i) => {
        if (m.op === 'equals' && !m.value) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action', 'match', i, 'value'], message: 'Say what it must equal' });
        }
      });
    }
  });
export type LiveRuleInput = z.infer<typeof LiveRuleInputSchema>;

export interface LiveRuleRun {
  at: string;
  status: 'done' | 'skipped' | 'failed';
  /** What happened, in plain words: "Created a Downtime Log record", "No open record to update" */
  message: string;
  recordId?: string;
}

export interface LiveRule extends LiveRuleInput {
  id: string;
  createdByEmail: string | null;
  lastRunAt: string | null;
  lastStatus: LiveRuleRun['status'] | null;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Default condition: any change of value */
export const DEFAULT_RULE_CONDITION = 'value != previous';
