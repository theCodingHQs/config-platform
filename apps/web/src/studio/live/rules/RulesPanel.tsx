import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { LiveRule } from "@config-platform/schema";
import { liveRulesApi } from "../../../live/live-api";
import { LIVE_RULES_KEY, RuleEditor } from "./RuleEditor";
import { describeTrigger } from "./rule-draft";
import { livePath, useLiveRoute } from "../live-route";
import { NotFound } from "../ConnectionsPanel";

const STATUS_BADGE = { done: "badge badge-success", skipped: "badge", failed: "badge badge-danger" } as const;

/** Studio → Live → Rules: tag changes that create or update records */
export function RulesPanel({ canEdit }: { canEdit: boolean }) {
  const { view: route, go } = useLiveRoute();
  const view = route.tab === "rules" ? route : ({ tab: "rules", screen: "list" } as const);
  const toList = () => go(livePath.tab("rules"));
  const { data: rules = [], isLoading, error } = useQuery({ queryKey: LIVE_RULES_KEY, queryFn: liveRulesApi.list, refetchInterval: 5000 });

  // The saved rule takes the new form's place, so Back doesn't return to an empty form
  if (view.screen === "new") return <RuleEditor key="new" canEdit={canEdit} onSaved={(saved) => go(livePath.rule(saved.id), { replace: true })} onClose={toList} />;
  const editing = view.screen === "edit" ? rules.find((r) => r.id === view.id) : undefined;
  if (editing) return <RuleEditor key={editing.id} rule={editing} canEdit={canEdit} onSaved={() => undefined} onClose={toList} />;
  if (view.screen === "edit" && !isLoading) return <NotFound what="rule" onBack={toList} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {canEdit && (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => go(livePath.newRule())}>
            <Plus size="1em" /> New rule
          </button>
        </div>
      )}
      {isLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading rules…</p>
      ) : error ? (
        <p style={{ color: "var(--danger)" }}>{(error as Error).message}</p>
      ) : rules.length === 0 ? (
        <div style={{ padding: "var(--space-8) var(--space-4)", textAlign: "center", border: "var(--border-width) dashed var(--border)", borderRadius: "var(--radius-surface)", color: "var(--text-muted)" }}>
          No rules yet. A rule saves live events as records, for example a downtime record each time a machine stops.
        </div>
      ) : (
        <RuleList rules={rules} onOpen={(id) => go(livePath.rule(id))} />
      )}
    </div>
  );
}

function RuleList({ rules, onOpen }: { rules: LiveRule[]; onOpen: (id: string) => void }) {
  return (
    <div className="table-container">
      <table className="data-table responsive-cards">
        <thead>
          <tr>
            <th>Rule</th>
            <th>When</th>
            <th>Then</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="table-row-clickable" style={{ cursor: "pointer", opacity: r.enabled ? 1 : 0.6 }} onClick={() => onOpen(r.id)}>
              <td data-label="Rule" style={{ fontWeight: 600 }}>
                {r.name}
                {!r.enabled && <span className="badge" style={{ marginLeft: "var(--space-2)" }}>Off</span>}
              </td>
              <td data-label="When">
                <code style={{ fontSize: "var(--font-size-xs)" }}>{describeTrigger(r)}</code>
              </td>
              <td data-label="Then">{r.action.type === "createRecord" ? "Create a record" : "Update the latest record"}</td>
              <td data-label="Last run">
                {r.lastStatus ? (
                  <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                    <span className={STATUS_BADGE[r.lastStatus]}>{r.lastStatus === "done" ? "Done" : r.lastStatus === "failed" ? "Failed" : "Skipped"}</span>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }} title={r.lastMessage ?? undefined}>
                      {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : ""}
                    </span>
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>Not yet</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
