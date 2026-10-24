/** Saving live rules: validation against the entity's fields, storage, and the running engine. */
import { LiveRuleInputSchema, type LiveRule, type LiveRuleInput } from '@config-platform/schema';
import { entityCache } from '../../records/entity-cache.js';
import { liveHub } from '../live-hub.js';
import { LiveSettingsError } from '../live-errors.js';
import { RuleEngine } from './rule-engine.js';
import { ruleRepository, type StoredRule } from './rule-repository.js';
import { checkRuleExpressions } from './rule-evaluator.js';

export const ruleEngine = new RuleEngine(liveHub.store);

const toView = ({ tenantId: _t, createdBy: _c, ...rule }: StoredRule): LiveRule => rule;

async function parse(tenantId: string, body: unknown): Promise<LiveRuleInput> {
  const parsed = LiveRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new LiveSettingsError(parsed.error.issues.map((i) => `${i.path.join('.') || 'rule'}: ${i.message}`).join('; '));
  }
  const rule = parsed.data;
  const problems = checkRuleExpressions(rule);

  let entity;
  try {
    entity = await entityCache.resolveEntity(tenantId, rule.action.entityId);
  } catch {
    throw new LiveSettingsError('The data entity to save to no longer exists');
  }
  const fields = new Map(entity.fields.map((f) => [f.name, f]));
  const named = [...rule.action.fields.map((f) => f.field), ...(rule.action.type === 'updateLatest' ? rule.action.match.map((m) => m.field) : [])];
  for (const name of named) {
    if (!fields.has(name) && !['id', 'created_at', 'updated_at'].includes(name)) problems.push(`${entity.entity.label} has no field "${name}"`);
  }
  for (const f of rule.action.fields) {
    if ((fields.get(f.field)?.config as any)?.formula) problems.push(`"${f.field}" is calculated, so a rule can't fill it in`);
  }
  if (problems.length) throw new LiveSettingsError(problems.join('; '));
  return rule;
}

async function refreshEngine(tenantId: string): Promise<void> {
  ruleEngine.setRules(tenantId, await ruleRepository.list(tenantId));
}

export const liveRuleService = {
  async list(tenantId: string): Promise<LiveRule[]> {
    return (await ruleRepository.list(tenantId)).map(toView);
  },

  async create(tenantId: string, userId: string, body: unknown): Promise<LiveRule> {
    const saved = await ruleRepository.create(tenantId, userId, await parse(tenantId, body));
    await refreshEngine(tenantId);
    return toView(saved);
  },

  async update(tenantId: string, id: string, userId: string, body: unknown): Promise<{ before: LiveRule; after: LiveRule }> {
    const before = await ruleRepository.get(tenantId, id);
    if (!before) throw new LiveSettingsError('Rule not found', 404);
    const after = await ruleRepository.update(tenantId, id, userId, await parse(tenantId, body));
    await refreshEngine(tenantId);
    return { before: toView(before), after: toView(after!) };
  },

  async remove(tenantId: string, id: string): Promise<LiveRule> {
    const before = await ruleRepository.get(tenantId, id);
    if (!before || !(await ruleRepository.remove(tenantId, id))) throw new LiveSettingsError('Rule not found', 404);
    await refreshEngine(tenantId);
    return toView(before);
  },

  async runs(tenantId: string, id: string) {
    const rule = await ruleRepository.get(tenantId, id);
    if (!rule) throw new LiveSettingsError('Rule not found', 404);
    return ruleEngine.recentRuns(id);
  },
};
