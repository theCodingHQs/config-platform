import React, { useId, useRef } from "react";
import { CALCULATED_FIELD_TYPES, type ErdColumn } from "@config-platform/schema";

/** Examples shown under the formula box (they match the production sheet template). */
const FUNCTION_HELP: Array<{ example: string; meaning: string }> = [
  { example: 'countTrue(range("day_01", "day_31"))', meaning: "How many of these checkboxes are ticked" },
  { example: "round(days_met * 100 / planned_days, 1)", meaning: "Maths with + - * / and rounding" },
  { example: "if(planned_days > 0, a, b)", meaning: "One value or another depending on a condition" },
  { example: "max(planned_days - days_met, 0)", meaning: "Largest / smallest value: max(), min()" },
  { example: "sum(a, b, c)  avg(a, b)  count(a, b)", meaning: "Totals, averages, filled-in values" },
  { example: "machine.name", meaning: "A field of the linked record (Link fields)" },
  { example: 'concat(machine.name, " - ", notes)', meaning: "Join text; upper(), lower(), trim()" },
];

export function canBeCalculated(type: string): boolean {
  return (CALCULATED_FIELD_TYPES as readonly string[]).includes(type);
}

/**
 * "Value: Entered by people / Calculated" for a number, text or yes/no field. `formula` null
 * means entered by people. Field names in the list can be clicked to insert them.
 */
export function FormulaEditor({
  idPrefix,
  fieldType,
  formula,
  onChange,
  otherFields,
  problem,
}: {
  idPrefix: string;
  fieldType: string;
  formula: string | null;
  onChange: (formula: string | null) => void;
  /** Fields of this entity the formula can use (the field being edited excluded) */
  otherFields: ErdColumn[];
  /** Why the formula can't work (see formulaProblem); the dialog can't be saved meanwhile */
  problem?: string | null;
}) {
  const problemId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const helpId = useId();
  if (!canBeCalculated(fieldType)) return null;
  const calculated = formula !== null;

  const insert = (text: string) => {
    const el = textareaRef.current;
    const current = formula ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + text + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const usable = otherFields.filter((f) => !["id", "created_at", "updated_at"].includes(f.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div>
        <span className="form-label" style={{ fontSize: "var(--font-size-xs)" }}>Value</span>
        <div role="radiogroup" aria-label="Value" style={{ display: "flex", gap: "var(--space-4)", fontSize: "var(--font-size-sm)" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
            <input type="radio" name={`${idPrefix}-value`} checked={!calculated} onChange={() => onChange(null)} />
            Entered by people
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
            <input type="radio" name={`${idPrefix}-value`} checked={calculated} onChange={() => onChange(formula ?? "")} />
            Calculated
          </label>
        </div>
      </div>

      {calculated && (
        <>
          <div>
            <label className="form-label" htmlFor={`${idPrefix}-formula`} style={{ fontSize: "var(--font-size-xs)" }}>
              Formula
            </label>
            <textarea
              id={`${idPrefix}-formula`}
              ref={textareaRef}
              className="form-input"
              rows={3}
              value={formula ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder='e.g. countTrue(range("day_01", "day_31"))'
              aria-describedby={problem ? `${problemId} ${helpId}` : helpId}
              aria-invalid={problem ? true : undefined}
              spellCheck={false}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-size-sm)",
                height: "auto",
                resize: "vertical",
                ...(problem ? { borderColor: "var(--danger)" } : {}),
              }}
            />
            {problem && (
              <p id={problemId} role="alert" style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--danger)" }}>
                {problem}
              </p>
            )}
            <p id={helpId} style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
              Recalculated whenever a record is saved, and for all existing records when the formula changes. People can't type into it.
            </p>
          </div>

          {usable.length > 0 && (
            <div>
              <span className="form-label" style={{ fontSize: "var(--font-size-xs)" }}>Insert a field</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", maxHeight: "6.5rem", overflowY: "auto" }}>
                {usable.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title={`${f.label} (${f.type})`}
                    onClick={() => insert(f.name)}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <details>
            <summary style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", cursor: "pointer" }}>What can a formula do?</summary>
            <table style={{ marginTop: "var(--space-2)", fontSize: "var(--font-size-xs)", borderCollapse: "collapse" }}>
              <tbody>
                {FUNCTION_HELP.map((row) => (
                  <tr key={row.example}>
                    <td style={{ padding: "var(--space-1) var(--space-2) var(--space-1) 0", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{row.example}</td>
                    <td style={{ padding: "var(--space-1) 0", color: "var(--text-muted)" }}>{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}
