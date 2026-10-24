/**
 * Runs live rules: listens to tag changes, decides which rules fire, and carries out their
 * actions one at a time per workspace (so "stopped" is logged before the "running" after it).
 */
import { nestTagValues, type LiveRuleRun } from '@config-platform/schema';
import type { TagStore, TagChange } from '../tag-store.js';
import { ruleRepository, type StoredRule } from './rule-repository.js';
import { ruleScope, shouldFire } from './rule-evaluator.js';
import { runRuleAction } from './rule-actions.js';

const RUNS_KEPT = 20;

interface TenantRules {
  rules: StoredRule[];
  /** Each tag's last good value, the next change's `previous` */
  lastValues: Map<string, unknown>;
  queue: Promise<void>;
  unsubscribe: () => void;
}

export class RuleEngine {
  private readonly tenants = new Map<string, TenantRules>();
  private readonly conditionWasTrue = new Map<string, boolean>();
  private readonly lastRunAt = new Map<string, number>();
  private readonly runs = new Map<string, LiveRuleRun[]>();
  private readonly runListeners = new Set<(tenantId: string, ruleId: string, run: LiveRuleRun) => void>();

  constructor(
    private readonly store: TagStore,
    private readonly run: (rule: StoredRule, scope: Record<string, unknown>, now: Date) => Promise<LiveRuleRun> = runRuleAction,
    private readonly saveRun: (ruleId: string, run: LiveRuleRun) => Promise<void> = (id, r) => ruleRepository.recordRun(id, r),
  ) {}

  async start(): Promise<void> {
    const byTenant = new Map<string, StoredRule[]>();
    for (const rule of await ruleRepository.listEnabled()) byTenant.set(rule.tenantId, [...(byTenant.get(rule.tenantId) ?? []), rule]);
    for (const [tenantId, rules] of byTenant) this.setRules(tenantId, rules);
  }

  /** Replaces a workspace's enabled rules (after any rule is saved or deleted) */
  setRules(tenantId: string, rules: StoredRule[]): void {
    const enabled = rules.filter((r) => r.enabled);
    const existing = this.tenants.get(tenantId);
    if (enabled.length === 0) {
      existing?.unsubscribe();
      this.tenants.delete(tenantId);
      return;
    }
    if (existing) {
      existing.rules = enabled;
      return;
    }
    const lastValues = new Map(Object.entries(this.store.snapshot(tenantId, () => true)).map(([tag, v]) => [tag, v.value]));
    const entry: TenantRules = { rules: enabled, lastValues, queue: Promise.resolve(), unsubscribe: () => undefined };
    entry.unsubscribe = this.store.subscribe(tenantId, (changes) => this.onChanges(tenantId, changes));
    this.tenants.set(tenantId, entry);
  }

  /** Stops running every workspace's rules (this server is no longer the leader) */
  stopAll(): void {
    for (const entry of this.tenants.values()) entry.unsubscribe();
    this.tenants.clear();
  }

  /** Every run carried out here (the cluster shares them with the other servers) */
  onRun(listener: (tenantId: string, ruleId: string, run: LiveRuleRun) => void): () => void {
    this.runListeners.add(listener);
    return () => this.runListeners.delete(listener);
  }

  /** A run carried out by the leader, so this server's Live screen lists it too */
  applyRemoteRun(ruleId: string, run: LiveRuleRun): void {
    this.runs.set(ruleId, [run, ...(this.runs.get(ruleId) ?? [])].slice(0, RUNS_KEPT));
  }

  recentRuns(ruleId: string): LiveRuleRun[] {
    return this.runs.get(ruleId) ?? [];
  }

  /** Waits for every queued run (tests, shutdown) */
  async idle(): Promise<void> {
    await Promise.all([...this.tenants.values()].map((t) => t.queue));
  }

  private onChanges(tenantId: string, changes: TagChange[]): void {
    const entry = this.tenants.get(tenantId);
    if (!entry) return;
    for (const change of changes) {
      if (change.value.quality !== 'good') continue; // stale/unreadable values don't trigger rules
      const previous = entry.lastValues.get(change.tag);
      entry.lastValues.set(change.tag, change.value.value);
      const rules = entry.rules.filter((r) => r.trigger.tag === change.tag);
      if (rules.length === 0) continue;
      const now = new Date();
      const live = nestTagValues(this.store.snapshot(tenantId, () => true));
      const scope = ruleScope({ tag: change.tag, value: change.value.value, previous, ts: change.value.ts }, live, now);
      for (const rule of rules) {
        const decision = shouldFire(rule, scope, this.conditionWasTrue.get(rule.id) ?? false, this.lastRunAt.get(rule.id), now.getTime());
        this.conditionWasTrue.set(rule.id, decision.conditionTrue);
        if (decision.reason && !decision.fire) this.log(rule, { at: now.toISOString(), status: 'skipped', message: decision.reason }, false);
        if (!decision.fire) continue;
        this.lastRunAt.set(rule.id, now.getTime());
        entry.queue = entry.queue.then(() => this.execute(rule, scope, now));
      }
    }
  }

  private async execute(rule: StoredRule, scope: Record<string, unknown>, now: Date): Promise<void> {
    let result: LiveRuleRun;
    try {
      result = await this.run(rule, scope, now);
    } catch (err: any) {
      result = { at: now.toISOString(), status: 'failed', message: String(err?.message || err) };
    }
    this.log(rule, result, true);
    for (const listener of this.runListeners) listener(rule.tenantId, rule.id, result);
  }

  private log(rule: StoredRule, run: LiveRuleRun, persist: boolean): void {
    const runs = this.runs.get(rule.id) ?? [];
    // A reason repeated on every message (cooldown, a broken condition) is listed once
    if (!persist && runs[0]?.status === run.status && runs[0]?.message === run.message) return;
    this.runs.set(rule.id, [run, ...runs].slice(0, RUNS_KEPT));
    if (persist) void this.saveRun(rule.id, run).catch((err) => console.error('[live rules] could not save a run:', err));
  }
}
