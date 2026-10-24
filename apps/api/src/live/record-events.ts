/**
 * "Records of this entity changed" — told to open pages so their tables reload. Only which
 * entity changed travels here, never the data: pages reload it through the normal API, which
 * applies each viewer's permissions.
 *
 * Local to this server for now; publish() is the one place a cross-server relay plugs in.
 */
export interface RecordChange {
  tenantId: string;
  entityId: string;
  entityName: string;
}

type Listener = (change: RecordChange) => void;

class RecordEvents {
  private readonly listeners = new Set<Listener>();

  publish(change: RecordChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[live] record change listener failed:', err);
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const recordEvents = new RecordEvents();

/** Shorthand for writers that have a resolved entity at hand */
export function publishRecordChange(tenantId: string, entity: { id: string; name: string }): void {
  recordEvents.publish({ tenantId, entityId: entity.id, entityName: entity.name });
}
