import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveConnectionInputSchema, VisualDefinitionSchema, evaluateRawExpression, walkVisualNodes } from '@config-platform/schema';
import { decodeRegisters } from '@config-platform/live-connectors';
import { DEMO_MACHINES } from '../src/catalog.js';
import { SimMachine } from '../src/plant/sim-machine.js';
import { encodeReading, REGISTER_MAP } from '../src/sources/modbus-registers.js';
import { connectionPlans } from '../src/setup/connections.js';
import { rulePlans } from '../src/setup/rules.js';
import { machineSymbol } from '../src/setup/visuals/machine-symbol.js';
import { machineView, plantFloor } from '../src/setup/visuals/plant-floor.js';

/** Same sequence on every run */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe('simulated machine', () => {
  it('makes parts only while running, at about its rated speed', () => {
    const m = new SimMachine({ ratedSpeed: 30, baseTemperature: 20 }, seeded());
    let running = 0;
    let last = m.reading().count;
    for (let i = 0; i < 600; i++) {
      const r = m.tick(1);
      assert.ok(r.count >= last, 'the counter never goes back');
      if (r.status !== 'running') assert.ok(r.speed < 30);
      if (r.status === 'running') running++;
      last = r.count;
    }
    assert.ok(running > 300, 'mostly running');
    // 30 parts/min for most of 10 minutes
    assert.ok(last > 150 && last < 330, `made ${last} parts`);
  });
});

describe('Modbus register map', () => {
  it('encodes a reading the way the connector decodes it', () => {
    const words = encodeReading({ status: 'alarm', speed: 12.3, temperature: -4.5, count: 70_123, power: 6.67 });
    const decoded = Object.fromEntries(
      REGISTER_MAP.map((p) => [p.key, decodeRegisters(words.slice(p.offset, p.offset + (p.type === 'uint32' || p.type === 'float32' ? 2 : 1)), p.type, 'big', p.scale)]),
    );
    assert.equal(decoded.status_code, 3);
    assert.equal(decoded.speed, 12.3);
    assert.equal(decoded.temperature, -4.5);
    assert.equal(decoded.count, 70_123);
    assert.ok(Math.abs((decoded.power as number) - 6.67) < 1e-5);
  });
});

describe('demo connections', () => {
  const plans = connectionPlans('ag_demo');

  it('are valid connections, one per machine, of every kind', () => {
    assert.equal(plans.length, DEMO_MACHINES.length);
    for (const { input } of plans) {
      const parsed = LiveConnectionInputSchema.safeParse(input);
      assert.ok(parsed.success, `${input.name}: ${parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    assert.deepEqual(new Set(plans.map((p) => p.input.kind)), new Set(['opcua', 'modbus', 'mqtt', 'websocket', 'http-poll', 'http-push', 'simulator']));
    assert.equal(plans.filter((p) => p.input.agentId).length, 1, 'one runs on the edge agent');
  });

  it('all give each machine the same five tags', () => {
    for (const { machine, input } of plans) {
      assert.deepEqual(input.tags.map((t) => t.tag), ['status', 'speed', 'temperature', 'count', 'power'].map((k) => `machines.${machine.code}.${k}`));
    }
  });

  it('turn a Modbus status code into a word', () => {
    const rule = plans.find((p) => p.input.kind === 'modbus')!.input.tags.find((t) => t.tag.endsWith('.status'))!;
    const status = (code: number) => evaluateRawExpression(rule.value, { message: { status_code: code } }).value;
    assert.deepEqual([0, 1, 2, 3].map(status), ['stopped', 'running', 'idle', 'alarm']);
  });
});

describe('demo rules', () => {
  const entity = (id: string) => ({ id, name: id, version: 1, fields: [] });
  const rules = rulePlans(DEMO_MACHINES, entity('t_machine'), entity('t_down'));
  const when = (name: string, value: string, previous: string | undefined) => {
    const rule = rules.find((r) => r.name === name)!;
    return Boolean(evaluateRawExpression(rule.trigger.when, { value, previous }).value);
  };

  it('open downtime when a machine alarms or stops, and close it when it runs again', () => {
    const name = `${DEMO_MACHINES[0].name}: downtime`;
    assert.equal(when(`${name} starts`, 'alarm', 'running'), true);
    assert.equal(when(`${name} starts`, 'stopped', 'idle'), true);
    assert.equal(when(`${name} starts`, 'stopped', 'alarm'), false, 'already down');
    assert.equal(when(`${name} ends`, 'running', 'alarm'), true);
    assert.equal(when(`${name} ends`, 'running', 'idle'), false, 'was not down');
  });
});

describe('demo visuals', () => {
  const symbolDef = machineSymbol();
  const inputs = new Set(symbolDef.inputs!.map((i) => i.name));
  const drawings = { plantFloor: plantFloor(DEMO_MACHINES, 'vis_machine'), machineView: machineView(DEMO_MACHINES, 'vis_machine') };

  it('are valid visuals', () => {
    for (const [name, def] of Object.entries({ symbol: symbolDef, ...drawings })) {
      const parsed = VisualDefinitionSchema.safeParse(def);
      assert.ok(parsed.success, `${name}: ${parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
  });

  it('place one Machine copy per machine, giving only inputs the symbol has', () => {
    const copies = [...walkVisualNodes(drawings.plantFloor.nodes)].filter((n) => n.kind === 'symbol');
    assert.deepEqual(copies.map((c) => c.id), DEMO_MACHINES.map((m) => m.code));
    for (const c of [...copies, ...walkVisualNodes(drawings.machineView.nodes)].filter((n) => n.kind === 'symbol')) {
      const given = [...Object.keys(c.bindings ?? {}), ...Object.keys(c.attrs).filter((k) => !['x', 'y'].includes(k))];
      for (const k of given) assert.ok(inputs.has(k), `${c.id} sets ${k}, which the symbol has no input for`);
    }
  });

  it('total the plant floor over every machine', () => {
    const live = { machines: { m01: { status: 'running', count: 10, speed: 2, power: 1.25 }, m02: { status: 'alarm', count: 5, speed: 0, power: 0.5 } } };
    const total = (id: string) => {
      const node = [...walkVisualNodes(drawings.plantFloor.nodes)].find((n) => n.id === `${id}-value`)!;
      return evaluateRawExpression(node.bindings!.text, { live }).value;
    };
    assert.equal(total('total-running'), `1 of ${DEMO_MACHINES.length}`);
    assert.equal(total('total-parts'), '15');
    assert.equal(total('total-rate'), '120 /h');
    assert.equal(total('total-power'), '1.8 kW');
  });
});
