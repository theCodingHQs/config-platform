import React from "react";

/** A titled card on the Live screen */
export function Section({ title, intro, children, actions }: { title: string; intro?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-surface)",
        background: "var(--surface)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--font-size-base)", fontWeight: 600 }}>{title}</h2>
          {intro && <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{intro}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
