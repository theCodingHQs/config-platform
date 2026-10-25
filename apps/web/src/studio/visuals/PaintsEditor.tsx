/** The drawing's gradients: add one, then pick it as a fill or outline colour ("url(#name)") */
import React, { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { VisualPaint } from "@config-platform/schema";
import { PaintDefs } from "../../visuals/paints";
import { ColorInput } from "./ColorInput";

const DIRECTIONS = {
  down: { label: "Top to bottom", x1: 0, y1: 0, x2: 0, y2: 1 },
  right: { label: "Left to right", x1: 0, y1: 0, x2: 1, y2: 0 },
  diagonal: { label: "Corner to corner", x1: 0, y1: 0, x2: 1, y2: 1 },
} as const;

const directionOf = (p: VisualPaint) =>
  (Object.keys(DIRECTIONS) as Array<keyof typeof DIRECTIONS>).find((k) => DIRECTIONS[k].x2 === (p.x2 ?? 0) && DIRECTIONS[k].y2 === (p.y2 ?? 1) && (p.x1 ?? 0) === 0 && (p.y1 ?? 0) === 0) ?? "down";

function Preview({ paint }: { paint: VisualPaint }) {
  const prefix = `pv${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width="48" height="28" aria-hidden="true" style={{ borderRadius: "var(--radius-control)", border: "var(--border-width-sm) solid var(--border)", flex: "none" }}>
      <PaintDefs paints={[paint]} prefix={prefix} />
      <rect width="48" height="28" fill={`url(#${prefix}-${paint.id})`} />
    </svg>
  );
}

function freeId(paints: readonly VisualPaint[]) {
  const taken = new Set(paints.map((p) => p.id));
  for (let i = 1; ; i++) if (!taken.has(`gradient${i}`)) return `gradient${i}`;
}

const small = { fontSize: "var(--font-size-xs)" } as const;

export function PaintsEditor({ paints, onChange }: { paints: readonly VisualPaint[]; onChange: (paints: VisualPaint[], group?: string) => void }) {
  const set = (i: number, p: VisualPaint, group?: string) => onChange(paints.map((q, j) => (j === i ? p : q)), group);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {paints.map((paint, i) => (
        <div key={paint.id} style={{ border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)", padding: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Preview paint={paint} />
            <code style={{ flex: 1, ...small }}>url(#{paint.id})</code>
            <button type="button" className="btn btn-ghost" aria-label={`Delete ${paint.id}`} style={{ padding: "var(--space-1)", color: "var(--danger)" }} onClick={() => onChange(paints.filter((_, j) => j !== i))}>
              <Trash2 size="1em" />
            </button>
          </div>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <select className="form-select" aria-label={`${paint.id} kind`} value={paint.type} onChange={(e) => set(i, { ...paint, type: e.target.value as VisualPaint["type"] })} style={{ flex: 1, ...small }}>
              <option value="linear">Straight</option>
              <option value="radial">Round</option>
            </select>
            {paint.type === "linear" && (
              <select
                className="form-select"
                aria-label={`${paint.id} direction`}
                value={directionOf(paint)}
                onChange={(e) => {
                  const { label: _label, ...dir } = DIRECTIONS[e.target.value as keyof typeof DIRECTIONS];
                  set(i, { ...paint, ...dir });
                }}
                style={{ flex: 1, ...small }}
              >
                {Object.entries(DIRECTIONS).map(([k, d]) => (
                  <option key={k} value={k}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {paint.stops.map((stop, k) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 4rem auto", gap: "var(--space-1)", alignItems: "start" }}>
              <ColorInput id={`${paint.id}-stop-${k}`} value={stop.color} paints={[]} onChange={(color) => set(i, { ...paint, stops: paint.stops.map((s, j) => (j === k ? { ...s, color } : s)) }, `${paint.id}-${k}-c`)} />
              <input
                className="form-input"
                type="number"
                min={0}
                max={100}
                aria-label={`Stop ${k + 1} position (%)`}
                title="Position (%)"
                value={Math.round(stop.offset * 100)}
                onChange={(e) => set(i, { ...paint, stops: paint.stops.map((s, j) => (j === k ? { ...s, offset: Math.min(1, Math.max(0, Number(e.target.value) / 100)) } : s)) }, `${paint.id}-${k}-o`)}
                style={small}
              />
              <button type="button" className="btn btn-ghost" aria-label={`Remove stop ${k + 1}`} disabled={paint.stops.length < 2} style={{ padding: "var(--space-1)" }} onClick={() => set(i, { ...paint, stops: paint.stops.filter((_, j) => j !== k) })}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", ...small }} disabled={paint.stops.length >= 20} onClick={() => set(i, { ...paint, stops: [...paint.stops, { offset: 1, color: "var(--vis-steel)" }] })}>
            <Plus size="1em" /> Add a colour
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", ...small }}
        disabled={paints.length >= 100}
        onClick={() => onChange([...paints, { id: freeId(paints), type: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "var(--vis-white)" }, { offset: 1, color: "var(--vis-steel)" }] }])}
      >
        <Plus size="1em" /> Add a gradient
      </button>
    </div>
  );
}
