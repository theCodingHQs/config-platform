import React from "react";
import { LIVE_CONNECTION_KINDS, type LiveConnectionKind } from "@config-platform/schema";
import { KIND_UI } from "./kinds";

/** Step one of a new connection: what kind of source it is */
export function NewConnectionPicker({ onPick, onCancel }: { onPick: (kind: LiveConnectionKind) => void; onCancel: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h2 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600 }}>Where does the data come from?</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--space-3)" }}>
        {LIVE_CONNECTION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn-secondary"
            onClick={() => onPick(kind)}
            style={{ height: "auto", whiteSpace: "normal", flexDirection: "column", alignItems: "flex-start", textAlign: "left", gap: "var(--space-2)", padding: "var(--space-4)" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 600 }}>
              {KIND_UI[kind].icon} {KIND_UI[kind].label}
            </span>
            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)", fontWeight: 400 }}>{KIND_UI[kind].hint}</span>
          </button>
        ))}
      </div>
      <div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
