import React from "react";

/** A labelled form control with an optional hint underneath (the Live screen's forms) */
export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
      <label className="form-label" htmlFor={htmlFor} style={{ fontSize: "var(--font-size-xs)", margin: 0 }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

/** Fields side by side that wrap on narrow screens */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "var(--space-3)" }}>{children}</div>;
}
