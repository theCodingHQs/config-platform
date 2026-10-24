import React from "react";
import { Plus, X } from "lucide-react";
import type { ErdColumn, RecordMatch } from "@config-platform/schema";

/** Which record "update the latest" changes: the newest one meeting every condition */
export function MatchEditor({ fields, value, onChange, disabled }: { fields: ErdColumn[]; value: RecordMatch[]; onChange: (next: RecordMatch[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<RecordMatch>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {value.map((m, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(9rem, 14rem) minmax(8rem, 10rem) minmax(0, 1fr) auto", gap: "var(--space-2)", alignItems: "center" }}>
          <select className="form-select" aria-label="Field" value={m.field} onChange={(e) => set(i, { field: e.target.value })}>
            <option value="">Choose a field</option>
            {fields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>
          <select className="form-select" aria-label="Condition" value={m.op} onChange={(e) => set(i, { op: e.target.value as RecordMatch["op"] })}>
            <option value="isEmpty">is empty</option>
            <option value="equals">equals</option>
          </select>
          {m.op === "equals" ? (
            <input className="form-input" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }} aria-label="Equals" placeholder='e.g. "Line 1"' value={m.value ?? ""} onChange={(e) => set(i, { value: e.target.value })} />
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove condition" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size="1em" />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...value, { field: fields[0]?.name ?? "", op: "isEmpty" }])}>
          <Plus size="1em" /> Add condition
        </button>
      </div>
    </fieldset>
  );
}
