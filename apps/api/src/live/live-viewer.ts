/**
 * One browser's view of live data: the tags its page asked for, limited to connections its role
 * may see, sent as a snapshot and then as batched changes. Knows nothing about sockets: it is
 * given a `send` function, so it can be tested on its own.
 */
import { LIVE_BATCH_MS, tagMatchesRef, type LiveClientMessage, type LiveServerMessage, type TagValue } from '@config-platform/schema';
import type { TenantRole } from '../auth/auth-types.js';
import type { LiveHub } from './live-hub.js';
import type { TagChange } from './tag-store.js';

const MAX_REFS = 500;

export class LiveViewer {
  private refs: string[] = [];
  private pending: Record<string, TagValue> = {};
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly hub: LiveHub,
    private readonly tenantId: string,
    private readonly role: TenantRole,
    private readonly send: (message: LiveServerMessage) => void,
  ) {
    this.unsubscribe.push(hub.store.subscribe(tenantId, (changes) => this.onChanges(changes)));
    this.unsubscribe.push(hub.onStatus((changedTenant) => changedTenant === tenantId && this.sendStatus()));
    this.sendStatus();
  }

  handle(raw: string): void {
    let message: LiveClientMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send({ type: 'error', message: 'Messages must be JSON' });
      return;
    }
    if (message.type === 'ping') {
      this.send({ type: 'pong' });
    } else if (message.type === 'subscribe' && Array.isArray(message.tags)) {
      this.refs = message.tags.filter((t) => typeof t === 'string').slice(0, MAX_REFS);
      this.pending = {};
      this.send({ type: 'snapshot', values: this.hub.store.snapshot(this.tenantId, (tag, stored) => this.wants(tag, stored.connectionId)) });
    }
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const off of this.unsubscribe) off();
  }

  private canSee(connectionId: string): boolean {
    if (this.role === 'owner' || this.role === 'admin') return true;
    const roles = this.hub.viewRolesOf(connectionId);
    return roles.length === 0 || roles.includes(this.role);
  }

  private wants(tag: string, connectionId: string): boolean {
    return this.refs.some((ref) => tagMatchesRef(tag, ref)) && this.canSee(connectionId);
  }

  private onChanges(changes: TagChange[]): void {
    let any = false;
    for (const change of changes) {
      if (!this.wants(change.tag, change.connectionId)) continue;
      this.pending[change.tag] = change.value;
      any = true;
    }
    if (any && !this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), LIVE_BATCH_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    if (Object.keys(this.pending).length === 0) return;
    this.send({ type: 'values', values: this.pending });
    this.pending = {};
  }

  private sendStatus(): void {
    const connections: Record<string, any> = {};
    for (const [id, status] of Object.entries(this.hub.statusOf(this.tenantId))) {
      const { viewRoles: _roles, ...visible } = status;
      if (this.canSee(id)) connections[id] = visible;
    }
    this.send({ type: 'status', connections });
  }
}
