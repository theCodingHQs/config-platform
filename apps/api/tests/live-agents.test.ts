import { describe, it, expect, vi } from 'vitest';
import type { ServerToAgent } from '@config-platform/schema';
import { AgentHub, AGENT_OFFLINE } from '../src/live/agents/agent-hub.js';
import { AgentGateway } from '../src/live/agents/agent-gateway.js';
import { AgentRelay } from '../src/live/cluster/agent-relay.js';
import { LiveBus } from '../src/live/cluster/live-bus.js';
import { MemoryBusHub } from '../src/live/cluster/bus-transport.js';

const events = () => ({ onMessage: vi.fn(), onState: vi.fn(), onWarning: vi.fn() });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('agent hub (leader)', () => {
  it('sends an agent its connections, with secrets, when it comes online and when they change', () => {
    const hub = new AgentHub();
    const sent: Array<[string, ServerToAgent]> = [];
    hub.setSender((agentId, m) => sent.push([agentId, m]));
    const e1 = events();
    const proxy = hub.proxyFor('ag_1', 'modbus')({ host: '10.0.0.5', password: 'secret' }, e1, { connectionId: 'lc_1' });
    proxy.start();
    expect(e1.onState).toHaveBeenCalledWith('disconnected', AGENT_OFFLINE);
    expect(sent).toEqual([]);

    hub.fromAgent('ag_1', { type: 'hello', version: '1.0.0', hostname: 'plant2-pc' });
    expect(e1.onState).toHaveBeenLastCalledWith('connecting');
    expect(sent.at(-1)).toEqual(['ag_1', { type: 'config', connections: [{ id: 'lc_1', kind: 'modbus', settings: { host: '10.0.0.5', password: 'secret' } }] }]);

    void proxy.stop();
    expect(sent.at(-1)).toEqual(['ag_1', { type: 'config', connections: [] }]);
  });

  it("passes on what the agent reports, but only about that agent's own connections", () => {
    const hub = new AgentHub();
    const mine = events();
    const theirs = events();
    hub.proxyFor('ag_1', 'mqtt')({}, mine, { connectionId: 'lc_1' }).start();
    hub.proxyFor('ag_2', 'mqtt')({}, theirs, { connectionId: 'lc_2' }).start();
    hub.fromAgent('ag_1', { type: 'message', connectionId: 'lc_1', payload: '{"a":1}', encoding: 'utf8', topic: 't/1' });
    hub.fromAgent('ag_1', { type: 'message', connectionId: 'lc_1', payload: Buffer.from('raw').toString('base64'), encoding: 'base64' });
    hub.fromAgent('ag_1', { type: 'state', connectionId: 'lc_1', state: 'connected' });
    hub.fromAgent('ag_1', { type: 'warning', connectionId: 'lc_1', warning: 'one node missing' });
    hub.fromAgent('ag_1', { type: 'message', connectionId: 'lc_2', payload: 'not yours', encoding: 'utf8' });
    expect(mine.onMessage).toHaveBeenCalledWith({ payload: '{"a":1}', topic: 't/1' });
    expect(mine.onMessage.mock.calls[1][0].payload).toEqual(Buffer.from('raw'));
    expect(mine.onState).toHaveBeenLastCalledWith('connected', undefined);
    expect(mine.onWarning).toHaveBeenCalledWith('one node missing');
    expect(theirs.onMessage).not.toHaveBeenCalled();
  });

  it("marks an agent's connections disconnected when it goes offline", () => {
    const hub = new AgentHub();
    const e1 = events();
    hub.proxyFor('ag_1', 'opcua')({}, e1, { connectionId: 'lc_1' }).start();
    hub.fromAgent('ag_1', { type: 'hello', version: '1', hostname: 'h' });
    hub.agentOffline('ag_1');
    expect(e1.onState).toHaveBeenLastCalledWith('disconnected', AGENT_OFFLINE);
    expect(hub.isOnline('ag_1')).toBe(false);
  });
});

describe('agent gateway', () => {
  it('keeps one socket per agent; a newer connection replaces the older', () => {
    const gw = new AgentGateway();
    const handlers = { message: vi.fn(), offline: vi.fn() };
    gw.setHandlers(handlers);
    const first = { send: vi.fn(), close: vi.fn() };
    const second = { send: vi.fn(), close: vi.fn() };
    gw.connected('ag_1', first);
    gw.connected('ag_1', second);
    expect(first.close).toHaveBeenCalledWith(4409, expect.any(String));
    gw.received('ag_1', first, { type: 'pong' }); // from the replaced socket: ignored
    expect(handlers.message).not.toHaveBeenCalled();
    gw.disconnected('ag_1', first);
    expect(handlers.offline).not.toHaveBeenCalled();
    expect(gw.send('ag_1', { type: 'ping' })).toBe(true);
    expect(second.send).toHaveBeenCalledWith('{"type":"ping"}');
    gw.disconnected('ag_1', second);
    expect(handlers.offline).toHaveBeenCalledWith('ag_1');
    expect(gw.send('ag_1', { type: 'ping' })).toBe(false);
  });
});

describe('agents with several servers', () => {
  it('an agent connected to another server is run by the leader, both ways', async () => {
    const memory = new MemoryBusHub();
    // Server A: the leader, with the connection; server B holds the agent's socket
    const busA = new LiveBus(memory.transport());
    const busB = new LiveBus(memory.transport());
    await busA.start();
    await busB.start();
    const hubA = new AgentHub();
    const gwA = new AgentGateway();
    const relayA = new AgentRelay(gwA, hubA, busA, () => true);
    busA.on((e) => relayA.handle(e));
    const hubB = new AgentHub();
    const gwB = new AgentGateway();
    const relayB = new AgentRelay(gwB, hubB, busB, () => false);
    busB.on((e) => relayB.handle(e));

    const conn = events();
    hubA.proxyFor('ag_1', 'modbus')({ host: 'plc' }, conn, { connectionId: 'lc_1' }).start();
    const socket = { send: vi.fn(), close: vi.fn() };
    gwB.connected('ag_1', socket);
    gwB.received('ag_1', socket, { type: 'hello', version: '1.0.0', hostname: 'plant2-pc' });
    await settle();
    // The leader sent the config through server B
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ type: 'config', connections: [{ id: 'lc_1', kind: 'modbus', settings: { host: 'plc' } }] });
    gwB.received('ag_1', socket, { type: 'message', connectionId: 'lc_1', payload: '{"speed":41}', encoding: 'utf8' });
    await settle();
    expect(conn.onMessage).toHaveBeenCalledWith({ payload: '{"speed":41}', topic: undefined });
    gwB.disconnected('ag_1', socket);
    await settle();
    expect(conn.onState).toHaveBeenLastCalledWith('disconnected', AGENT_OFFLINE);
  });
});
