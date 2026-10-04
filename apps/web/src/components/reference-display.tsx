import React, { useState, useEffect } from 'react';
import { useMetadata } from '../context/metadata-context';
import { fetchRecords } from '../api/client';

// Global batching cache: entityId -> Map<recordId, Record<string, any>>
const recordCache = new Map<string, Map<string, Record<string, any>>>();

// Pending batches: entityId -> Set<recordId>
const pendingBatches = new Map<string, Set<string>>();
// Listeners waiting for updates: entityId -> Set<() => void>
const listeners = new Map<string, Set<() => void>>();
// Timers for scheduled batch calls
const batchTimers = new Map<string, any>();

export function clearReferenceCache() {
  recordCache.clear();
  pendingBatches.clear();
  listeners.clear();
  batchTimers.forEach((t) => clearTimeout(t));
  batchTimers.clear();
}

function notifyEntityListeners(entityId: string) {
  const entityListeners = listeners.get(entityId);
  if (entityListeners) {
    entityListeners.forEach((cb) => cb());
  }
}

function scheduleBatchFetch(tenantId: string, entityId: string) {
  if (batchTimers.has(entityId)) return;

  const timer = setTimeout(async () => {
    batchTimers.delete(entityId);
    const idsSet = pendingBatches.get(entityId);
    if (!idsSet || idsSet.size === 0) return;

    const ids = Array.from(idsSet);
    pendingBatches.delete(entityId);

    try {
      const resp = await fetchRecords(tenantId, entityId, {
        filter: { id: { in: ids } },
        limit: Math.max(ids.length, 50),
      });

      if (!recordCache.has(entityId)) {
        recordCache.set(entityId, new Map());
      }
      const entityCache = recordCache.get(entityId)!;

      for (const rec of resp.data || []) {
        entityCache.set(String(rec.id), rec);
      }
      notifyEntityListeners(entityId);
    } catch (err) {
      console.error(`Failed to batch fetch references for entity ${entityId}:`, err);
    }
  }, 10);

  batchTimers.set(entityId, timer);
}

export function useReferenceDisplay(targetEntityId: string | undefined, recordId: string | undefined): {
  displayValue: string;
  loading: boolean;
} {
  const { tenantId, resolveEntity } = useMetadata();
  const [, setTick] = useState(0);

  const strRecordId = recordId !== undefined && recordId !== null ? String(recordId) : '';

  useEffect(() => {
    if (!targetEntityId || !strRecordId) return;

    if (!listeners.has(targetEntityId)) {
      listeners.set(targetEntityId, new Set());
    }
    const listener = () => setTick((t) => t + 1);
    listeners.get(targetEntityId)!.add(listener);

    const entityCache = recordCache.get(targetEntityId);
    if (!entityCache || !entityCache.has(strRecordId)) {
      if (!pendingBatches.has(targetEntityId)) {
        pendingBatches.set(targetEntityId, new Set());
      }
      pendingBatches.get(targetEntityId)!.add(strRecordId);
      scheduleBatchFetch(tenantId, targetEntityId);
    }

    return () => {
      listeners.get(targetEntityId)?.delete(listener);
    };
  }, [tenantId, targetEntityId, strRecordId]);

  if (!targetEntityId || !strRecordId) {
    return { displayValue: strRecordId || '—', loading: false };
  }

  const entity = resolveEntity(targetEntityId);
  const entityCache = recordCache.get(targetEntityId);
  const record = entityCache?.get(strRecordId);

  if (!record) {
    return { displayValue: strRecordId, loading: true };
  }

  // If entity has a displayFieldId configured, use that field's value
  if (entity?.displayFieldId) {
    const displayCol = entity.columns.find((c) => c.id === entity.displayFieldId);
    if (displayCol && record[displayCol.name] !== undefined) {
      return { displayValue: String(record[displayCol.name]), loading: false };
    }
  }

  // Fallback heuristic: name, label, title, or record id
  const fallback =
    record.name ?? record.label ?? record.title ?? record.full_name ?? record.id;
  return { displayValue: String(fallback), loading: false };
}

export const ReferenceDisplay: React.FC<{
  targetEntityId: string | undefined;
  recordId: string | undefined;
}> = ({ targetEntityId, recordId }) => {
  const { displayValue, loading } = useReferenceDisplay(targetEntityId, recordId);
  return (
    <span
      className="reference-display-value"
      data-testid="reference-display-value"
      style={{
        opacity: loading ? 0.7 : 1,
        fontFamily: loading ? 'monospace' : 'inherit',
      }}
    >
      {displayValue}
    </span>
  );
};
