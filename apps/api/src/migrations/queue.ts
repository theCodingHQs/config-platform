export class TenantMigrationQueue {
  private queues: Map<string, Promise<any>> = new Map();

  /**
   * Enqueues an operation for a specific tenant to ensure serialized execution
   */
  async enqueue<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(tenantId) || Promise.resolve();

    const current = previous
      .catch(() => {}) // Don't let previous error block subsequent operations
      .then(async () => {
        return await operation();
      });

    // Store a caught reference in the map so node does not log unhandled rejection
    const tracked = current
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(tenantId) === tracked) {
          this.queues.delete(tenantId);
        }
      });

    this.queues.set(tenantId, tracked);

    return current;
  }
}

export const tenantMigrationQueue = new TenantMigrationQueue();
