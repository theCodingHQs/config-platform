/**
 * Picking a colour: the theme's colours (they follow light and dark mode), the drawing's
 * gradients, none, any colour from the picker, or typed in (#hex, rgb(), a var(--token)).
 */
import React, { useState } from "react";
import { SWATCHES } from "../../visuals/shapes";

const THEME = [...SWATCHES, "on", "idle", "off", "alarm", "label", "label-bg", "floor", "glass", "liquid"].map((name) => ({ value: `var(--vis-${name})`, label: name }));

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

interface Props {
  id: string;
  value: string;
  paints: readonly string[];
  onChange: (value: string) => void;
}

function Chip({ value, label, chosen, onPick }: { value: string; label: string; chosen: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={chosen}
      onClick={onPick}
      style={{
        width: "1.4rem",
        height: "1.4rem",
        padding: 0,
        cursor: "pointer",
        borderRadius: "var(--radius-control)",
        border: chosen ? "var(--border-width-md) solid var(--accent)" : "var(--border-width-sm) solid var(--border)",
        background: value === "none" ? "repeating-linear-gradient(45deg, var(--surface) 0 4px, var(--border) 4px 5px)" : undefined,
      }}
    >
      {value !== "none" && (
        <svg width="100%" height="100%" viewBox="0 0 10 10" aria-hidden="true" style={{ display: "block", borderRadius: "inherit" }}>
          <rect width="10" height="10" fill={value} />
        </svg>
      )}
    </button>
  );
}

export function ColorInput({ id, value, paints, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
        <Chip value={value || "none"} label={open ? "Hide colours" : "Choose a colour"} chosen={open} onPick={() => setOpen(!open)} />
        <input id={id} className="form-input" value={value} placeholder="Not set" onChange={(e) => onChange(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }} />
      </div>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", alignItems: "center" }}>
          <Chip value="none" label="None" chosen={value === "none"} onPick={() => onChange("none")} />
          {THEME.map((c) => (
            <Chip key={c.value} value={c.value} label={c.label} chosen={value === c.value} onPick={() => onChange(c.value)} />
          ))}
          {paints.map((p) => (
            <button key={p} type="button" className="btn btn-ghost" style={{ padding: "0 var(--space-1)", fontSize: "var(--font-size-xs)" }} aria-pressed={value === `url(#${p})`} onClick={() => onChange(`url(#${p})`)}>
              {p}
            </button>
          ))}
          <input type="color" aria-label="Any colour" title="Any colour" value={isHex(value) ? value : undefined} onChange={(e) => onChange(e.target.value)} style={{ width: "1.6rem", height: "1.4rem", padding: 0, border: 0, background: "none" }} />
          {value && (
            <button type="button" className="btn btn-ghost" style={{ padding: "0 var(--space-1)", fontSize: "var(--font-size-xs)" }} onClick={() => onChange("")}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
