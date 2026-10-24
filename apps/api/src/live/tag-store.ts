/**
 * Latest value of every tag, per workspace, kept in memory. Values are marked stale when a tag
 * stops updating (its rule's staleAfterSec) or its connection drops; the last value is kept so
 * screens show "42 (stale)" rather than going blank.
 */
import type { TagValue } from '@config-platform/schema';

export interface StoredTag {
  value: TagValue;
  connectionId: string;
  /** From the tag rule; undefined = never goes stale on its own */
  staleAfterMs?: number;
}

export interface TagChange {
  tag: string;
  connectionId: string;
  value: TagValue;
}

type Listener = (changes: TagChange[]) => void;

export class TagStore {
  private readonly tenants = new Map<string, Map<string, StoredTag>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Every workspace's changes (the cluster shares them with the other servers) */
  private readonly allListeners = new Set<(tenantId: string, changes: TagChange[]) => void>();

  private tagsOf(tenantId: string): Map<string, StoredTag> {
    let tags = this.tenants.get(tenantId);
    if (!tags) {
      tags = new Map();
      this.tenants.set(tenantId, tags);
    }
    return tags;
  }

  set(tenantId: string, connectionId: string, values: Record<string, TagValue>, staleAfterMs: (tag: string) => number | undefined): void {
    const tags = this.tagsOf(tenantId);
    const changes: TagChange[] = [];
    for (const [tag, value] of Object.entries(values)) {
      tags.set(tag, { value, connectionId, staleAfterMs: staleAfterMs(tag) });
      changes.push({ tag, connectionId, value });
    }
    this.emit(tenantId, changes);
  }

  /** The connection dropped: its values stay, marked stale */
  markConnectionStale(tenantId: string, connectionId: string): void {
    this.update(tenantId, (tag) => tag.connectionId === connectionId && tag.value.quality !== 'stale');
  }

  /** Tags that haven't updated within their rule's time become stale (called every few seconds) */
  sweepStale(now = Date.now()): void {
    for (const tenantId of this.tenants.keys()) {
      this.update(
        tenantId,
        (tag) => tag.value.quality === 'good' && tag.staleAfterMs !== undefined && now - Date.parse(tag.value.ts) > tag.staleAfterMs,
      );
    }
  }

  /** Forgets a connection's tags (deleted), or the ones its rules no longer produce */
  remove(tenantId: string, connectionId: string, keep: (tag: string) => boolean = () => false): void {
    const tags = this.tenants.get(tenantId);
    if (!tags) return;
    for (const [name, stored] of tags) {
      if (stored.connectionId === connectionId && !keep(name)) tags.delete(name);
    }
  }

  snapshot(tenantId: string, include: (tag: string, stored: StoredTag) => boolean): Record<string, TagValue> {
    const result: Record<string, TagValue> = {};
    for (const [name, stored] of this.tenants.get(tenantId) ?? []) {
      if (include(name, stored)) result[name] = stored.value;
    }
    return result;
  }

  /** Which connection a tag's value came from */
  connectionOf(tenantId: string, tag: string): string | undefined {
    return this.tenants.get(tenantId)?.get(tag)?.connectionId;
  }

  subscribe(tenantId: string, listener: Listener): () => void {
    let set = this.listeners.get(tenantId);
    if (!set) {
      set = new Set();
      this.listeners.set(tenantId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(tenantId);
    };
  }

  subscribeAll(listener: (tenantId: string, changes: TagChange[]) => void): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  private update(tenantId: string, becomesStale: (tag: StoredTag) => boolean): void {
    const changes: TagChange[] = [];
    for (const [name, stored] of this.tenants.get(tenantId) ?? []) {
      if (!becomesStale(stored)) continue;
      stored.value = { ...stored.value, quality: 'stale' };
      changes.push({ tag: name, connectionId: stored.connectionId, value: stored.value });
    }
    this.emit(tenantId, changes);
  }

  private emit(tenantId: string, changes: TagChange[]): void {
    if (changes.length === 0) return;
    for (const listener of this.listeners.get(tenantId) ?? []) listener(changes);
    for (const listener of this.allListeners) listener(tenantId, changes);
  }
}
