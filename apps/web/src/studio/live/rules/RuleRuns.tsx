import React from "react";
import { useQuery } from "@tanstack/react-query";
import { liveRulesApi } from "../../../live/live-api";

const BADGE = { done: "badge badge-success", skipped: "badge", failed: "badge badge-danger" } as const;
const LABEL = { done: "Done", skipped: "Skipped", failed: "Failed" } as const;

/** The rule's recent runs: what it did, or why it didn't */
export function RuleRuns({ ruleId }: { ruleId: string }) {
  const { data: runs = [] } = useQuery({ queryKey: ["live-rule-runs", ruleId], queryFn: () => liveRulesApi.runs(ruleId), refetchInterval: 3000 });
  if (runs.length === 0) {
    return <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>Not run yet. It runs as soon as its tag changes as described.</p>;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {runs.map((r, i) => (
        <li key={`${r.at}-${i}`} style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", fontSize: "var(--font-size-sm)", flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-xs)", minWidth: "6rem" }}>{new Date(r.at).toLocaleTimeString()}</span>
          <span className={BADGE[r.status]}>{LABEL[r.status]}</span>
          <span style={{ color: r.status === "failed" ? "var(--danger)" : "var(--text)" }}>{r.message}</span>
        </li>
      ))}
    </ul>
  );
}
