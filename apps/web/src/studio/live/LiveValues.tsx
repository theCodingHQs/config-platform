import React from "react";
import type { TagRule } from "@config-platform/schema";
import { useLiveSnapshot } from "../../live/use-live";

const QUALITY: Record<string, { label: string; className: string }> = {
  good: { label: "Live", className: "badge badge-success" },
  stale: { label: "Stale", className: "badge badge-warning" },
  bad: { label: "Unreadable", className: "badge badge-danger" },
};

const cell: React.CSSProperties = { padding: "var(--space-1) var(--space-2)", textAlign: "left" };

/** The connection's tags as pages see them right now, with how to use each one */
export function LiveValues({ rules }: { rules: TagRule[] }) {
  const { values } = useLiveSnapshot(rules.map((r) => r.tag));
  if (rules.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-size-sm)" }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>
            <th style={cell}>Use in a page</th>
            <th style={cell}>Value</th>
            <th style={cell}>State</th>
            <th style={cell}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const v = values[r.tag];
            const quality = v ? QUALITY[v.quality] : null;
            return (
              <tr key={r.tag} style={{ borderTop: "var(--border-width-sm) solid var(--border-subtle)" }}>
                <td style={cell}>
                  <code style={{ fontSize: "var(--font-size-xs)" }}>{`{{ live.${r.tag} }}`}</code>
                </td>
                <td style={{ ...cell, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {v ? `${v.value === null ? "—" : String(v.value)}${r.unit ? ` ${r.unit}` : ""}` : "—"}
                </td>
                <td style={cell}>{quality ? <span className={quality.className}>{quality.label}</span> : <span style={{ color: "var(--text-muted)" }}>Waiting</span>}</td>
                <td style={{ ...cell, color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>{v ? new Date(v.ts).toLocaleTimeString() : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
