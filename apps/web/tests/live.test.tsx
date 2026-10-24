import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { LiveConnectionInputSchema, LiveRuleInputSchema, type LiveConnection } from '@config-platform/schema';
import { RULE_PRESETS, emptyRuleDraft, ruleDraftFromRule, ruleDraftToInput } from '../src/studio/live/rules/rule-draft';
import { draftFromConnection, draftToInput, emptyDraft, newTagRule } from '../src/studio/live/connection-draft';
import { messagePaths, suggestTagName } from '../src/studio/live/message-paths';
import { LiveSocketClient } from '../src/live/live-socket-client';
import { liveSocketUrl } from '../src/live/live-api';
import { useLiveScope } from '../src/live/use-live';

afterEach(() => cleanup());

/** A WebSocket stand-in the test drives by hand */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const fakeClient = () => {
  FakeSocket.instances = [];
  return new LiveSocketClient(() => 'ws://test/api/live/socket', (url) => new FakeSocket(url) as unknown as WebSocket);
};

describe('connection form', () => {
  it('a new simulator draft is valid as it is, apart from its name', () => {
    const input = draftToInput({ ...emptyDraft('simulator'), name: 'Line 1 simulator' });
    expect(LiveConnectionInputSchema.safeParse(input).success).toBe(true);
  });

  it('round-trips a saved MQTT connection without ever holding its password', () => {
    const saved: LiveConnection = {
      id: 'lc_1', name: 'Broker', kind: 'mqtt', enabled: true, viewRoles: ['viewer'], createdAt: '', updatedAt: '',
      settings: { url: 'mqtts://b:8883', username: 'line', hasPassword: true, topics: ['factory/#', 'plant/+/status'], qos: 1, format: 'json' },
      tags: [{ tag: 'line1.speed', value: 'message.speed', type: 'number' }],
    };
    const draft = draftFromConnection(saved);
    expect(draft.mqtt).toMatchObject({ password: '', hasPassword: true, topics: 'factory/#\nplant/+/status' });
    const input = draftToInput(draft) as any;
    expect(input.settings).not.toHaveProperty('password'); // empty = keep the saved one
    expect(input.settings.topics).toEqual(['factory/#', 'plant/+/status']);
    expect(LiveConnectionInputSchema.safeParse(input).success).toBe(true);
  });

  it('suggests tag names from the connection name and the message', () => {
    expect(newTagRule({ ...emptyDraft('websocket'), name: 'Line 1 Gateway' }).tag).toBe('line_1_gateway.value_1');
    expect(suggestTagName('message.line1.speed', 'gw')).toBe('gw.line1.speed');
    expect(suggestTagName('message["motor temp"]', 'gw')).toBe('gw.motor_temp');
  });

  it('lists the values in a message with the expression for each', () => {
    expect(messagePaths({ speed: 41, line: { status: 'running', ok: true }, 'motor temp': 61, list: [5] })).toEqual([
      { expression: 'message.speed', value: 41, type: 'number' },
      { expression: 'message.line.status', value: 'running', type: 'text' },
      { expression: 'message.line.ok', value: true, type: 'boolean' },
      { expression: 'message["motor temp"]', value: 61, type: 'number' },
      { expression: 'message.list[0]', value: 5, type: 'number' },
    ]);
    expect(messagePaths(22.5)).toEqual([{ expression: 'message', value: 22.5, type: 'number' }]);
  });
});

describe('rule form', () => {
  it('a preset plus a tag, data and fields is a valid rule, and round-trips', () => {
    const stopped = RULE_PRESETS.find((p) => p.id === 'stopped')!;
    const draft = { ...stopped.apply(emptyRuleDraft()), name: 'Log Line 1 stops', tag: 'line1.status', entityId: 'e1', fields: [{ field: 'started_at', value: 'ts' }] };
    const input = ruleDraftToInput(draft);
    expect(LiveRuleInputSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({ trigger: { tag: 'line1.status', when: 'value == "stopped"' }, cooldownSec: 5, action: { type: 'createRecord' } });
    const saved = { ...LiveRuleInputSchema.parse(input), id: 'lr_1', createdByEmail: null, lastRunAt: null, lastStatus: null, lastMessage: null, createdAt: '', updatedAt: '' };
    expect(ruleDraftToInput(ruleDraftFromRule(saved))).toEqual(input);
  });

  it('"update the latest" keeps its conditions; "every change" leaves the condition out', () => {
    const restarted = RULE_PRESETS.find((p) => p.id === 'restarted')!.apply(emptyRuleDraft());
    const input = ruleDraftToInput({ ...restarted, name: 'r', tag: 't', entityId: 'e', match: [{ field: 'ended_at', op: 'isEmpty' }], fields: [{ field: 'ended_at', value: 'ts' }] }) as any;
    expect(input.action).toEqual({ type: 'updateLatest', entityId: 'e', match: [{ field: 'ended_at', op: 'isEmpty' }], fields: [{ field: 'ended_at', value: 'ts' }] });
    const every = ruleDraftToInput({ ...RULE_PRESETS.find((p) => p.id === 'every')!.apply(emptyRuleDraft()), name: 'r', tag: 't', entityId: 'e' }) as any;
    expect(every.trigger).toEqual({ tag: 't' });
  });
});

describe('live socket (browser)', () => {
  it('builds the socket address from the page or the API address', () => {
    expect(liveSocketUrl({ protocol: 'https:', host: 'apps.acme.com' })).toBe('wss://apps.acme.com/api/live/socket');
    expect(liveSocketUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe('ws://localhost:3000/api/live/socket');
  });

  it('opens one socket for everyone, subscribes to all their tags, and closes when nobody needs it', () => {
    const client = fakeClient();
    const offA = client.register(['line1']);
    const offB = client.register(['press4.status']);
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    (globalThis as any).WebSocket.OPEN ??= 1;
    socket.open();
    expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', tags: ['line1', 'press4.status'] });
    offA();
    expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', tags: ['press4.status'] });
    offB();
    expect(socket.readyState).toBe(3);
    expect(client.getSnapshot().socket).toBe('idle');
  });

  it('keeps values from the snapshot and changes, and marks them stale when the socket drops', () => {
    const client = fakeClient();
    client.register(['line1']);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ type: 'snapshot', values: { 'line1.speed': { value: 40, ts: 't', quality: 'good' } } });
    socket.receive({ type: 'values', values: { 'line1.count': { value: 7, ts: 't', quality: 'good' } } });
    expect(Object.keys(client.getSnapshot().values)).toEqual(['line1.speed', 'line1.count']);
    socket.onclose?.();
    expect(client.getSnapshot()).toMatchObject({ socket: 'closed', values: { 'line1.speed': { value: 40, quality: 'stale' } } });
  });

  it('gives a page {{ live.line1.speed }} for the tags its definition mentions', () => {
    const client = fakeClient();
    function Page() {
      const { live, liveInfo } = useLiveScope({ root: { props: { text: '{{ live.line1.speed }} pcs/min' } } }, client);
      return <p data-testid="out">{`${live.line1?.speed ?? '—'} ${liveInfo.connected ? 'on' : 'off'}`}</p>;
    }
    render(<Page />);
    const socket = FakeSocket.instances[0];
    act(() => socket.open());
    expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', tags: ['line1.speed'] });
    act(() => socket.receive({ type: 'snapshot', values: { 'line1.speed': { value: 42, ts: 't', quality: 'good' } } }));
    expect(screen.getByTestId('out').textContent).toBe('42 on');
  });

  it('pages without live tags open no socket', () => {
    const client = fakeClient();
    function Page() {
      useLiveScope({ root: { props: { text: 'Hello {{ state.live }}' } } }, client);
      return null;
    }
    render(<Page />);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
