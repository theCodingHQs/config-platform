/**
 * The symbols a drawing places, and the symbols those place, loaded (and cached) one visual at a
 * time. Shapes whose symbol hasn't loaded yet show as a dashed placeholder until it has.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { symbolRefs, type VisualDefinition } from "@config-platform/schema";
import { visualKey, visualsApi } from "./visuals-api";

export function useSymbols(definition: VisualDefinition | undefined): ReadonlyMap<string, VisualDefinition> {
  const direct = useMemo(() => (definition ? symbolRefs(definition.nodes) : []), [definition]);
  // Two passes reach symbols inside symbols; deeper nesting loads as each level arrives
  const first = useQueries({ queries: direct.map((id) => ({ queryKey: visualKey(id), queryFn: () => visualsApi.get(id), staleTime: 30_000 })) });
  const nested = useMemo(() => {
    const seen = new Set(direct);
    const more = new Set<string>();
    for (const q of first) for (const id of q.data ? symbolRefs(q.data.definition.nodes) : []) if (!seen.has(id)) more.add(id);
    return [...more];
  }, [direct, first]);
  const second = useQueries({ queries: nested.map((id) => ({ queryKey: visualKey(id), queryFn: () => visualsApi.get(id), staleTime: 30_000 })) });

  const loaded = [...first, ...second].map((q) => q.data).filter((v) => v !== undefined);
  const signature = loaded.map((v) => `${v.id}@${v.version}`).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when a symbol (or its version) changes
  return useMemo(() => new Map(loaded.map((v) => [v.id, v.definition])), [signature]);
}
