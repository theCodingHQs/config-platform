/** The workspace's shared items of one kind, and taking one out of the library */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SharedKind } from "@config-platform/schema";
import { SHARED_KEY, sharedApi, sharedListKey } from "./shared-api";

export function useSharedItems(kind: SharedKind) {
  return useQuery({ queryKey: sharedListKey(kind), queryFn: () => sharedApi.list(kind) });
}

/** Stopping sharing (refused while something still uses it, and says what) */
export function useSharedChange() {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const unpublish = useMutation({
    mutationFn: (id: string) => sharedApi.unpublish(id),
    onMutate: () => setProblem(null),
    onError: (err: Error) => setProblem(err.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SHARED_KEY }),
  });
  return { unpublish, problem };
}

export type SharedChange = ReturnType<typeof useSharedChange>;
