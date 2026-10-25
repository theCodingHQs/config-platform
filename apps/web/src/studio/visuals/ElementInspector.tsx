/** Right-hand panel: the selected element's position and properties, or the canvas when nothing is selected */
import React, { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Lock, RotateCw, Trash2 } from "lucide-react";
import type { VisualDefinition, VisualElement } from "@config-platform/schema";
import { shapeOf } from "../../visuals/shapes";
import type { ResolvedElement } from "../../visuals/resolve-props";
import { liveApi } from "../../live/live-api";
import { Field, FieldRow } from "../live/Field";
import { PropField } from "./PropField";

interface Props {
  definition: VisualDefinition;
  element: VisualElement | null;
  resolved: ResolvedElement | undefined;
  onElement: (patch: Partial<VisualElement>, group?: string) => void;
  onCanvas: (patch: Partial<Omit<VisualDefinition, "elements">>, group?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

function CanvasSettings({ definition, onCanvas }: Pick<Props, "definition" | "onCanvas">) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>Canvas</h2>
      <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        Add shapes from the left, then select one to set its properties. The lightning button on a property sets it from live data.
      </p>
      <FieldRow>
        <Field label="Width" htmlFor="vis-w">
          <input id="vis-w" className="form-input" type="number" min={200} max={4000} value={definition.width} onChange={(e) => onCanvas({ width: Math.min(4000, Math.max(200, num(e.target.value, definition.width))) }, "canvas-w")} />
        </Field>
        <Field label="Height" htmlFor="vis-h">
          <input id="vis-h" className="form-input" type="number" min={150} max={3000} value={definition.height} onChange={(e) => onCanvas({ height: Math.min(3000, Math.max(150, num(e.target.value, definition.height))) }, "canvas-h")} />
        </Field>
      </FieldRow>
      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
        <input type="checkbox" checked={definition.grid === "isometric"} onChange={(e) => onCanvas({ grid: e.target.checked ? "isometric" : "none" })} />
        Show the floor grid
      </label>
    </div>
  );
}

export function ElementInspector({ definition, element, resolved, onElement, onCanvas, onDuplicate, onRemove }: Props) {
  const tagListId = useId();
  const { data: tags = [] } = useQuery({ queryKey: ["live-tags"], queryFn: liveApi.tags, staleTime: 30_000 });
  if (!element) return <CanvasSettings definition={definition} onCanvas={onCanvas} />;

  const shape = shapeOf(element.type);
  if (!shape) return <p style={{ color: "var(--danger)" }}>Unknown shape "{element.type}"</p>;
  const group = (name: string) => `${element.id}-${name}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }} aria-label="Element settings">
      <datalist id={tagListId}>
        {tags.map((t) => (
          <option key={t.tag} value={`live.${t.tag}`}>
            {t.label ?? t.connectionName}
          </option>
        ))}
      </datalist>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)", flex: 1 }}>{shape.label}</h2>
        <button type="button" className="btn btn-ghost" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={onDuplicate} style={{ padding: "var(--space-1)" }}>
          <Copy size="1em" />
        </button>
        <button type="button" className="btn btn-ghost" title="Delete (Del)" aria-label="Delete element" onClick={onRemove} style={{ padding: "var(--space-1)", color: "var(--danger)" }}>
          <Trash2 size="1em" />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{shape.description}</p>

      <Field label="Name" htmlFor="vis-el-name" hint="To find it in the list; not shown on the drawing">
        <input id="vis-el-name" className="form-input" value={element.name ?? ""} placeholder={shape.label} onChange={(e) => onElement({ name: e.target.value || undefined }, group("name"))} />
      </Field>

      {shape.props.map((spec) => (
        <PropField
          key={spec.name}
          spec={spec}
          value={element.props[spec.name]}
          binding={element.bindings[spec.name]}
          current={resolved?.props[spec.name]}
          problem={resolved?.problems[spec.name]}
          tagListId={tagListId}
          onValue={(value) => onElement({ props: { ...element.props, [spec.name]: value } }, group(`p-${spec.name}`))}
          onBinding={(expr) => {
            const bindings = { ...element.bindings };
            if (expr === undefined) delete bindings[spec.name];
            else bindings[spec.name] = expr;
            onElement({ bindings }, group(`b-${spec.name}`));
          }}
        />
      ))}

      <details>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 500 }}>Position and size</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", paddingTop: "var(--space-2)" }}>
          <FieldRow>
            <Field label="X" htmlFor="vis-el-x">
              <input id="vis-el-x" className="form-input" type="number" value={Math.round(element.x)} onChange={(e) => onElement({ x: num(e.target.value, element.x) }, group("x"))} />
            </Field>
            <Field label="Y" htmlFor="vis-el-y">
              <input id="vis-el-y" className="form-input" type="number" value={Math.round(element.y)} onChange={(e) => onElement({ y: num(e.target.value, element.y) }, group("y"))} />
            </Field>
          </FieldRow>
          <Field label={`Scale (${Math.round(element.scale * 100)}%)`} htmlFor="vis-el-scale">
            <input id="vis-el-scale" type="range" min={0.25} max={4} step={0.05} value={element.scale} onChange={(e) => onElement({ scale: Number(e.target.value) }, group("scale"))} />
          </Field>
          <Field label="Layer" htmlFor="vis-el-layer" hint="Higher layers draw on top; on the same layer, nearer shapes cover further ones">
            <input id="vis-el-layer" className="form-input" type="number" min={-10} max={10} value={element.layer ?? shape.layer ?? 0} onChange={(e) => onElement({ layer: Math.min(10, Math.max(-10, Math.round(num(e.target.value, 0)))) }, group("layer"))} />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {!shape.noTurn && (
              <button type="button" className={element.flip ? "btn btn-secondary" : "btn btn-ghost"} aria-pressed={element.flip} onClick={() => onElement({ flip: !element.flip })}>
                <RotateCw size="1em" /> Turn
              </button>
            )}
            <button type="button" className={element.locked ? "btn btn-secondary" : "btn btn-ghost"} aria-pressed={Boolean(element.locked)} onClick={() => onElement({ locked: !element.locked || undefined })}>
              <Lock size="1em" /> {element.locked ? "Locked" : "Lock in place"}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
