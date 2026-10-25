/**
 * What formula fields in the visual editor suggest: every live tag (label, unit, connection and
 * value now), the inputs of the symbol being edited, and all the functions bindings can use.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExpressionScope, VisualInputDef } from "@config-platform/schema";
import { liveApi, type LiveTagInfo } from "../../live/live-api";
import { COMMON_FUNCTIONS, type SuggestionSources } from "../../components/expression-input/suggestions-context";
import { valueAt, type SuggestEntry } from "../../components/expression-input/suggest";
import { VISUAL_FUNCTION_DOCS } from "../../visuals/visual-functions";

export const useLiveTags = () => useQuery({ queryKey: ["live-tags"], queryFn: liveApi.tags, staleTime: 30_000 }).data ?? [];

export function tagEntries(tags: readonly LiveTagInfo[], live: unknown): SuggestEntry[] {
  return tags.map((t) => ({
    path: `live.${t.tag}`,
    detail: [t.label, t.unit, t.connectionName].filter(Boolean).join(" · "),
    value: valueAt(live, t.tag.split(".")),
  }));
}

export function useExpressionSuggestions(tags: readonly LiveTagInfo[], scope: ExpressionScope | null, inputs: readonly VisualInputDef[] | undefined): SuggestionSources {
  const live = scope?.live;
  const values = scope?.inputs;
  return useMemo(
    () => ({
      entries: [
        ...tagEntries(tags, live),
        ...(inputs ?? []).map((i) => ({ path: `inputs.${i.name}`, detail: `${i.label || i.name} · symbol input`, value: valueAt(values, [i.name]) })),
      ],
      functions: [...VISUAL_FUNCTION_DOCS, ...COMMON_FUNCTIONS],
    }),
    [tags, live, inputs, values],
  );
}
