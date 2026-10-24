/**
 * Carries out a rule's action through the same records service people use (validation,
 * calculated fields, duplicate rules), as the person who set the rule up — checked every time,
 * so a rule stops writing when its owner loses access.
 */
import type { LiveRuleRun } from '@config-platform/schema';
import { pool } from '../../db/pool.js';
import { hasMinRole, isValidRole, type TenantRole } from '../../auth/auth-types.js';
import { entityCache } from '../../records/entity-cache.js';
import { recordsService } from '../../records/records-service.js';
import { permissionService } from '../../permissions/permission-service.js';
import { tenantLimitsService } from '../../limits/tenant-limits.js';
import type { StoredRule } from './rule-repository.js';
import { evaluateAssignments, latestMatchQuery, type RuleScope } from './rule-evaluator.js';

async function ownerRole(rule: StoredRule): Promise<TenantRole> {
  if (!rule.createdBy) throw new Error('The person who set up this rule was removed. Open the rule and save it to run it as yourself.');
  const res = await pool.query<{ role: string }>('SELECT role FROM public.tenant_member WHERE tenant_id = $1 AND user_id = $2', [rule.tenantId, rule.createdBy]);
  const role = res.rows[0]?.role;
  if (!role || !isValidRole(role) || !hasMinRole(role, 'admin')) {
    throw new Error(`${rule.createdByEmail ?? 'The person who set up this rule'} can no longer run rules here. An admin needs to open the rule and save it.`);
  }
  return role;
}

export async function runRuleAction(rule: StoredRule, scope: RuleScope, now: Date): Promise<LiveRuleRun> {
  const at = now.toISOString();
  const role = await ownerRole(rule);
  const { action } = rule;
  const resolved = await entityCache.resolveEntity(rule.tenantId, action.entityId);
  const label = resolved.entity.label;
  const permission = await permissionService.getEntityPermission(rule.tenantId, resolved.entity.id, role);

  const { values, errors } = evaluateAssignments(action.fields, scope);
  if (errors.length) return { at, status: 'failed', message: `Field values couldn't be worked out: ${errors.join('; ')}` };

  if (action.type === 'createRecord') {
    if (!permission.canCreate) return { at, status: 'failed', message: `Not allowed to create ${label} records` };
    await tenantLimitsService.checkRecordLimit(rule.tenantId, resolved.entity.physicalTableName);
    const record = await recordsService.createRecord(rule.tenantId, resolved.entity.id, values);
    return { at, status: 'done', message: `Created a ${label} record`, recordId: record.id };
  }

  if (!permission.canUpdate) return { at, status: 'failed', message: `Not allowed to change ${label} records` };
  const { query, errors: matchErrors } = latestMatchQuery(action.match, scope);
  if (matchErrors.length) return { at, status: 'failed', message: `Which record to update couldn't be worked out: ${matchErrors.join('; ')}` };
  const { data } = await recordsService.getRecords(rule.tenantId, resolved.entity.id, query);
  if (data.length === 0) return { at, status: 'skipped', message: `No matching ${label} record to update` };
  const record = await recordsService.updateRecord(rule.tenantId, resolved.entity.id, data[0].id, values);
  return { at, status: 'done', message: `Updated a ${label} record`, recordId: record.id };
}
