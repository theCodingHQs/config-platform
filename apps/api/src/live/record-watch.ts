/**
 * One browser's watch on record changes: the entities its page shows, limited to those its role
 * may read, sent as one batched "records changed" message so a burst of saves reloads once.
 */
import type { LiveServerMessage } from '@config-platform/schema';
import type { RecordChange } from './record-events.js';

const BATCH_MS = 300;
const MAX_ENTITIES = 100;

export interface RecordWatchDeps {
  subscribe: (listener: (change: RecordChange) => void) => () => void;
  /** Whether the viewer's role may read the entity (asked once per entity) */
  canRead: (entityId: string) => Promise<boolean>;
}

export class RecordWatch {
  private watched = new Set<string>();
  private readonly allowed = new Map<string, Promise<boolean>>();
  private pending = new Map<string, { entityId: string; entityName: string }>();
  private timer: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly tenantId: string,
    private readonly deps: RecordWatchDeps,
    private readonly send: (message: LiveServerMessage) => void,
  ) {
    this.unsubscribe = deps.subscribe((change) => void this.onChange(change));
  }

  /** Entities by id or name, as the page refers to them */
  watch(entities: string[]): void {
    this.watched = new Set(entities.filter((e) => typeof e === 'string').slice(0, MAX_ENTITIES));
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe();
  }

  private async onChange(change: RecordChange): Promise<void> {
    if (change.tenantId !== this.tenantId) return;
    if (!this.watched.has(change.entityId) && !this.watched.has(change.entityName)) return;
    let allowed = this.allowed.get(change.entityId);
    if (!allowed) {
      allowed = this.deps.canRead(change.entityId).catch(() => false);
      this.allowed.set(change.entityId, allowed);
    }
    if (!(await allowed)) return;
    this.pending.set(change.entityId, { entityId: change.entityId, entityName: change.entityName });
    if (!this.timer) this.timer = setTimeout(() => this.flush(), BATCH_MS);
  }

  private flush(): void {
    this.timer = null;
    if (this.pending.size === 0) return;
    this.send({ type: 'records', entities: [...this.pending.values()] });
    this.pending = new Map();
  }
}
