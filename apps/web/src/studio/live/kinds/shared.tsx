/** Pieces several connection kinds share: text helpers, secret headers, message format. */
import React from "react";
import { Plus, X } from "lucide-react";
import { Field } from "../Field";

export const optional = (text: string) => (text.trim() ? text.trim() : undefined);
export const lines = (text: string, separator: RegExp = /[\n,]+/) => text.split(separator).map((t) => t.trim()).filter(Boolean);
export const fieldset: React.CSSProperties = { border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" };
export const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" };

// ─── Headers whose values are secrets (tokens) ──────────────────────────────

export interface HeaderDraft {
  name: string;
  /** Typed value; empty = keep the saved one */
  value: string;
  saved: boolean;
}

export const headersFromSaved = (headers: any[] | undefined): HeaderDraft[] => (headers ?? []).map((h) => ({ name: h.name, value: "", saved: Boolean(h.hasValue) }));

export const headersToInput = (headers: HeaderDraft[]) => headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), ...(h.value ? { value: h.value } : {}) }));

export function HeadersField({ value, onChange, hint }: { value: HeaderDraft[]; onChange: (next: HeaderDraft[]) => void; hint?: string }) {
  const set = (i: number, patch: Partial<HeaderDraft>) => onChange(value.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <Field label="Headers (optional)" hint={hint ?? "For systems that need a token, e.g. Authorization: Bearer …. Values are stored encrypted and never shown again."}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {value.map((h, i) => (
          <div key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input className="form-input" aria-label="Header name" placeholder="Authorization" value={h.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input
              className="form-input"
              type="password"
              aria-label="Header value"
              autoComplete="off"
              placeholder={h.saved ? "Saved (type to replace)" : "Value"}
              value={h.value}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove header" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X size="1em" />
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...value, { name: "", value: "", saved: false }])}>
            <Plus size="1em" /> Add header
          </button>
        </div>
      </div>
    </Field>
  );
}

// ─── How messages are read ───────────────────────────────────────────────────

export type MessageFormat = "json" | "text" | "number";

export function FormatSelect({ id, value, onChange }: { id: string; value: MessageFormat; onChange: (format: MessageFormat) => void }) {
  return (
    <Field label="Messages are" htmlFor={id} hint={value === "json" ? 'Use message.speed for {"speed": 41}' : "Use message for the whole value"}>
      <select id={id} className="form-select" value={value} onChange={(e) => onChange(e.target.value as MessageFormat)}>
        <option value="json">JSON</option>
        <option value="number">A single number</option>
        <option value="text">Plain text</option>
      </select>
    </Field>
  );
}

// ─── Named values a device provides (Modbus registers, OPC UA nodes) ─────────

/** A small editable table: one row per named value */
export function RowsEditor<T>({
  rows,
  onChange,
  columns,
  newRow,
  addLabel,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  columns: Array<{ label: string; render: (row: T, set: (patch: Partial<T>) => void) => React.ReactNode }>;
  newRow: () => T;
  addLabel: string;
}) {
  const cell: React.CSSProperties = { padding: "var(--space-1)", verticalAlign: "top" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-size-sm)" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>
              {columns.map((c) => (
                <th key={c.label} style={cell}>
                  {c.label}
                </th>
              ))}
              <th style={cell} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const set = (patch: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
              return (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.label} style={cell}>
                      {c.render(row, set)}
                    </td>
                  ))}
                  <td style={cell}>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <X size="1em" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...rows, newRow()])}>
          <Plus size="1em" /> {addLabel}
        </button>
      </div>
    </div>
  );
}
