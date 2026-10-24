import React from "react";
import { Plus, X } from "lucide-react";
import type { TagRule } from "@config-platform/schema";

const cell: React.CSSProperties = { padding: "var(--space-1)", verticalAlign: "top" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" };

/**
 * One row per tag: its name (used in pages as {{ live.<name> }}), where its value is in the
 * message, and optionally which messages it applies to.
 */
export function TagRulesEditor({
  rules,
  onChange,
  showTopic,
  onAdd,
  disabled,
}: {
  rules: TagRule[];
  onChange: (rules: TagRule[]) => void;
  /** MQTT: rules can be limited to a topic */
  showTopic: boolean;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<TagRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {rules.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
          No tags yet. Add one, or pick a value from <strong>Recent messages</strong>.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-size-sm)" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>
                <th style={cell}>Tag name</th>
                <th style={cell}>Value</th>
                <th style={cell}>Only when (optional)</th>
                {showTopic && <th style={cell}>Topic (optional)</th>}
                <th style={cell}>Type</th>
                <th style={cell}>Unit</th>
                <th style={cell} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td style={cell}>
                    <input className="form-input" style={mono} aria-label="Tag name" value={r.tag} onChange={(e) => set(i, { tag: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input className="form-input" style={mono} aria-label="Value" placeholder={i === 0 ? "message.speed" : ""} value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input className="form-input" style={mono} aria-label="Only when" placeholder={i === 0 ? 'e.g. message.machine == "P-04"' : ""} value={r.when ?? ""} onChange={(e) => set(i, { when: e.target.value })} />
                  </td>
                  {showTopic && (
                    <td style={cell}>
                      <input className="form-input" style={mono} aria-label="Topic" placeholder={i === 0 ? "e.g. factory/line1/speed" : ""} value={r.topic ?? ""} onChange={(e) => set(i, { topic: e.target.value })} />
                    </td>
                  )}
                  <td style={cell}>
                    <select className="form-select" aria-label="Type" value={r.type} onChange={(e) => set(i, { type: e.target.value as TagRule["type"] })}>
                      <option value="number">Number</option>
                      <option value="text">Text</option>
                      <option value="boolean">Yes/No</option>
                    </select>
                  </td>
                  <td style={cell}>
                    <input className="form-input" aria-label="Unit" placeholder={i === 0 ? "e.g. pcs/min" : ""} style={{ maxWidth: "6rem" }} value={r.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove ${r.tag}`} onClick={() => onChange(rules.filter((_, j) => j !== i))}>
                      <X size="1em" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAdd}>
          <Plus size="1em" /> Add tag
        </button>
      </div>
    </fieldset>
  );
}
