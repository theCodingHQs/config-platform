import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionRunner } from '../dist/connection-runner.js';
import { agentSocketUrl, readConfig, ConfigError } from '../dist/config.js';

/** Connectors that record what happens to them */
function fakeConnectors() {
  const log: string[] = [];
  const make = (kind: string) => (settings: any, events: any, ctx: any) => ({
    start: () => {
      log.push(`start ${ctx.connectionId} ${JSON.stringify(settings)}`);
      events.onState('connected');
      events.onMessage({ payload: Buffer.from('raw') });
      events.onMessage({ payload: '{"speed":41}', topic: 't' });
    },
    stop: async () => {
      log.push(`stop ${ctx.connectionId}`);
    },
  });
  return { log, connectors: { modbus: make('modbus'), opcua: make('opcua') } };
}

describe('edge agent: running what the app assigns', () => {
  it('starts new connections, keeps unchanged ones, restarts changed ones, stops removed ones', async () => {
    const { log, connectors } = fakeConnectors();
    const reports: any[] = [];
    const runner = new ConnectionRunner((m: any) => reports.push(m), connectors as any);
    await runner.apply([{ id: 'a', kind: 'modbus', settings: { host: 'plc1' } }, { id: 'b', kind: 'opcua', settings: { endpointUrl: 'opc.tcp://x' } }]);
    assert.deepEqual(runner.ids().sort(), ['a', 'b']);
    log.length = 0;
    await runner.apply([{ id: 'a', kind: 'modbus', settings: { host: 'plc2' } }, { id: 'b', kind: 'opcua', settings: { endpointUrl: 'opc.tcp://x' } }]);
    assert.deepEqual(log, ['stop a', 'start a {"host":"plc2"}']);
    log.length = 0;
    await runner.apply([]);
    assert.deepEqual(log.sort(), ['stop a', 'stop b']);
  });

  it('reports states and messages to the app, binary payloads as base64', async () => {
    const { connectors } = fakeConnectors();
    const reports: any[] = [];
    await new ConnectionRunner((m: any) => reports.push(m), connectors as any).apply([{ id: 'a', kind: 'modbus', settings: {} }]);
    assert.deepEqual(reports, [
      { type: 'state', connectionId: 'a', state: 'connected', error: undefined },
      { type: 'message', connectionId: 'a', payload: Buffer.from('raw').toString('base64'), encoding: 'base64', topic: undefined },
      { type: 'message', connectionId: 'a', payload: '{"speed":41}', encoding: 'utf8', topic: 't' },
    ]);
  });

  it('says so when the app asks for a kind this agent version cannot run', async () => {
    const reports: any[] = [];
    await new ConnectionRunner((m: any) => reports.push(m), {} as any).apply([{ id: 'a', kind: 'future-kind', settings: {} }]);
    assert.equal(reports[0].state, 'error');
    assert.match(reports[0].error, /Update the agent/);
  });
});

describe('edge agent: settings', () => {
  it('needs the app address and an agent token, and says what is wrong', () => {
    assert.throws(() => readConfig({}), (err: Error) => err instanceof ConfigError && /CONFIG_PLATFORM_URL is missing/.test(err.message) && /TOKEN is missing/.test(err.message));
    assert.throws(() => readConfig({ CONFIG_PLATFORM_URL: 'apps.acme.com', CONFIG_PLATFORM_AGENT_TOKEN: 'x' }), /must start with https:\/\/[\s\S]*doesn't look like an agent token/);
    assert.deepEqual(readConfig({ CONFIG_PLATFORM_URL: 'https://apps.acme.com/', CONFIG_PLATFORM_AGENT_TOKEN: 'la_abc' }), { platformUrl: 'https://apps.acme.com', token: 'la_abc' });
    assert.equal(agentSocketUrl('https://apps.acme.com'), 'wss://apps.acme.com/api/live/agent');
    assert.equal(agentSocketUrl('http://localhost:3000'), 'ws://localhost:3000/api/live/agent');
  });
});
