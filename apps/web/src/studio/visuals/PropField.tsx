/**
 * One shape property in the inspector: its set value, and optionally a binding (an expression over
 * live data) that sets it while the visual is shown. The live result is shown under the binding.
 */
import React, { useId, useState } from "react";
import { Zap } from "lucide-react";
import { SWATCHES, type PropSpec } from "../../visuals/shapes";
import { Field } from "../live/Field";
import { ColorInput } from "./ColorInput";
import { RangeMapper } from "./RangeMapper";

interface Props {
  spec: PropSpec;
  value: unknown;
  binding: string | undefined;
  /** What the property is right now (with the binding applied) */
  current: unknown;
  problem?: string;
  tagListId: string;
  /** The drawing's gradients, offered for colours */
  paints?: readonly string[];
  onValue: (value: string | number | boolean) => void;
  onBinding: (expr: string | undefined) => void;
}

export function ValueInput({ spec, value, id, paints, onValue }: { spec: PropSpec; value: unknown; id: string; paints: readonly string[]; onValue: Props["onValue"] }) {
  switch (spec.kind) {
    case "color":
      return <ColorInput id={id} value={String(value ?? spec.default)} paints={paints} onChange={onValue} />;
    case "code":
      return (
        <textarea
          id={id}
          className="form-input"
          rows={3}
          spellCheck={false}
          value={String(value ?? spec.default)}
          onChange={(e) => onValue(e.target.value)}
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", resize: "vertical" }}
        />
      );
    case "number":
      return (
        <input
          id={id}
          className="form-input"
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? "any"}
          value={value === undefined ? spec.default : Number(value)}
          onChange={(e) => e.target.value !== "" && onValue(Number(e.target.value))}
        />
      );
    case "boolean":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
          <input id={id} type="checkbox" checked={Boolean(value ?? spec.default)} onChange={(e) => onValue(e.target.checked)} />
          {Boolean(value ?? spec.default) ? "On" : "Off"}
        </label>
      );
    case "text":
      return <input id={id} className="form-input" value={String(value ?? spec.default)} onChange={(e) => onValue(e.target.value)} />;
    case "swatch":
      return (
        <div role="radiogroup" aria-labelledby={id} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
          {SWATCHES.map((name) => {
            const chosen = (value ?? spec.default) === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={name}
                title={name}
                onClick={() => onValue(name)}
                style={{
                  width: "1.5rem",
                  height: "1.5rem",
                  borderRadius: "var(--radius-pill)",
                  background: `var(--vis-${name})`,
                  border: chosen ? "var(--border-width-md) solid var(--accent)" : "var(--border-width-sm) solid var(--border)",
                  outline: chosen ? "var(--border-width-sm) solid var(--surface)" : undefined,
                  outlineOffset: "-3px",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      );
    case "select":
      return (
        <select id={id} className="form-select" value={String(value ?? spec.default)} onChange={(e) => onValue(e.target.value)}>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
  }
}

const show = (v: unknown) => (typeof v === "string" ? `"${v}"` : String(v));

export function PropField({ spec, value, binding, current, problem, tagListId, paints = [], onValue, onBinding }: Props) {
  const reactId = useId();
  // Stable ids for fields other parts of the editor focus (double-clicking text focuses "Text")
  const id = spec.name === "text" ? "vis-attr-text" : reactId;
  const bound = binding !== undefined;
  const canBind = spec.bindable !== false;
  // "e.g. …" hints are binding examples (the binding's placeholder); others describe the property
  const example = spec.hint?.startsWith("e.g. ") ? spec.hint.slice(5) : undefined;
  const [mapping, setMapping] = useState(false);
  return (
    <Field label={spec.label} htmlFor={id} hint={!bound && !example ? spec.hint : undefined}>
      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, opacity: bound ? 0.55 : 1 }}>
          <ValueInput spec={spec} value={value} id={id} paints={paints} onValue={onValue} />
        </div>
        {canBind && (
          <button
            type="button"
            className={bound ? "btn btn-secondary" : "btn btn-ghost"}
            title={bound ? "Stop using live data for this" : "Set this from live data"}
            aria-label={`${bound ? "Remove binding from" : "Bind"} ${spec.label}`}
            aria-pressed={bound}
            onClick={() => onBinding(bound ? undefined : "")}
            style={{ padding: "var(--space-1)", color: bound ? "var(--accent)" : "var(--text-muted)" }}
          >
            <Zap size="1em" />
          </button>
        )}
      </div>
      {bound && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <input
            className="form-input"
            list={tagListId}
            aria-label={`${spec.label} binding`}
            placeholder={example ?? (spec.kind === "number" ? "e.g. scale(live.cart.position, 0, 30700, 20, 1380)" : "live.line1.speed")}
            value={binding}
            onChange={(e) => onBinding(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          />
          <span style={{ fontSize: "var(--font-size-xs)", color: problem && binding?.trim() ? "var(--warning)" : "var(--text-muted)" }}>
            {!binding?.trim() ? "Type an expression, e.g. live.line1.speed" : problem ? `${problem}; using the set value` : `Now: ${show(current)}`}
          </span>
          {spec.kind === "number" && (
            <button type="button" className="btn btn-ghost" aria-expanded={mapping} style={{ alignSelf: "flex-start", padding: "0 var(--space-1)", fontSize: "var(--font-size-xs)" }} onClick={() => setMapping(!mapping)}>
              {mapping ? "Close the range helper" : "Map a range…"}
            </button>
          )}
          {mapping && (
            <RangeMapper
              binding={binding ?? ""}
              tagListId={tagListId}
              label={spec.label}
              onUse={(b) => {
                onBinding(b);
                setMapping(false);
              }}
            />
          )}
        </div>
      )}
    </Field>
  );
}
