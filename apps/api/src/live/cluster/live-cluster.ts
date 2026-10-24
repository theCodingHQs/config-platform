/**
 * Live data across several app servers. One server — the leader — runs the connections and
 * rules; it shares tag values, statuses, recent messages and rule runs on the bus, and every
 * server feeds its own browsers from there. Record changes from any server reach all of them.
 * Settings saved on any server are applied by the leader. A single server is simply the leader.
 */
import type { LiveRuleRun } from '@config-platform/schema';
import type { LiveHub } from '../live-hub.js';
import type { RuleEngine } from '../rules/rule-engine.js';
import type { StoredConnection } from '../connection-repository.js';
import type { StoredRule } from '../rules/rule-repository.js';
import type { TagChange } from '../tag-store.js';
import { recordEvents } from '../record-events.js';
import { deliverPush, deliverTrustedPush, pushTokenMatches, type PushResult } from '../adapters/http-push-adapter.js';
import type { LiveBus, LiveBusEvent } from './live-bus.js';
import type { LeaderLock } from './leader-lock.js';

export interface ClusterStore {
  loadConnection(tenantId: string, id: string): Promise<StoredConnection | null>;
  loadConnectionById(id: string): Promise<StoredConnection | null>;
  loadRules(tenantId: string): Promise<StoredRule[]>;
}

/** How often the leader resends every status, so a quiet connection's state stays known */
const STATUS_REFRESH_MS = 30_000;

export class LiveCluster {
  private leader = false;
  private refresh: NodeJS.Timeout | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly hub: LiveHub,
    private readonly rules: RuleEngine,
    private readonly bus: LiveBus,
    private readonly lock: LeaderLock,
    private readonly store: ClusterStore,
  ) {}

  get isLeader(): boolean {
    return this.leader;
  }

  async start(): Promise<void> {
    await this.bus.start();
    this.offs.push(
      this.bus.on((event) => void this.onEvent(event)),
      recordEvents.subscribe((c) => !c.remote && this.bus.publish({ t: 'records', tenantId: c.tenantId, entityId: c.entityId, entityName: c.entityName })),
      this.hub.store.subscribeAll((tenantId, changes) => this.leader && this.publishTags(tenantId, changes)),
      this.hub.onStatus((tenantId) => this.leader && this.publishStatus(tenantId)),
      this.hub.onLog((tenantId, connectionId, entry) => this.leader && this.bus.publish({ t: 'log', tenantId, connectionId, entry })),
      this.rules.onRun((tenantId, ruleId, run: LiveRuleRun) => this.leader && this.bus.publish({ t: 'run', tenantId, ruleId, run })),
    );
    this.lock.start((isLeader) => void this.setLeader(isLeader));
    // Ask the leader (if another server) for everything current
    this.bus.publish({ t: 'hello' });
  }

  async stop(): Promise<void> {
    for (const off of this.offs) off();
    if (this.refresh) clearInterval(this.refresh);
    await this.setLeader(false);
    await this.lock.stop();
    await this.bus.stop();
  }

  /** A connection was saved or deleted (on this server): the leader runs it as saved */
  async connectionChanged(tenantId: string, id: string, saved?: StoredConnection | null): Promise<void> {
    if (!this.leader) {
      this.bus.publish({ t: 'connection', tenantId, connectionId: id });
      return;
    }
    const connection = saved === undefined ? await this.store.loadConnection(tenantId, id) : saved;
    if (connection) this.hub.apply(connection);
    else await this.hub.remove(tenantId, id);
  }

  /** A workspace's rules changed (on this server): the leader runs them as saved */
  async rulesChanged(tenantId: string): Promise<void> {
    if (!this.leader) {
      this.bus.publish({ t: 'rules', tenantId });
      return;
    }
    this.rules.setRules(tenantId, await this.store.loadRules(tenantId));
  }

  /** An HTTP push arrived here: delivered locally when this server runs it, else checked and forwarded */
  async push(connectionId: string, token: string, payload: string, topic?: string): Promise<PushResult> {
    const local = deliverPush(connectionId, token, payload, topic);
    if (local !== 'unknown' || this.leader) return local;
    const connection = await this.store.loadConnectionById(connectionId);
    if (!connection || connection.kind !== 'http-push' || !connection.enabled) return 'unknown';
    if (!connection.settings.tokenHash || !pushTokenMatches(token, String(connection.settings.tokenHash))) return 'forbidden';
    this.bus.publish({ t: 'push', connectionId, payload, topic });
    return 'accepted';
  }

  private async setLeader(isLeader: boolean): Promise<void> {
    if (isLeader === this.leader) return;
    this.leader = isLeader;
    if (isLeader) {
      this.hub.remote.clear();
      this.bus.publish({ t: 'leader', serverId: this.bus.serverId });
      await this.hub.start();
      await this.rules.start();
      this.refresh = setInterval(() => this.publishEverything(), STATUS_REFRESH_MS);
      this.refresh.unref();
    } else {
      if (this.refresh) clearInterval(this.refresh);
      this.rules.stopAll();
      await this.hub.stopAll();
    }
  }

  private async onEvent(event: LiveBusEvent): Promise<void> {
    switch (event.t) {
      case 'records':
        recordEvents.publish({ tenantId: event.tenantId, entityId: event.entityId, entityName: event.entityName, remote: true });
        return;
      case 'tags':
        if (!this.leader) this.hub.store.set(event.tenantId, event.connectionId, event.values, () => undefined);
        return;
      case 'status':
        if (!this.leader) this.hub.applyRemoteStatus(event.tenantId, event.statuses);
        return;
      case 'log':
        if (!this.leader) this.hub.remote.addLog(event.connectionId, event.entry);
        return;
      case 'run':
        if (!this.leader) this.rules.applyRemoteRun(event.ruleId, event.run);
        return;
      case 'leader':
        if (!this.leader) this.hub.remote.clear();
        return;
      case 'connection':
        if (this.leader) await this.connectionChanged(event.tenantId, event.connectionId);
        return;
      case 'rules':
        if (this.leader) await this.rulesChanged(event.tenantId);
        return;
      case 'push':
        if (this.leader) deliverTrustedPush(event.connectionId, event.payload, event.topic);
        return;
      case 'hello':
        if (this.leader) this.publishEverything();
        return;
    }
  }

  private publishTags(tenantId: string, changes: TagChange[]): void {
    const byConnection = new Map<string, Record<string, TagChange['value']>>();
    for (const c of changes) byConnection.set(c.connectionId, { ...byConnection.get(c.connectionId), [c.tag]: c.value });
    for (const [connectionId, values] of byConnection) this.bus.publish({ t: 'tags', tenantId, connectionId, values });
  }

  private publishStatus(tenantId: string): void {
    this.bus.publish({ t: 'status', tenantId, statuses: this.hub.statusOf(tenantId) });
  }

  /** Every workspace's statuses and current values (for a server that just started) */
  private publishEverything(): void {
    for (const tenantId of this.hub.tenants()) {
      this.publishStatus(tenantId);
      const changes: TagChange[] = Object.entries(this.hub.store.snapshot(tenantId, () => true)).map(([tag, value]) => ({
        tag,
        value,
        connectionId: this.hub.store.connectionOf(tenantId, tag) ?? '',
      }));
      this.publishTags(tenantId, changes);
    }
  }
}
