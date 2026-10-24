/**
 * Live events shared by this app's servers. Each server ignores its own events (it already acted
 * on them) and reassembles large ones: Postgres limits a notification to 8000 bytes, so events
 * are split into parts and joined again on arrival.
 */
import crypto from 'node:crypto';
import type { LiveConnectionStatus, LiveRuleRun, TagValue } from '@config-platform/schema';
import type { LoggedMessage } from '../message-log.js';
import type { BusTransport } from './bus-transport.js';

export type ConnectionStatusMeta = LiveConnectionStatus & { name: string; viewRoles: string[] };

export type LiveBusEvent =
  /** Leader → all: tag values received (or gone stale) */
  | { t: 'tags'; tenantId: string; connectionId: string; values: Record<string, TagValue> }
  /** Leader → all: every connection's status for a workspace */
  | { t: 'status'; tenantId: string; statuses: Record<string, ConnectionStatusMeta> }
  /** Leader → all: a message a connection received, for the Live screen */
  | { t: 'log'; tenantId: string; connectionId: string; entry: LoggedMessage }
  /** Leader → all: a rule ran */
  | { t: 'run'; tenantId: string; ruleId: string; run: LiveRuleRun }
  /** Any → all: records of an entity changed */
  | { t: 'records'; tenantId: string; entityId: string; entityName: string }
  /** Any → leader: a connection was saved or deleted; reload it */
  | { t: 'connection'; tenantId: string; connectionId: string }
  /** Any → leader: a workspace's rules changed */
  | { t: 'rules'; tenantId: string }
  /** Any → leader: an HTTP push arrived here (token already checked) */
  | { t: 'push'; connectionId: string; payload: string; topic?: string }
  /** New leader → all: forget mirrored statuses of the old one */
  | { t: 'leader'; serverId: string }
  /** A server that just started → leader: send me everything current */
  | { t: 'hello' };

interface Envelope {
  o: string; // origin server
  e?: LiveBusEvent; // whole event
  p?: { id: string; i: number; n: number; d: string }; // part i of n
}

/** Under Postgres's 8000-byte limit, leaving room for the envelope */
const MAX_PART = 7000;
const PART_TIMEOUT_MS = 10_000;

export class LiveBus {
  readonly serverId = crypto.randomBytes(6).toString('hex');
  private readonly listeners = new Set<(event: LiveBusEvent) => void>();
  private readonly parts = new Map<string, { chunks: string[]; received: number; timer: NodeJS.Timeout }>();

  constructor(private readonly transport: BusTransport) {}

  async start(): Promise<void> {
    await this.transport.listen((text) => this.receive(text));
  }

  async stop(): Promise<void> {
    for (const p of this.parts.values()) clearTimeout(p.timer);
    this.parts.clear();
    await this.transport.close();
  }

  on(listener: (event: LiveBusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: LiveBusEvent): void {
    const whole = JSON.stringify({ o: this.serverId, e: event } satisfies Envelope);
    const send = (text: string) => this.transport.publish(text).catch((err) => console.error('[live bus] publish failed:', err.message));
    if (whole.length <= MAX_PART) {
      void send(whole);
      return;
    }
    const data = JSON.stringify(event);
    const id = crypto.randomBytes(6).toString('hex');
    const n = Math.ceil(data.length / MAX_PART);
    for (let i = 0; i < n; i++) void send(JSON.stringify({ o: this.serverId, p: { id, i, n, d: data.slice(i * MAX_PART, (i + 1) * MAX_PART) } } satisfies Envelope));
  }

  private receive(text: string): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      return;
    }
    if (envelope.o === this.serverId) return;
    if (envelope.e) return this.emit(envelope.e);
    if (envelope.p) this.collect(envelope.p);
  }

  private collect({ id, i, n, d }: NonNullable<Envelope['p']>): void {
    let entry = this.parts.get(id);
    if (!entry) {
      entry = { chunks: new Array(n), received: 0, timer: setTimeout(() => this.parts.delete(id), PART_TIMEOUT_MS) };
      entry.timer.unref?.();
      this.parts.set(id, entry);
    }
    if (entry.chunks[i] === undefined) {
      entry.chunks[i] = d;
      entry.received += 1;
    }
    if (entry.received < n) return;
    clearTimeout(entry.timer);
    this.parts.delete(id);
    try {
      this.emit(JSON.parse(entry.chunks.join('')));
    } catch {
      /* a corrupted event is dropped */
    }
  }

  private emit(event: LiveBusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[live bus] listener failed:', err);
      }
    }
  }
}
