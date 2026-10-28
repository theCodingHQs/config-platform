import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveConnectionInputSchema, VisualDefinitionSchema, evaluateRawExpression, walkVisualNodes } from '@config-platform/schema';
import { decodeRegisters } from '@config-platform/live-connectors';
import { DEMO_MACHINES } from '../src/catalog.js';
import { SimMachine } from '../src/plant/sim-machine.js';
import { encodeReading, REGISTER_MAP } from '../src/sources/modbus-registers.js';
import { connectionPlans } from '../src/setup/connections.js';
import { rulePlans } from '../src/setup/rules.js';
import { BUILTIN_SYMBOL_IDS, builtinSymbol } from '@config-platform/schema/visual-library';
import { machineView, plantFloor } from '../src/setup/visuals/plant-floor.js';
import { ProcessArea } from '../src/process/process-area.js';
import { OrderBook, orderHistory } from '../src/orders/order-book.js';
import { orderSummary } from '../src/orders/order-summary.js';
import { orderMessage } from '../src/sources/site-feeds.js';
import { ordersConnection, processConnection } from '../src/setup/site-connections.js';
import { orderRulePlans } from '../src/setup/order-rules.js';
import { processOverview } from '../src/setup/visuals/process-overview.js';
import { orderDesk } from '../src/setup/visuals/order-desk.js';

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
  const symbolDef = builtinSymbol(BUILTIN_SYMBOL_IDS.machine)!.definition;
  const inputs = new Set(symbolDef.inputs!.map((i) => i.name));
  const drawings = { plantFloor: plantFloor(DEMO_MACHINES), machineView: machineView(DEMO_MACHINES) };

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
      assert.equal(c.ref, BUILTIN_SYMBOL_IDS.machine);
      for (const k of given) assert.ok(inputs.has(k), `${c.id} sets ${k}, which the symbol has no input for`);
    }
  });

  it('total the plant floor over every machine', () => {
    const live = { machines: { m01: { status: 'running', count: 10, speed: 2, power: 1.25 }, m02: { status: 'alarm', count: 5, speed: 0, power: 0.5 } } };
    const total = (id: string) => {
      const node = [...walkVisualNodes(drawings.plantFloor.nodes)].find((n) => n.name === id)!;
      return evaluateRawExpression(node.bindings!.text, { live }).value;
    };
    assert.equal(total('Running now'), `1 of ${DEMO_MACHINES.length}`);
    assert.equal(total('Parts made'), '15');
    assert.equal(total('Output rate'), '120 /h');
    assert.equal(total('Power draw'), '1.8 kW');
  });
});

describe('process area and order desk', () => {
  const area = new ProcessArea(seeded(3));
  const book = new OrderBook(Date.UTC(2026, 9, 26, 12), seeded(4));
  const live = {
    process: area.tick(1),
    orders: { ...orderSummary(book.orders, Date.UTC(2026, 9, 26, 12)), new: orderMessage(book.orders.at(-1)!), update: { key: 'k', order_no: 'n', status: 'shipped' } },
  };
  const tagNames = new Set([...processConnection().tags, ...ordersConnection().tags].map((t) => t.tag));
  const drawings = { processOverview: processOverview(), orderDesk: orderDesk() };
  // The app's extra functions for visuals (apps/web visual-functions.ts), enough to run the expressions
  const functions = {
    scale: (v: number, a: number, b: number, c: number, d: number) => c + Math.min(1, Math.max(0, (v - a) / (b - a))) * (d - c),
    clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
    pick: (v: unknown, ...pairs: unknown[]) => {
      for (let i = 0; i + 1 < pairs.length; i += 2) if (pairs[i] === v) return pairs[i + 1];
      return pairs.length % 2 ? pairs.at(-1) : null;
    },
  };

  it('have valid connections, with every value of the feeds as a tag', () => {
    for (const input of [processConnection(), ordersConnection()]) {
      const parsed = LiveConnectionInputSchema.safeParse(input);
      assert.ok(parsed.success, `${input.name}: ${parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    assert.ok(tagNames.has('process.c3.status') && tagNames.has('orders.tier.key.m12') && tagNames.has('orders.recent.r5.amount'));
  });

  it('have valid drawings that only read tags the connections make, and whose expressions all run', () => {
    for (const [name, def] of Object.entries(drawings)) {
      const parsed = VisualDefinitionSchema.safeParse(def);
      assert.ok(parsed.success, `${name}: ${parsed.success ? '' : parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      for (const used of JSON.stringify(def).match(/live\.(process|orders)\.[A-Za-z0-9_.]+/g) ?? []) assert.ok(tagNames.has(used.slice(5)), `${name} reads ${used}, which no connection makes`);
      for (const node of walkVisualNodes(def.nodes)) {
        const expressions = [...Object.values(node.bindings ?? {}), ...(node.rules ?? []).map((r) => r.when), ...(node.effects ?? []).flatMap((e) => (e.when ? [e.when] : []))];
        for (const expr of expressions) {
          const { value, error } = evaluateRawExpression(expr, { live }, functions);
          assert.equal(error, null, `${name} ${node.id}: ${expr}`);
          assert.ok(value !== undefined, `${name} ${node.id}: ${expr} gave nothing`);
        }
      }
    }
  });

  it('works out the order desk figures from the order book', () => {
    const s = live.orders;
    assert.ok(s.ytd.orders > 300, `${s.ytd.orders} orders this year`);
    assert.equal(Object.values(s.status).reduce((n, x) => n + x.count, 0), s.ytd.orders);
    assert.equal(s.month.m12.label, 'Oct');
    assert.equal(s.peak.revenue, Math.max(...Object.values(s.month).map((m) => m.revenue)));
  });

  it('has the same history on every run, and new orders come in and move on', () => {
    assert.deepEqual(orderHistory(Date.UTC(2026, 3, 1, 9)), orderHistory(Date.UTC(2026, 3, 1, 17)));
    const live2 = new OrderBook(Date.UTC(2026, 9, 26, 12), seeded(5), 0.5);
    let made = 0;
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      const { newOrder, change } = live2.tick(Date.UTC(2026, 9, 26, 12) + i * 1000);
      if (newOrder) made++;
      if (change) moved++;
    }
    assert.ok(made > 30 && moved > 10, `${made} new, ${moved} moved on`);
  });

  it('logs new orders and their status changes as records', () => {
    const rules = orderRulePlans({ id: 't_order', name: 'customer_order', version: 1, fields: [] });
    const create = rules[0].action;
    assert.equal(create.type, 'createRecord');
    for (const f of create.fields) {
      const { value, error } = evaluateRawExpression(f.value, { value: live.orders.new.order_no, live });
      assert.equal(error, null, f.field);
      assert.equal(value, (live.orders.new as Record<string, unknown>)[f.field], f.field);
    }
    for (const rule of rules) {
      assert.ok(tagNames.has(rule.trigger.tag), rule.trigger.tag);
      // A condition only fires when it turns true; these must run on every new value
      assert.equal('when' in rule.trigger, false, `${rule.name} has a condition`);
    }
  });

  it('trips C-3 and runs TK-12 low now and then, so alarms can be seen', () => {
    const a = new ProcessArea(seeded(6));
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const s = a.tick(1);
      if (s.c3.status === 'alarm') seen.add('c3');
      if (s.tk12.pump === 'alarm') seen.add('tk12');
      assert.ok(s.tk11.level >= 0 && s.tk11.level <= 100);
    }
    assert.deepEqual([...seen].sort(), ['c3', 'tk12']);
  });
});
