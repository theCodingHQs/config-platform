/**
 * A screen's tabs kept in the address (?tab=email), so a refresh or a shared link opens the same
 * tab. Switching tabs replaces the address rather than adding a step: Back leaves the screen, as
 * it does on most sites, instead of walking back through every tab clicked.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab = (tabs as readonly string[]).includes(asked ?? "") ? (asked as T) : fallback;
  const setTab = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === fallback) updated.delete("tab");
          else updated.set("tab", next);
          return updated;
        },
        { replace: true },
      ),
    [setParams, fallback],
  );
  return [tab, setTab];
}
