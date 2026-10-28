/** Built-in symbols in Studio → Visuals: cards in the list, and a read-only page for one */
import React from "react";
import { Link } from "react-router-dom";
import type { Visual } from "@config-platform/schema";
import { BUILTIN_SYMBOLS } from "@config-platform/schema/visual-library";
import { SymbolThumb } from "./SymbolsPalette";
import { Badge } from "../../library/SharedControls";
import { SymbolPreview } from "./SymbolPreview";

export function SymbolCard({ to, thumbId, name, description, badges }: { to?: string; thumbId?: string; name: string; description?: string; badges?: React.ReactNode }) {
  const body = (
    <>
      <div style={{ width: "4rem", flexShrink: 0 }}>{thumbId ? <SymbolThumb id={thumbId} height="3.5rem" /> : <div style={{ height: "3.5rem" }} />}</div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <div style={{ fontWeight: 600 }}>{name}</div>
        {badges && <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>{badges}</div>}
        {description && <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{description}</div>}
      </div>
    </>
  );
  const row = { display: "flex", gap: "var(--space-3)", alignItems: "center", textDecoration: "none", color: "inherit" } as const;
  return to ? (
    <Link to={to} style={row}>
      {body}
    </Link>
  ) : (
    <div style={row}>{body}</div>
  );
}

export function BuiltinSymbolCards({ grid }: { grid: React.CSSProperties }) {
  return (
    <ul style={grid}>
      {BUILTIN_SYMBOLS.map((s) => (
        <li key={s.id} className="card" style={{ padding: "var(--space-3)" }}>
          <SymbolCard to={`/studio/visuals/${s.id}`} thumbId={s.id} name={s.name} description={s.description} />
        </li>
      ))}
    </ul>
  );
}

export function BuiltinSymbolView({ visual }: { visual: Visual }) {
  const spec = BUILTIN_SYMBOLS.find((s) => s.id === visual.id);
  return (
    <SymbolPreview
      visual={visual}
      badges={<Badge tone="accent">Built-in</Badge>}
      about={`${spec?.description ?? "A built-in symbol"}. It comes with the app and can't be changed; place it from the Symbols palette in any drawing, or make your own copy to change it.`}
    />
  );
}
