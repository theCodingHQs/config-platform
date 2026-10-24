import { describe, it, expect, vi } from 'vitest';
import { LiveRuleInputSchema, type LiveRuleRun } from '@config-platform/schema';
import { shouldFire, evaluateAssignments, latestMatchQuery, ruleScope, checkRuleExpressions } from '../src/live/rules/rule-evaluator.js';
import { RuleEngine } from '../src/live/rules/rule-engine.js';
import { TagStore } from '../src/live/tag-store.js';
import type { StoredRule } from '../src/live/rules/rule-repository.js';

const at = (s: number) => new Date(Date.UTC(2026, 9, 24, 6, 0, s)).toISOString();
const scopeFor = (value: unknown, previous: unknown) => ruleScope({ tag: 'line1.status', value, previous, ts: at(0) }, { line1: { speed: 41 } }, new Date(at(1)));

const downtimeStart = {
  trigger: { tag: 'line1.status', when: 'value == "stopped"' },
  cooldownSec: 0,
};

describe('when a rule fires', () => {
  it('fires when its condition becomes true, not again while it stays true', () => {
    expect(shouldFire(downtimeStart, scopeFor('stopped', 'running'), false, undefined, 0)).toEqual({ fire: true, conditionTrue: true });
    expect(shouldFire(downtimeStart, scopeFor('stopped', 'stopped'), true, undefined, 0)).toEqual({ fire: false, conditionTrue: true });
    expect(shouldFire(downtimeStart, scopeFor('running', 'stopped'), true, undefined, 0)).toEqual({ fire: false, conditionTrue: false });
  });

  it('without a condition it runs on every change of value', () => {
    const anyChange = { trigger: { tag: 'line1.count' }, cooldownSec: 0 };
    expect(shouldFire(anyChange, scopeFor(5, 4), true, undefined, 0).fire).toBe(true);
    expect(shouldFire(anyChange, scopeFor(5, 5), true, undefined, 0).fire).toBe(false);
  });

  it('waits for its cooldown', () => {
    const rule = { ...downtimeStart, cooldownSec: 60 };
    expect(shouldFire(rule, scopeFor('stopped', 'running'), false, 1_000, 30_000)).toMatchObject({ fire: false, reason: expect.stringMatching(/cooldown/) });
    expect(shouldFire(rule, scopeFor('stopped', 'running'), false, 1_000, 62_000).fire).toBe(true);
  });

  it('reports a condition it cannot check instead of firing', () => {
    expect(shouldFire({ trigger: { tag: 't', when: 'value ==' }, cooldownSec: 0 }, scopeFor(1, 0), false, undefined, 0)).toMatchObject({ fire: false, reason: expect.stringMatching(/can't be checked/) });
  });
});

describe('what a rule writes', () => {
  it('works out field values from the change, other tags and fixed text', () => {
    const { values, errors } = evaluateAssignments(
      [
        { field: 'machine', value: '"Line 1"' },
        { field: 'started_at', value: 'ts' },
        { field: 'speed_before', value: 'live.line1.speed' },
        { field: 'note', value: 'concat("Was ", previous)' },
      ],
      scopeFor('stopped', 'running'),
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({ machine: 'Line 1', started_at: at(0), speed_before: 41, note: 'Was running' });
  });

  it('finds the newest open record to close', () => {
    expect(latestMatchQuery([{ field: 'ended_at', op: 'isEmpty' }, { field: 'machine', op: 'equals', value: '"Line 1"' }], scopeFor('running', 'stopped')).query).toEqual({
      filter: { ended_at: { isNull: true }, machine: { eq: 'Line 1' } },
      sort: '-created_at',
      limit: 1,
    });
  });

  it('checks a rule before it is saved', () => {
    const rule = LiveRuleInputSchema.parse({
      name: 'Downtime start',
      trigger: { tag: 'line1.status', when: 'value == "stopped"' },
      action: { type: 'createRecord', entityId: 'e1', fields: [{ field: 'started_at', value: 'ts' }, { field: 'x', value: 'nope(' }] },
    });
    expect(checkRuleExpressions(rule)).toEqual([expect.stringMatching(/^Field "x":/)]);
    const noMatch = LiveRuleInputSchema.safeParse({ ...rule, action: { type: 'updateLatest', entityId: 'e1', match: [{ field: 'm', op: 'equals' }], fields: rule.action.fields } });
    expect(noMatch.success).toBe(false);
  });
});

describe('rule engine', () => {
  const rule = (id: string, when: string): StoredRule => ({
    id, tenantId: 't1', name: id, enabled: true, cooldownSec: 0,
    trigger: { tag: 'line1.status', when },
    action: { type: 'createRecord', entityId: 'e1', fields: [{ field: 'at', value: 'ts' }] },
    createdBy: 'u1', createdByEmail: 'a@x', lastRunAt: null, lastStatus: null, lastMessage: null, createdAt: '', updatedAt: '',
  });
  const put = (store: TagStore, value: string, s: number) => store.set('t1', 'c1', { 'line1.status': { value, ts: at(s), quality: 'good' } }, () => undefined);

  it('logs a stop once, then its restart, in order', async () => {
    const store = new TagStore();
    const order: string[] = [];
    const run = vi.fn(async (r: StoredRule, scope: Record<string, unknown>): Promise<LiveRuleRun> => {
      order.push(`${r.id}@${scope.ts}`);
      return { at: '', status: 'done', message: 'ok' };
    });
    const engine = new RuleEngine(store, run, async () => undefined);
    put(store, 'running', 0);
    engine.setRules('t1', [rule('stop', 'value == "stopped"'), rule('start', 'value == "running" && previous == "stopped"')]);
    put(store, 'running', 1);
    put(store, 'stopped', 2);
    put(store, 'stopped', 3); // still stopped: no second log
    put(store, 'running', 4);
    await engine.idle();
    expect(order).toEqual([`stop@${at(2)}`, `start@${at(4)}`]);
    expect(engine.recentRuns('stop')[0]).toMatchObject({ status: 'done' });
  });

  it('ignores stale values, and records a failed action with its reason', async () => {
    const store = new TagStore();
    const engine = new RuleEngine(store, async () => { throw new Error('Not allowed to create Downtime records'); }, async () => undefined);
    engine.setRules('t1', [rule('stop', 'value == "stopped"')]);
    store.set('t1', 'c1', { 'line1.status': { value: 'stopped', ts: at(1), quality: 'stale' } }, () => undefined);
    await engine.idle();
    expect(engine.recentRuns('stop')).toEqual([]);
    put(store, 'stopped', 2);
    await engine.idle();
    expect(engine.recentRuns('stop')[0]).toMatchObject({ status: 'failed', message: 'Not allowed to create Downtime records' });
  });

  it('stops listening when a workspace has no enabled rules left', () => {
    const store = new TagStore();
    const run = vi.fn();
    const engine = new RuleEngine(store, run as any, async () => undefined);
    engine.setRules('t1', [rule('stop', 'value == "stopped"')]);
    engine.setRules('t1', []);
    put(store, 'stopped', 1);
    expect(run).not.toHaveBeenCalled();
  });
});
