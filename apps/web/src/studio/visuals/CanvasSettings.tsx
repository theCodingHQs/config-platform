/** The inspector when nothing is selected: the canvas itself */
import React from "react";
import type { VisualDefinition } from "@config-platform/schema";
import { Field, FieldRow } from "../live/Field";
import { ColorInput } from "./ColorInput";
import { PaintsEditor } from "./PaintsEditor";
import { InputsEditor } from "./InputsEditor";

interface Props {
  definition: VisualDefinition;
  /** Editing a symbol: show its inputs */
  isSymbol?: boolean;
  onCanvas: (patch: Partial<Omit<VisualDefinition, "nodes">>, group?: string) => void;
}

const num = (v: string, fallback: number, min: number, max: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Math.min(max, Math.max(min, Math.round(Number(v)))));

export function CanvasSettings({ definition, isSymbol, onCanvas }: Props) {
  const iso = definition.mode === "isometric";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {isSymbol && (
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>Symbol inputs</h2>
          <InputsEditor inputs={definition.inputs ?? []} onChange={(inputs, group) => onCanvas({ inputs }, group)} />
        </section>
      )}
      <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>Canvas</h2>
      <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        Draw with the tools on the left or add ready-made parts, then select something to set it up. The lightning button on any setting takes it from live data; rules change several settings at once when a condition holds.
      </p>
      <Field label="View" htmlFor="vis-mode" hint={iso ? "2.5D: parts stand on a floor grid; flat shapes can be laid on the floor or a wall" : "2D: a flat drawing, like a mimic panel"}>
        <select id="vis-mode" className="form-select" value={definition.mode} onChange={(e) => onCanvas({ mode: e.target.value as VisualDefinition["mode"] })}>
          <option value="flat">Flat (2D)</option>
          <option value="isometric">Isometric (2.5D)</option>
        </select>
      </Field>
      <FieldRow>
        <Field label="Width" htmlFor="vis-w">
          <input id="vis-w" className="form-input" type="number" min={20} max={6000} value={definition.width} onChange={(e) => onCanvas({ width: num(e.target.value, definition.width, 20, 6000) }, "canvas-w")} />
        </Field>
        <Field label="Height" htmlFor="vis-h">
          <input id="vis-h" className="form-input" type="number" min={20} max={4000} value={definition.height} onChange={(e) => onCanvas({ height: num(e.target.value, definition.height, 20, 4000) }, "canvas-h")} />
        </Field>
      </FieldRow>
      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
        <input type="checkbox" checked={definition.grid} onChange={(e) => onCanvas({ grid: e.target.checked })} />
        {iso ? "Show the floor grid and snap to it" : "Snap to a grid"}
      </label>
      {!iso && definition.grid && (
        <Field label="Grid step" htmlFor="vis-grid">
          <input id="vis-grid" className="form-input" type="number" min={2} max={200} value={definition.gridSize} onChange={(e) => onCanvas({ gridSize: num(e.target.value, definition.gridSize, 2, 200) }, "canvas-grid")} />
        </Field>
      )}
      <Field label="Background" htmlFor="vis-bg" hint="Empty: the theme's canvas colour">
        <ColorInput id="vis-bg" value={definition.background ?? ""} paints={[]} onChange={(v) => onCanvas({ background: v || undefined }, "canvas-bg")} />
      </Field>
      <details open={Boolean(definition.paints?.length)}>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>Gradients</summary>
        <div style={{ paddingTop: "var(--space-2)" }}>
          <PaintsEditor paints={definition.paints ?? []} onChange={(paints, group) => onCanvas({ paints: paints.length ? paints : undefined }, group && `paint-${group}`)} />
        </div>
      </details>
    </div>
  );
}
