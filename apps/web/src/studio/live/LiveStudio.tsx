import React from "react";
import { RadioTower } from "lucide-react";
import { useAuth } from "../../context/auth-context";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { RulesPanel } from "./rules/RulesPanel";
import { AgentsPanel } from "./agents/AgentsPanel";
import { livePath, useLiveRoute, type LiveTab } from "./live-route";

const TABS: Array<{ id: LiveTab; label: string }> = [
  { id: "connections", label: "Connections" },
  { id: "rules", label: "Rules" },
  { id: "agents", label: "Edge agents" },
];

/** Studio → Live: live data sources and their tags, and rules that turn changes into records */
export function LiveStudio() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "admin";
  const { view, go } = useLiveRoute();
  const tab = view.tab;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: "72rem" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <RadioTower size="1em" style={{ color: "var(--accent)" }} /> Live data
        </h1>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
          Connect machines and systems; their values become tags pages can show live, e.g. {"{{ live.line1.speed }}"}, and rules can save as records.
        </p>
      </div>
      <div role="tablist" aria-label="Live data" style={{ display: "flex", gap: "var(--space-1)", borderBottom: "var(--border-width-sm) solid var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="btn btn-ghost"
            onClick={() => go(livePath.tab(t.id))}
            style={{
              borderRadius: "var(--radius-none)",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
              fontWeight: tab === t.id ? 600 : 500,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "connections" && <ConnectionsPanel canEdit={canEdit} />}
      {tab === "rules" && <RulesPanel canEdit={canEdit} />}
      {tab === "agents" && <AgentsPanel canEdit={canEdit} />}
    </div>
  );
}
