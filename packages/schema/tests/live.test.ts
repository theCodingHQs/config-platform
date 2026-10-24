import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coerceTagValue, liveTagRefs, nestTagValues, tagMatchesRef, LiveConnectionInputSchema } from '../dist/live/index.js';

const v = (value: any) => ({ value, ts: '2026-10-24T06:00:00Z', quality: 'good' as const });

describe('live tags', () => {
  it('turns received values into the tag type, or null', () => {
    assert.equal(coerceTagValue('41.5', 'number'), 41.5);
    assert.equal(coerceTagValue('fast', 'number'), null);
    assert.equal(coerceTagValue('', 'number'), null);
    assert.equal(coerceTagValue('running', 'boolean'), true);
    assert.equal(coerceTagValue('off', 'boolean'), false);
    assert.equal(coerceTagValue('maybe', 'boolean'), null);
    assert.equal(coerceTagValue({ a: 1 }, 'text'), '{"a":1}');
  });

  it('nests tags for {{ live.line1.speed }}, keeping a group\'s own value', () => {
    assert.deepEqual(nestTagValues({ 'line1.speed': v(40), 'line1.motor.temp': v(61), line2: v('idle') }), {
      line1: { speed: 40, motor: { temp: 61 } },
      line2: 'idle',
    });
    assert.deepEqual(nestTagValues({ line1: v('running'), 'line1.speed': v(40) }), { line1: { _value: 'running', speed: 40 } });
  });

  it('finds the tags a page uses, and which tags a subscription covers', () => {
    assert.deepEqual(liveTagRefs('{{ live.line1.speed }} km/h — {{ live.press_4.status == "running" }} {{ state.live }}'), ['line1.speed', 'press_4.status']);
    assert.equal(tagMatchesRef('line1.speed', 'line1'), true);
    assert.equal(tagMatchesRef('line10.speed', 'line1'), false);
    assert.equal(tagMatchesRef('line1', 'line1'), true);
  });
});

describe('live connection settings', () => {
  const base = { name: 'Line 1 gateway', tags: [{ tag: 'line1.speed', value: 'message.speed' }] };

  it('accepts each kind with its own settings', () => {
    assert.equal(LiveConnectionInputSchema.safeParse({ ...base, kind: 'websocket', settings: { url: 'wss://gw.local/stream' } }).success, true);
    assert.equal(LiveConnectionInputSchema.safeParse({ ...base, kind: 'mqtt', settings: { url: 'mqtts://broker:8883', topics: ['factory/#'] } }).success, true);
    assert.equal(
      LiveConnectionInputSchema.safeParse({ ...base, kind: 'simulator', settings: { signals: [{ key: 'speed', pattern: 'wave' }] } }).success,
      true,
    );
  });

  it('refuses wrong addresses, bad tag names and a tag listed twice', () => {
    const issues = (input: unknown) => {
      const r = LiveConnectionInputSchema.safeParse(input);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    assert.match(issues({ ...base, kind: 'websocket', settings: { url: 'https://gw.local' } }).join(), /ws:\/\/ or wss:\/\//);
    assert.match(issues({ ...base, kind: 'mqtt', settings: { url: 'mqtt://b', topics: [] } }).join(), /at least one topic/);
    assert.match(issues({ ...base, kind: 'simulator', settings: { signals: [{ key: 's', pattern: 'wave' }] }, tags: [{ tag: 'line 1', value: 'x' }] }).join(), /words separated by dots/);
    const twice = { ...base, kind: 'simulator', settings: { signals: [{ key: 's', pattern: 'wave' }] }, tags: [{ tag: 'a', value: 'x' }, { tag: 'a', value: 'y' }] };
    assert.match(issues(twice).join(), /listed twice/);
  });
});
