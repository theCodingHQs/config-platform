import { describe, it, expect, vi } from 'vitest';
import { LiveHub } from '../src/live/live-hub.js';
import { RuleEngine } from '../src/live/rules/rule-engine.js';
import { LiveBus } from '../src/live/cluster/live-bus.js';
import { MemoryBusHub } from '../src/live/cluster/bus-transport.js';
import { LiveCluster, type ClusterStore } from '../src/live/cluster/live-cluster.js';
import type { LeaderLock } from '../src/live/cluster/leader-lock.js';
import type { StoredConnection } from '../src/live/connection-repository.js';

/** Leadership decided by the test */
class ManualLock implements LeaderLock {
  private set: (leader: boolean) => void = () => undefined;
  start(onChange: (leader: boolean) => void) {
    this.set = onChange;
  }
  async stop() {}
  become(leader: boolean) {
    this.set(leader);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const simulator = (id: string): StoredConnection => ({
  id, tenantId: 't1', name: 'Line 1', kind: 'simulator', enabled: true, settings: { intervalMs: 60_000, signals: [{ key: 'speed', pattern: 'wave' }] },
  tags: [{ tag: 'line1.speed', value: 'message.speed', type: 'number' }], viewRoles: ['builder'], createdAt: '', updatedAt: '',
});

function server(hub: MemoryBusHub, store: Partial<ClusterStore> = {}) {
  const liveHub = new LiveHub();
  liveHub.start = vi.fn(async () => undefined); // no database here
  const rules = new RuleEngine(liveHub.store, async () => ({ at: '', status: 'done', message: 'ok' }), async () => undefined);
  rules.start = vi.fn(async () => undefined);
  const lock = new ManualLock();
  const bus = new LiveBus(hub.transport());
  const cluster = new LiveCluster(liveHub, rules, bus, lock, {
    loadConnection: async () => null,
    loadConnectionById: async () => null,
    loadRules: async () => [],
    ...store,
  });
  return { liveHub, rules, lock, bus, cluster };
}

describe('live data across several servers', () => {
  it('the leader runs connections and rules; the other server does not', async () => {
    const hub = new MemoryBusHub();
    const a = server(hub);
    const b = server(hub);
    await a.cluster.start();
    await b.cluster.start();
    a.lock.become(true);
    await settle();
    expect(a.liveHub.start).toHaveBeenCalled();
    expect(a.rules.start).toHaveBeenCalled();
    expect(b.liveHub.start).not.toHaveBeenCalled();
    expect(a.cluster.isLeader).toBe(true);
    expect(b.cluster.isLeader).toBe(false);
  });

  it("the other server's viewers get the leader's tag values and statuses", async () => {
    const hub = new MemoryBusHub();
    const a = server(hub);
    const b = server(hub);
    await a.cluster.start();
    await b.cluster.start();
    a.lock.become(true);
    await settle();
    a.liveHub.apply(simulator('lc_1'));
    a.liveHub.store.set('t1', 'lc_1', { 'line1.speed': { value: 41.5, ts: 'x', quality: 'good' } }, () => undefined);
    await settle();
    expect(b.liveHub.store.snapshot('t1', () => true)).toEqual({ 'line1.speed': { value: 41.5, ts: 'x', quality: 'good' } });
    expect(b.liveHub.statusOf('t1').lc_1).toMatchObject({ name: 'Line 1', viewRoles: ['builder'] });
    // Permissions on the other server use the leader's connection settings
    expect(b.liveHub.viewRolesOf('lc_1')).toEqual(['builder']);
    await a.liveHub.stopAll();
  });

  it('settings saved on another server are applied by the leader', async () => {
    const hub = new MemoryBusHub();
    const saved = simulator('lc_2');
    const a = server(hub, { loadConnection: async (_t, id) => (id === 'lc_2' ? saved : null) });
    const b = server(hub);
    await a.cluster.start();
    await b.cluster.start();
    a.lock.become(true);
    await settle();
    const apply = vi.spyOn(a.liveHub, 'apply');
    await b.cluster.connectionChanged('t1', 'lc_2', saved);
    await settle();
    expect(apply).toHaveBeenCalledWith(saved);
    expect(b.liveHub.tenants()).toEqual([]); // the other server runs nothing itself
    await a.liveHub.stopAll();
  });

  it('a server that loses leadership stops its connections and rules; another can take over', async () => {
    const hub = new MemoryBusHub();
    const a = server(hub);
    const b = server(hub);
    await a.cluster.start();
    await b.cluster.start();
    a.lock.become(true);
    await settle();
    const stopAll = vi.spyOn(a.liveHub, 'stopAll');
    const stopRules = vi.spyOn(a.rules, 'stopAll');
    a.lock.become(false);
    b.lock.become(true);
    await settle();
    expect(stopAll).toHaveBeenCalled();
    expect(stopRules).toHaveBeenCalled();
    expect(b.liveHub.start).toHaveBeenCalled();
  });

  it('large events are split and joined again', async () => {
    const hub = new MemoryBusHub();
    const a = new LiveBus(hub.transport());
    const b = new LiveBus(hub.transport());
    await a.start();
    await b.start();
    const heard = vi.fn();
    b.on(heard);
    const values = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`line${i}.speed`, { value: i, ts: '2026-10-24T06:00:00.000Z', quality: 'good' as const }]));
    a.publish({ t: 'tags', tenantId: 't1', connectionId: 'c', values });
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(Object.keys(heard.mock.calls[0][0].values)).toHaveLength(400);
    // A server doesn't hear its own events
    const self = vi.fn();
    a.on(self);
    a.publish({ t: 'hello' });
    await settle();
    expect(self).not.toHaveBeenCalled();
  });
});
