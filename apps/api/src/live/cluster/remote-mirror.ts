/**
 * What the leader server reports about the connections it runs (status, recent messages, who
 * may see them), kept on the other servers so their Live screens and viewers work the same.
 */
import { MessageLog, type LoggedMessage } from '../message-log.js';
import type { ConnectionStatusMeta } from './live-bus.js';

export class RemoteMirror {
  private readonly statuses = new Map<string, Record<string, ConnectionStatusMeta>>();
  private readonly logs = new Map<string, MessageLog>();

  setStatuses(tenantId: string, statuses: Record<string, ConnectionStatusMeta>): void {
    this.statuses.set(tenantId, statuses);
  }

  statusOf(tenantId: string): Record<string, ConnectionStatusMeta> {
    return this.statuses.get(tenantId) ?? {};
  }

  viewRolesOf(connectionId: string): string[] | undefined {
    for (const statuses of this.statuses.values()) if (statuses[connectionId]) return statuses[connectionId].viewRoles;
    return undefined;
  }

  addLog(connectionId: string, entry: LoggedMessage): void {
    let log = this.logs.get(connectionId);
    if (!log) {
      log = new MessageLog();
      this.logs.set(connectionId, log);
    }
    log.add(entry);
  }

  recentMessages(connectionId: string): LoggedMessage[] {
    return this.logs.get(connectionId)?.list() ?? [];
  }

  /** A new leader: what the old one reported no longer applies */
  clear(): void {
    this.statuses.clear();
    this.logs.clear();
  }
}
