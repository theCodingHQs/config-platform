import React from "react";
import { Plus, X } from "lucide-react";
import type { ErdColumn, FieldAssignment } from "@config-platform/schema";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" };

/** Which fields the rule fills in, and with what (ts, value, "Line 1", live.line1.speed…) */
export function FieldAssignmentsEditor({
  fields,
  value,
  onChange,
  disabled,
  addLabel = "Add field",
}: {
  /** The entity's fields people can write (not calculated) */
  fields: ErdColumn[];
  value: FieldAssignment[];
  onChange: (next: FieldAssignment[]) => void;
  disabled?: boolean;
  addLabel?: string;
}) {
  const set = (i: number, patch: Partial<FieldAssignment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const unused = fields.find((f) => !value.some((a) => a.field === f.name));

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {value.map((a, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(9rem, 14rem) auto minmax(0, 1fr) auto", gap: "var(--space-2)", alignItems: "center" }}>
          <select className="form-select" aria-label="Field" value={a.field} onChange={(e) => set(i, { field: e.target.value })}>
            <option value="">Choose a field</option>
            {fields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>=</span>
          <input className="form-input" style={mono} aria-label={`Value for ${a.field || "field"}`} value={a.value} placeholder={i === 0 ? 'e.g. ts, value, "Line 1"' : ""} onChange={(e) => set(i, { value: e.target.value })} />
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove ${a.field || "field"}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size="1em" />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!unused} onClick={() => unused && onChange([...value, { field: unused.name, value: "" }])}>
          <Plus size="1em" /> {addLabel}
        </button>
      </div>
    </fieldset>
  );
}
