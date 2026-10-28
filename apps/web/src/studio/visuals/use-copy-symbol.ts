/** "Make my own copy": a symbol (usually a built-in one) copied into the workspace's own symbols */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Visual } from "@config-platform/schema";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";

export function useCopySymbol(onCopied: (copy: Visual) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (symbolId: string) => visualsApi.copySymbol(await visualsApi.get(symbolId)),
    onSuccess: (saved) => {
      queryClient.setQueryData(visualKey(saved.id), saved);
      queryClient.invalidateQueries({ queryKey: VISUALS_KEY, exact: true });
      onCopied(saved);
    },
  });
}
