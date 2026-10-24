import React, { useState } from "react";
import { RadioTower } from "lucide-react";
import { useAuth } from "../../context/auth-context";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { RulesPanel } from "./rules/RulesPanel";

type Tab = "connections" | "rules";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "connections", label: "Connections" },
  { id: "rules", label: "Rules" },
];

/** Studio → Live: live data sources and their tags, and rules that turn changes into records */
export function LiveStudio() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "admin";
  const [tab, setTab] = useState<Tab>("connections");

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
            onClick={() => setTab(t.id)}
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
      {tab === "connections" ? <ConnectionsPanel canEdit={canEdit} /> : <RulesPanel canEdit={canEdit} />}
    </div>
  );
}
