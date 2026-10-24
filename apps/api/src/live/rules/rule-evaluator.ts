/**
 * Deciding whether a tag change fires a rule, and working out what it writes. Pure: no database,
 * no clock (time is passed in), so every case can be tested.
 */
import { DEFAULT_RULE_CONDITION, evaluateRawExpression, type FieldAssignment, type LiveRuleInput, type RecordMatch } from '@config-platform/schema';

export interface TagChangeEvent {
  tag: string;
  value: unknown;
  previous: unknown;
  /** When the value arrived (ISO) */
  ts: string;
}

/** What rule expressions can use: value, previous, tag, ts, now, live */
export type RuleScope = Record<string, unknown>;

export function ruleScope(change: TagChangeEvent, live: Record<string, unknown>, now: Date): RuleScope {
  return { value: change.value, previous: change.previous, tag: change.tag, ts: change.ts, now: now.toISOString(), live };
}

export interface FireDecision {
  fire: boolean;
  /** The condition's result now; the next decision's `wasTrue` */
  conditionTrue: boolean;
  reason?: string;
}

/**
 * Rules fire when their condition *becomes* true: a machine that reports "stopped" every second
 * logs one stop, not one a second. `wasTrue` is the condition's result for the previous value.
 */
export function shouldFire(
  rule: Pick<LiveRuleInput, 'trigger' | 'cooldownSec'>,
  scope: RuleScope,
  wasTrue: boolean,
  lastRunAt: number | undefined,
  now: number,
): FireDecision {
  const condition = rule.trigger.when?.trim() || DEFAULT_RULE_CONDITION;
  const { value, error } = evaluateRawExpression(condition, scope);
  if (error) return { fire: false, conditionTrue: false, reason: `The condition can't be checked: ${error}` };
  const conditionTrue = Boolean(value);
  // No condition means "on every change": a counter changing each message runs each time
  const edgeOnly = Boolean(rule.trigger.when?.trim());
  if (!conditionTrue || (edgeOnly && wasTrue)) return { fire: false, conditionTrue };
  if (lastRunAt !== undefined && rule.cooldownSec > 0 && now - lastRunAt < rule.cooldownSec * 1000) {
    return { fire: false, conditionTrue, reason: 'Waiting: the rule ran less than its cooldown ago' };
  }
  return { fire: true, conditionTrue };
}

export function evaluateAssignments(assignments: FieldAssignment[], scope: RuleScope): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const { field, value: expression } of assignments) {
    const { value, error } = evaluateRawExpression(expression, scope);
    if (error) errors.push(`${field}: ${error}`);
    else values[field] = value ?? null;
  }
  return { values, errors };
}

/** The records query for "the newest record whose End is empty and Machine is Line 1" */
export function latestMatchQuery(match: RecordMatch[], scope: RuleScope): { query: Record<string, unknown>; errors: string[] } {
  const filter: Record<string, Record<string, unknown>> = {};
  const errors: string[] = [];
  for (const m of match) {
    if (m.op === 'isEmpty') {
      filter[m.field] = { ...filter[m.field], isNull: true };
      continue;
    }
    const { value, error } = evaluateRawExpression(m.value ?? '', scope);
    if (error) errors.push(`${m.field}: ${error}`);
    else filter[m.field] = { ...filter[m.field], eq: value };
  }
  return { query: { filter, sort: '-created_at', limit: 1 }, errors };
}

/** Problems with a rule's expressions before it is saved (syntax, unknown functions) */
export function checkRuleExpressions(rule: LiveRuleInput): string[] {
  const scope = { value: 0, previous: 0, tag: '', ts: '', now: '', live: {} };
  const problems: string[] = [];
  const check = (where: string, expression: string | undefined) => {
    if (!expression?.trim()) return;
    const { error } = evaluateRawExpression(expression, scope);
    if (error) problems.push(`${where}: ${error}`);
  };
  check('Condition', rule.trigger.when);
  for (const f of rule.action.fields) check(`Field "${f.field}"`, f.value);
  if (rule.action.type === 'updateLatest') for (const m of rule.action.match) if (m.op === 'equals') check(`Match "${m.field}"`, m.value);
  return problems;
}
