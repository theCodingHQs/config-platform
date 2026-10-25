/**
 * Writes a scale() binding without typing it: "when the tag goes from 0 to 30700, this goes from
 * 20 to 1380". Opens with the current binding's values when it already is one.
 */
import React, { useState } from "react";
import { ExpressionInput } from "../../components/expression-input/ExpressionInput";

const SCALE = /^scale\((.+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/;

export function parseScale(binding: string): { expr: string; range: [string, string, string, string] } {
  const m = SCALE.exec(binding.trim());
  if (m) return { expr: m[1].trim(), range: [m[2], m[3], m[4], m[5]] };
  return { expr: binding.trim(), range: ["0", "100", "0", "100"] };
}

export const scaleBinding = (expr: string, [a, b, c, d]: readonly string[]) => `scale(${expr.trim()}, ${Number(a) || 0}, ${Number(b) || 0}, ${Number(c) || 0}, ${Number(d) || 0})`;

const small = { fontSize: "var(--font-size-xs)" } as const;

export function RangeMapper({ binding, label, onUse }: { binding: string; label: string; onUse: (binding: string) => void }) {
  const start = parseScale(binding);
  const [expr, setExpr] = useState(start.expr);
  const [range, setRange] = useState(start.range);
  const box = (i: number, name: string) => (
    <input
      className="form-input"
      type="number"
      aria-label={name}
      value={range[i]}
      onChange={(e) => setRange(range.map((v, j) => (j === i ? e.target.value : v)) as typeof range)}
      style={{ width: "5rem", ...small }}
    />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "var(--space-2)", border: "var(--border-width-sm) dashed var(--border)", borderRadius: "var(--radius-control)" }}>
      <ExpressionInput aria-label="Value to follow" placeholder="live.cart.position" value={expr} onChange={setExpr} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-1)", ...small }}>
        when it goes from {box(0, "From")} to {box(1, "To")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-1)", ...small }}>
        {label} goes from {box(2, `${label} from`)} to {box(3, `${label} to`)}
      </div>
      <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start", ...small }} disabled={!expr.trim()} onClick={() => onUse(scaleBinding(expr, range))}>
        Use this
      </button>
    </div>
  );
}
