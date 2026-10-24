import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LiveServerMessage, TagRule } from '@config-platform/schema';
import { decodeMessage, topicMatches } from '../src/live/message-decoder.js';
import { mapMessageToTags, checkTagRules } from '../src/live/tag-mapper.js';
import { simulatedValue } from '../src/live/adapters/simulator-adapter.js';
import { TagStore } from '../src/live/tag-store.js';
import { LiveHub } from '../src/live/live-hub.js';
import { LiveViewer } from '../src/live/live-viewer.js';
import { encryptSettings, decryptSettings, redactSettings } from '../src/live/connection-secrets.js';
import { Backoff } from '../src/live/adapters/backoff.js';

const rule = (tag: string, value: string, extra: Partial<TagRule> = {}): TagRule => ({ tag, value, type: 'number', ...extra });

afterEach(() => vi.useRealTimers());

describe('decoding messages', () => {
  it('reads JSON, numbers and text, and says why a payload is unreadable', () => {
    expect(decodeMessage('{"speed": 41}', 'json')).toEqual({ ok: true, message: { speed: 41 } });
    expect(decodeMessage(Buffer.from(' 21.5 '), 'number')).toEqual({ ok: true, message: 21.5 });
    expect(decodeMessage('running', 'text')).toEqual({ ok: true, message: 'running' });
    expect(decodeMessage('not json', 'json')).toMatchObject({ ok: false, error: expect.stringMatching(/^Not JSON/) });
  });

  it('matches MQTT topic filters', () => {
    expect(topicMatches('factory/+/status', 'factory/line1/status')).toBe(true);
    expect(topicMatches('factory/+/status', 'factory/line1/speed')).toBe(false);
    expect(topicMatches('factory/#', 'factory/line1/motor/temp')).toBe(true);
    expect(topicMatches('factory/line1', 'factory/line1/speed')).toBe(false);
  });
});

describe('tag rules', () => {
  const now = new Date('2026-10-24T06:00:00Z');

  it('takes values out of any message shape, with conditions and topics', () => {
    const rules: TagRule[] = [
      rule('line1.speed', 'message.speed'),
      rule('press4.status', 'message.state', { type: 'text', when: 'message.machine == "P-04"' }),
      rule('hall.temp', 'message', { topic: 'factory/hall/temperature' }),
    ];
    expect(mapMessageToTags(rules, { speed: '41.5', machine: 'P-04', state: 'running' }, undefined, now).values).toEqual({
      'line1.speed': { value: 41.5, ts: now.toISOString(), quality: 'good' },
      'press4.status': { value: 'running', ts: now.toISOString(), quality: 'good' },
    });
    expect(mapMessageToTags(rules, 22.4, 'factory/hall/temperature', now).values['hall.temp'].value).toBe(22.4);
    // Another machine's message leaves press4.status alone
    expect(mapMessageToTags(rules, { machine: 'P-05', state: 'stopped' }, undefined, now).values).not.toHaveProperty('press4.status');
  });

  it('marks a value that is not of the tag type as bad, and skips messages without it', () => {
    const rules = [rule('line1.speed', 'message.speed')];
    expect(mapMessageToTags(rules, { speed: 'fast' }, undefined, now).values['line1.speed']).toMatchObject({ value: null, quality: 'bad' });
    expect(mapMessageToTags(rules, { count: 3 }, undefined, now).values).toEqual({});
  });

  it('reports rules that can never work before saving', () => {
    expect(checkTagRules([rule('a', 'message.speed *'), rule('b', 'unknownFn(message)')])).toEqual([
      expect.stringMatching(/^Tag "a", value:/),
      expect.stringMatching(/^Tag "b", value:/),
    ]);
    expect(checkTagRules([rule('a', 'round(message.speed, 1)', { when: 'message.ok' })])).toEqual([]);
  });
});

describe('simulator', () => {
  const signal = { key: 'x', min: 0, max: 100, period: 4 };
  it('waves between min and max, counts and cycles', () => {
    expect(simulatedValue({ ...signal, pattern: 'wave' }, 0, 1000)).toBe(50);
    expect(simulatedValue({ ...signal, pattern: 'wave' }, 1, 1000)).toBe(100);
    expect(simulatedValue({ ...signal, pattern: 'counter', period: 2 }, 5, 1000)).toBe(10);
    const cycle = { ...signal, pattern: 'cycle' as const, period: 2, values: ['running', 'stopped'] };
    expect([0, 1, 2, 3].map((t) => simulatedValue(cycle, t, 1000))).toEqual(['running', 'running', 'stopped', 'stopped']);
  });
  it('random values stay in range', () => {
    let v: number | undefined;
    for (let t = 0; t < 200; t++) {
      v = simulatedValue({ ...signal, pattern: 'random' }, t, 1000, v) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('tag store', () => {
  const good = (value: number, ts = new Date().toISOString()) => ({ value, ts, quality: 'good' as const });

  it('keeps the latest values and tells listeners', () => {
    const store = new TagStore();
    const heard = vi.fn();
    store.subscribe('t1', heard);
    store.set('t1', 'c1', { 'line1.speed': good(40) }, () => undefined);
    store.set('t2', 'c9', { 'line1.speed': good(99) }, () => undefined);
    expect(store.snapshot('t1', () => true)).toEqual({ 'line1.speed': good(40, expect.any(String)) });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('marks values stale when the connection drops or updates stop, keeping the value', () => {
    const store = new TagStore();
    const old = new Date(Date.now() - 60_000).toISOString();
    store.set('t1', 'c1', { a: good(1, old), b: good(2) }, (tag) => (tag === 'a' ? 30_000 : undefined));
    store.sweepStale();
    expect(store.snapshot('t1', () => true)).toMatchObject({ a: { value: 1, quality: 'stale' }, b: { quality: 'good' } });
    store.markConnectionStale('t1', 'c1');
    expect(store.snapshot('t1', () => true).b).toMatchObject({ value: 2, quality: 'stale' });
  });

  it('forgets tags a connection no longer produces', () => {
    const store = new TagStore();
    store.set('t1', 'c1', { a: good(1), b: good(2) }, () => undefined);
    store.remove('t1', 'c1', (tag) => tag === 'a');
    expect(Object.keys(store.snapshot('t1', () => true))).toEqual(['a']);
  });
});

describe('live viewer (one browser)', () => {
  const setup = (role: 'viewer' | 'admin', viewRoles: string[] = []) => {
    vi.useFakeTimers();
    const hub = new LiveHub();
    vi.spyOn(hub, 'viewRolesOf').mockImplementation((id) => (id === 'restricted' ? viewRoles : []));
    const sent: LiveServerMessage[] = [];
    const viewer = new LiveViewer(hub, 't1', role, (m) => sent.push(m));
    const put = (connectionId: string, values: Record<string, number>) =>
      hub.store.set('t1', connectionId, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, ts: 'x', quality: 'good' as const }])), () => undefined);
    return { hub, viewer, sent, put };
  };

  it('sends a snapshot of the subscribed tags, then batched changes', () => {
    const { viewer, sent, put } = setup('viewer');
    put('c1', { 'line1.speed': 40, 'line2.speed': 10 });
    viewer.handle(JSON.stringify({ type: 'subscribe', tags: ['line1'] }));
    expect(sent.at(-1)).toEqual({ type: 'snapshot', values: { 'line1.speed': { value: 40, ts: 'x', quality: 'good' } } });
    put('c1', { 'line1.speed': 41 });
    put('c1', { 'line1.speed': 42, 'line2.speed': 11 });
    expect(sent.at(-1)?.type).toBe('snapshot'); // batched, not yet sent
    vi.advanceTimersByTime(250);
    expect(sent.at(-1)).toEqual({ type: 'values', values: { 'line1.speed': { value: 42, ts: 'x', quality: 'good' } } });
    viewer.close();
  });

  it("doesn't send tags from connections the viewer's role may not see", () => {
    const { viewer, sent, put } = setup('viewer', ['admin', 'builder']);
    put('restricted', { 'secret.value': 1 });
    put('open', { 'public.value': 2 });
    viewer.handle(JSON.stringify({ type: 'subscribe', tags: ['secret', 'public'] }));
    expect(Object.keys((sent.at(-1) as any).values)).toEqual(['public.value']);
    viewer.close();
  });

  it('admins see every connection; bad messages get an error, pings a pong', () => {
    const { viewer, sent, put } = setup('admin', ['builder']);
    put('restricted', { 'secret.value': 1 });
    viewer.handle(JSON.stringify({ type: 'subscribe', tags: ['secret'] }));
    expect(Object.keys((sent.at(-1) as any).values)).toEqual(['secret.value']);
    viewer.handle('nope');
    expect(sent.at(-1)).toEqual({ type: 'error', message: 'Messages must be JSON' });
    viewer.handle(JSON.stringify({ type: 'ping' }));
    expect(sent.at(-1)).toEqual({ type: 'pong' });
    viewer.close();
  });
});

describe('connection secrets', () => {
  it('stores MQTT passwords and header values encrypted, keeps them when left empty, never shows them', () => {
    const stored = encryptSettings('mqtt', { url: 'mqtt://b', topics: ['a/#'], password: 's3cret' });
    expect(JSON.stringify(stored)).not.toContain('s3cret');
    expect(decryptSettings('mqtt', stored).password).toBe('s3cret');
    expect(redactSettings('mqtt', stored)).toMatchObject({ hasPassword: true });
    expect(redactSettings('mqtt', stored)).not.toHaveProperty('passwordEncrypted');
    const kept = encryptSettings('mqtt', { url: 'mqtt://b2', topics: ['a/#'] }, stored);
    expect(decryptSettings('mqtt', kept).password).toBe('s3cret');

    const ws = encryptSettings('websocket', { url: 'wss://g', headers: [{ name: 'Authorization', value: 'Bearer abc' }] });
    expect(JSON.stringify(ws)).not.toContain('abc');
    expect(decryptSettings('websocket', ws).headers).toEqual([{ name: 'Authorization', value: 'Bearer abc' }]);
    expect(redactSettings('websocket', ws).headers).toEqual([{ name: 'Authorization', hasValue: true }]);
  });
});

describe('reconnect backoff', () => {
  it('doubles up to 30 s and starts over after a success', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const b = new Backoff();
    expect([1, 2, 3, 4, 5, 6, 7].map(() => b.nextDelayMs())).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    b.reset();
    expect(b.nextDelayMs()).toBe(1000);
    vi.restoreAllMocks();
  });
});
