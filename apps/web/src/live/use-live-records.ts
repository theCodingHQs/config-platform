/**
 * Tables that update live: when anyone saves a record of an entity this page shows, the page
 * reloads what shows it (its data sources, and tables, stats and charts querying the entity).
 */
import { useEffect, useMemo, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { liveSocketClient, type LiveSocketClient, type RecordsChanged } from "./live-socket-client";

/** Every entity the page refers to (data sources and components), by the id or name it uses */
export function pageEntityRefs(definition: unknown): string[] {
  const refs = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 40 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "entityId" && typeof value === "string" && value) refs.add(value);
      else walk(value, depth + 1);
    }
  };
  walk(definition, 0);
  return [...refs].sort();
}

interface RefreshTargets {
  page: { dataSources?: Array<{ id: string; entityId: string }> } | undefined;
  queryClient: QueryClient | undefined;
  refetchDataSource: (sourceId?: string) => void;
}

export function useLiveRecordRefresh({ page, queryClient, refetchDataSource }: RefreshTargets, client: LiveSocketClient = liveSocketClient): void {
  const refs = useMemo(() => pageEntityRefs(page), [page]);
  const key = refs.join("|");
  // The latest page and functions, without re-registering on every render
  const targets = useRef({ page, queryClient, refetchDataSource });
  targets.current = { page, queryClient, refetchDataSource };

  useEffect(() => {
    if (!key) return;
    return client.watchRecords(key.split("|"), (changed: RecordsChanged) => {
      const names = new Set(changed.flatMap((c) => [c.entityId, c.entityName]));
      const { page: current, queryClient: qc, refetchDataSource: refetch } = targets.current;
      qc?.invalidateQueries({ predicate: (q) => q.queryKey.some((part) => typeof part === "string" && names.has(part)) });
      for (const ds of current?.dataSources ?? []) if (names.has(ds.entityId)) refetch(ds.id);
    });
  }, [key, client]);
}
