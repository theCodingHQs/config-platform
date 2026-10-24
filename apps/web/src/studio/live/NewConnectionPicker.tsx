import React from "react";
import { Activity, Radio, Waves } from "lucide-react";
import { LIVE_CONNECTION_KINDS, type LiveConnectionKind } from "@config-platform/schema";
import { KIND_HINTS, KIND_LABELS } from "./connection-draft";

const ICONS: Record<LiveConnectionKind, React.ReactNode> = {
  websocket: <Activity size="1.4em" />,
  mqtt: <Radio size="1.4em" />,
  simulator: <Waves size="1.4em" />,
};

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
              {ICONS[kind]} {KIND_LABELS[kind]}
            </span>
            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)", fontWeight: 400 }}>{KIND_HINTS[kind]}</span>
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
