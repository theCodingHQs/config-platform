/** Shared items of one kind, and the changes their owners make to them */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SharedKind } from "@config-platform/schema";
import { useOptionalAuth } from "../context/auth-context";
import { SHARED_KEY, sharedApi, sharedListKey } from "./shared-api";

/** Platform owners see every workspace's items, to choose which every workspace gets */
export function useSharedItems(kind: SharedKind) {
  const everyWorkspace = Boolean(useOptionalAuth()?.isPlatformAdmin);
  const query = useQuery({ queryKey: sharedListKey(kind, everyWorkspace), queryFn: () => sharedApi.list(kind, everyWorkspace) });
  return { ...query, everyWorkspace };
}

/** Sharing with every workspace (platform owners) and stopping sharing (the publishing workspace) */
export function useSharedChange() {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const onSettled = () => queryClient.invalidateQueries({ queryKey: SHARED_KEY });
  const everywhere = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => sharedApi.setEverywhere(id, on),
    onMutate: () => setProblem(null),
    onError: (err: Error) => setProblem(err.message),
    onSettled,
  });
  const unpublish = useMutation({
    mutationFn: (id: string) => sharedApi.unpublish(id),
    onMutate: () => setProblem(null),
    onError: (err: Error) => setProblem(err.message),
    onSettled,
  });
  return { everywhere, unpublish, problem };
}

export type SharedChange = ReturnType<typeof useSharedChange>;
