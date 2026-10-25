/**
 * A symbol's inputs: what each placed copy can be given (and bind to its own tags). Inside the
 * symbol, shapes use them as inputs.<name>, e.g. a lamp's rule "inputs.status == 'alarm'".
 */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { RESERVED_ATTRS, type VisualInputDef } from "@config-platform/schema";
import { inputSpecs } from "../../visuals/node-specs";
import { ValueInput } from "./PropField";

const small = { fontSize: "var(--font-size-xs)" } as const;
const TYPES: Array<{ value: VisualInputDef["type"]; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "On / off" },
  { value: "color", label: "Colour" },
];

function problemWith(input: VisualInputDef, all: readonly VisualInputDef[]): string | null {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input.name)) return "Use letters and digits, starting with a letter";
  if (RESERVED_ATTRS.has(input.name)) return "That name is used for position and size";
  if (all.filter((i) => i.name === input.name).length > 1) return "Two inputs have this name";
  return null;
}

export function InputsEditor({ inputs, onChange }: { inputs: readonly VisualInputDef[]; onChange: (inputs: VisualInputDef[], group?: string) => void }) {
  const set = (i: number, next: VisualInputDef, group?: string) => onChange(inputs.map((x, j) => (j === i ? next : x)), group);
  const freeName = () => {
    for (let n = inputs.length + 1; ; n++) if (!inputs.some((i) => i.name === `input${n}`)) return `input${n}`;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <p style={{ margin: 0, ...small, color: "var(--text-muted)" }}>
        Each placed copy gives these its own values or binds them to its own tags. Shapes in the symbol use them as <code>inputs.name</code>.
      </p>
      {inputs.map((input, i) => {
        const problem = problemWith(input, inputs);
        const spec = inputSpecs([input])[0];
        return (
          <div key={i} style={{ border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)", padding: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              <input
                className="form-input"
                aria-label={`Input ${i + 1} name`}
                value={input.name}
                onChange={(e) => set(i, { ...input, name: e.target.value.replace(/\s+/g, "") }, `input-${i}-name`)}
                style={{ flex: 1, fontFamily: "var(--font-mono)", ...small }}
              />
              <select
                className="form-select"
                aria-label={`Input ${i + 1} kind`}
                value={input.type}
                onChange={(e) => set(i, { ...input, type: e.target.value as VisualInputDef["type"], default: undefined })}
                style={{ width: "7rem", ...small }}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost" aria-label={`Delete input ${input.name}`} style={{ padding: "var(--space-1)", color: "var(--danger)" }} onClick={() => onChange(inputs.filter((_, j) => j !== i))}>
                <Trash2 size="1em" />
              </button>
            </div>
            <input className="form-input" aria-label={`Input ${i + 1} label`} placeholder="Label shown when placing it (optional)" value={input.label ?? ""} onChange={(e) => set(i, { ...input, label: e.target.value || undefined }, `input-${i}-label`)} style={small} />
            <span style={small}>Starts as</span>
            <ValueInput spec={spec} value={input.default} id={`input-${i}-default`} paints={[]} onValue={(v) => set(i, { ...input, default: v }, `input-${i}-default`)} />
            {problem && <span style={{ ...small, color: "var(--danger)" }}>{problem}</span>}
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", ...small }} onClick={() => onChange([...inputs, { name: freeName(), type: "text", default: "" }])}>
        <Plus size="1em" /> Add an input
      </button>
    </div>
  );
}

/** What a symbol's inputs are while editing it: their starting values */
export const inputDefaults = (inputs: readonly VisualInputDef[] = []) => Object.fromEntries(inputSpecs(inputs).map((s) => [s.name, s.default]));
