/**
 * One shape property in the inspector: its set value, and optionally a binding (an expression over
 * live data) that sets it while the visual is shown. The live result is shown under the binding.
 */
import React, { useId } from "react";
import { Zap } from "lucide-react";
import { SWATCHES, type PropSpec } from "../../visuals/shapes";
import { Field } from "../live/Field";

interface Props {
  spec: PropSpec;
  value: unknown;
  binding: string | undefined;
  /** What the property is right now (with the binding applied) */
  current: unknown;
  problem?: string;
  tagListId: string;
  onValue: (value: string | number | boolean) => void;
  onBinding: (expr: string | undefined) => void;
}

function ValueInput({ spec, value, id, onValue }: { spec: PropSpec; value: unknown; id: string; onValue: Props["onValue"] }) {
  switch (spec.kind) {
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

export function PropField({ spec, value, binding, current, problem, tagListId, onValue, onBinding }: Props) {
  const id = useId();
  const bound = binding !== undefined;
  const canBind = spec.bindable !== false;
  // "e.g. …" hints are binding examples (the binding's placeholder); others describe the property
  const example = spec.hint?.startsWith("e.g. ") ? spec.hint.slice(5) : undefined;
  return (
    <Field label={spec.label} htmlFor={id} hint={!bound && !example ? spec.hint : undefined}>
      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, opacity: bound ? 0.55 : 1 }}>
          <ValueInput spec={spec} value={value} id={id} onValue={onValue} />
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
            placeholder={example ?? "live.line1.speed"}
            value={binding}
            onChange={(e) => onBinding(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          />
          <span style={{ fontSize: "var(--font-size-xs)", color: problem && binding?.trim() ? "var(--warning)" : "var(--text-muted)" }}>
            {!binding?.trim() ? "Type an expression, e.g. live.line1.speed" : problem ? `${problem}; using the set value` : `Now: ${show(current)}`}
          </span>
        </div>
      )}
    </Field>
  );
}
