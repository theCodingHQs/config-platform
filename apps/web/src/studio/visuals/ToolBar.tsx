/** The drawing tools, top to bottom; the active one is highlighted */
import React from "react";
import { TOOLS, type ToolId } from "./tools";

export function ToolBar({ tool, onTool }: { tool: ToolId; onTool: (id: ToolId) => void }) {
  return (
    <div role="toolbar" aria-label="Drawing tools" aria-orientation="vertical" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = t.id === tool;
        return (
          <button
            key={t.id}
            type="button"
            className={active ? "btn btn-secondary" : "btn btn-ghost"}
            aria-pressed={active}
            aria-label={t.label}
            title={`${t.label} (${t.key.toUpperCase()}): ${t.hint}`}
            onClick={() => onTool(t.id)}
            style={{ padding: "var(--space-2)", color: active ? "var(--accent)" : undefined }}
          >
            <Icon size="1.1em" />
          </button>
        );
      })}
    </div>
  );
}
