/**
 * Runs every enabled live connection on this server: starts its adapter, turns its messages
 * into tag values (decoder → tag rules → tag store) and keeps its status. Connections are
 * (re)started when saved, stopped when disabled or deleted.
 */
import type { ConnectionState, LiveConnectionStatus, MessageFormat } from '@config-platform/schema';
import { ADAPTERS, type AdapterMessage, type LiveAdapter } from './adapters/index.js';
import { connectionRepository, type StoredConnection } from './connection-repository.js';
import { decryptSettings } from './connection-secrets.js';
import { decodeMessage } from './message-decoder.js';
import { MessageLog, type LoggedMessage } from './message-log.js';
import { mapMessageToTags } from './tag-mapper.js';
import { TagStore } from './tag-store.js';

interface Running {
  connection: StoredConnection;
  adapter: LiveAdapter | null;
  status: LiveConnectionStatus;
  log: MessageLog;
}

type StatusListener = (tenantId: string) => void;

const STALE_SWEEP_MS = 5000;

export class LiveHub {
  readonly store = new TagStore();
  private readonly running = new Map<string, Running>();
  private readonly statusListeners = new Set<StatusListener>();
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Starts every enabled connection (on server start) */
  async start(): Promise<void> {
    for (const connection of await connectionRepository.listEnabled()) this.apply(connection);
    this.sweepTimer = setInterval(() => this.store.sweepStale(), STALE_SWEEP_MS);
    this.sweepTimer.unref();
  }

  async stopAll(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.all([...this.running.values()].map((r) => r.adapter?.stop()));
    this.running.clear();
  }

  /** A connection was saved: restart it with its new settings (or stop it, when disabled) */
  apply(connection: StoredConnection): void {
    const previous = this.running.get(connection.id);
    void previous?.adapter?.stop();
    const ruleTags = new Set(connection.tags.map((t) => t.tag));
    this.store.remove(connection.tenantId, connection.id, (tag) => ruleTags.has(tag));

    const entry: Running = {
      connection,
      adapter: null,
      status: { state: connection.enabled ? 'connecting' : 'disabled', messagesReceived: 0 },
      log: previous?.log ?? new MessageLog(),
    };
    this.running.set(connection.id, entry);
    if (connection.enabled) {
      try {
        entry.adapter = ADAPTERS[connection.kind](decryptSettings(connection.kind, connection.settings), {
          onMessage: (message) => this.receive(entry, message),
          onState: (state, error) => this.setState(entry, state, error),
          onWarning: (warning) => this.setWarning(entry, warning),
        }, { connectionId: connection.id });
        entry.adapter.start();
      } catch (err: any) {
        this.setState(entry, 'error', String(err?.message || err));
      }
    } else {
      this.store.markConnectionStale(connection.tenantId, connection.id);
    }
    this.notifyStatus(connection.tenantId);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry || entry.connection.tenantId !== tenantId) return;
    await entry.adapter?.stop();
    this.running.delete(id);
    this.store.remove(tenantId, id);
    this.notifyStatus(tenantId);
  }

  statusOf(tenantId: string): Record<string, LiveConnectionStatus & { name: string; viewRoles: string[] }> {
    const result: Record<string, LiveConnectionStatus & { name: string; viewRoles: string[] }> = {};
    for (const [id, entry] of this.running) {
      if (entry.connection.tenantId === tenantId) {
        result[id] = { ...entry.status, name: entry.connection.name, viewRoles: entry.connection.viewRoles };
      }
    }
    return result;
  }

  recentMessages(tenantId: string, id: string): LoggedMessage[] {
    const entry = this.running.get(id);
    return entry && entry.connection.tenantId === tenantId ? entry.log.list() : [];
  }

  /** Which connection's roles apply to a tag (for viewers' permissions) */
  viewRolesOf(connectionId: string): string[] {
    return this.running.get(connectionId)?.connection.viewRoles ?? [];
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private receive(entry: Running, { payload, topic }: AdapterMessage): void {
    const { connection } = entry;
    // Ignore a message from an adapter that has since been replaced
    if (this.running.get(connection.id) !== entry) return;
    entry.status = { ...entry.status, lastMessageAt: new Date().toISOString(), messagesReceived: entry.status.messagesReceived + 1 };

    const format: MessageFormat = connection.kind === 'simulator' ? 'json' : (connection.settings.format ?? 'json');
    const decoded = decodeMessage(payload, format);
    if (!decoded.ok) {
      entry.log.add({ at: entry.status.lastMessageAt!, topic, raw: payload, decodeError: decoded.error });
      return;
    }
    const mapped = mapMessageToTags(connection.tags, decoded.message, topic);
    entry.log.add({ at: entry.status.lastMessageAt!, topic, raw: payload, message: decoded.message, ruleErrors: mapped.errors.length ? mapped.errors : undefined });
    const staleAfter = new Map(connection.tags.map((t) => [t.tag, t.staleAfterSec ? t.staleAfterSec * 1000 : undefined]));
    this.store.set(connection.tenantId, connection.id, mapped.values, (tag) => staleAfter.get(tag));
  }

  private setState(entry: Running, state: ConnectionState, error?: string): void {
    if (this.running.get(entry.connection.id) !== entry) return;
    // An error is followed by a close; keep the reason visible while reconnecting
    const keepError = state === 'disconnected' || state === 'connecting' ? entry.status.error : undefined;
    entry.status = { ...entry.status, state, error: state === 'connected' ? undefined : (error ?? keepError) };
    if (state !== 'connected') this.store.markConnectionStale(entry.connection.tenantId, entry.connection.id);
    this.notifyStatus(entry.connection.tenantId);
  }

  private setWarning(entry: Running, warning: string): void {
    if (this.running.get(entry.connection.id) !== entry || entry.status.warning === warning) return;
    entry.status = { ...entry.status, warning };
    this.notifyStatus(entry.connection.tenantId);
  }

  private notifyStatus(tenantId: string): void {
    for (const listener of this.statusListeners) listener(tenantId);
  }
}

export const liveHub = new LiveHub();
