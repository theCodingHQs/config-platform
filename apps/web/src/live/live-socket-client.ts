/**
 * The browser's one live connection, shared by everything on screen. Components register the
 * tags they need; the client subscribes to all of them at once, reconnects on its own, and keeps
 * the latest values and connection states for useSyncExternalStore.
 */
import type { LiveClientMessage, LiveConnectionStatus, LiveServerMessage, TagValue } from "@config-platform/schema";
import { liveSocketUrl } from "./live-api";

export type SocketState = "idle" | "connecting" | "open" | "closed";

export interface LiveSnapshot {
  socket: SocketState;
  values: Record<string, TagValue>;
  connections: Record<string, LiveConnectionStatus & { name: string }>;
}

const PING_MS = 25_000;
const MAX_RETRY_MS = 30_000;

export class LiveSocketClient {
  private ws: WebSocket | null = null;
  private snapshot: LiveSnapshot = { socket: "idle", values: {}, connections: {} };
  private readonly listeners = new Set<() => void>();
  /** Each registration's tags; the socket subscribes to their union */
  private readonly registrations = new Map<number, string[]>();
  private nextId = 1;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly url: () => string = liveSocketUrl,
    private readonly createSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  /** Starts receiving `tags` (names or groups like "line1"); returns the function that stops it */
  register(tags: string[]): () => void {
    const id = this.nextId++;
    this.registrations.set(id, tags);
    this.ensureOpen();
    this.sendSubscription();
    return () => {
      this.registrations.delete(id);
      if (this.registrations.size === 0) this.close();
      else this.sendSubscription();
    };
  }

  getSnapshot = (): LiveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private allTags(): string[] {
    return [...new Set([...this.registrations.values()].flat())].sort();
  }

  private ensureOpen(): void {
    if (this.ws || this.retryTimer) return;
    this.update({ socket: "connecting" });
    const ws = this.createSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      this.update({ socket: "open" });
      this.sendSubscription();
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_MS);
    };
    ws.onmessage = (event) => this.receive(String(event.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.markAllStale();
      if (this.registrations.size === 0) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.ensureOpen();
      }, this.retryMs);
      this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    };
  }

  private close(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.update({ socket: "idle", values: {}, connections: {} });
  }

  private sendSubscription(): void {
    this.send({ type: "subscribe", tags: this.allTags() });
  }

  private send(message: LiveClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private receive(text: string): void {
    let message: LiveServerMessage;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === "snapshot") this.update({ values: message.values });
    else if (message.type === "values") this.update({ values: { ...this.snapshot.values, ...message.values } });
    else if (message.type === "status") this.update({ connections: message.connections });
  }

  /** The socket dropped: keep showing the last values, marked stale */
  private markAllStale(): void {
    const values = Object.fromEntries(Object.entries(this.snapshot.values).map(([k, v]) => [k, { ...v, quality: "stale" as const }]));
    this.update({ socket: "closed", values });
  }

  private update(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const liveSocketClient = new LiveSocketClient();
