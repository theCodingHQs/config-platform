import React from "react";
import { Plus, X } from "lucide-react";
import type { ConnectionDraft, SignalDraft } from "../connection-draft";
import { Field } from "../Field";

type Settings = ConnectionDraft["simulator"];

const PATTERNS: Record<SignalDraft["pattern"], string> = {
  wave: "Wave between min and max",
  random: "Wanders between min and max",
  counter: "Counts up",
  cycle: "Cycles through values",
};

const cell: React.CSSProperties = { padding: "var(--space-1)", verticalAlign: "top" };

export function SimulatorSettingsFields({ value, onChange, disabled }: { value: Settings; onChange: (next: Settings) => void; disabled?: boolean }) {
  const setSignal = (i: number, patch: Partial<SignalDraft>) => onChange({ ...value, signals: value.signals.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const num = (text: string) => (text.trim() === "" ? 0 : Number(text));

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <Field label="A message every" htmlFor="lc-sim-interval" hint="In milliseconds: 1000 = once a second">
        <input id="lc-sim-interval" type="number" min={100} step={100} className="form-input" style={{ maxWidth: "10rem" }} value={value.intervalMs} onChange={(e) => onChange({ ...value, intervalMs: num(e.target.value) })} />
      </Field>
      <Field label="Signals" hint='Each message looks like {"speed": 41.2, "status": "running", "count": 1532}: use message.speed in tag rules.'>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--font-size-sm)", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>
                <th style={cell}>Key</th>
                <th style={cell}>Behaviour</th>
                <th style={cell}>Min / start</th>
                <th style={cell}>Max</th>
                <th style={cell}>Seconds / step</th>
                <th style={cell}>Values (cycle)</th>
                <th style={cell} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {value.signals.map((s, i) => (
                <tr key={i}>
                  <td style={cell}><input className="form-input" aria-label="Key" value={s.key} onChange={(e) => setSignal(i, { key: e.target.value })} /></td>
                  <td style={cell}>
                    <select className="form-select" aria-label="Behaviour" value={s.pattern} onChange={(e) => setSignal(i, { pattern: e.target.value as SignalDraft["pattern"] })}>
                      {Object.entries(PATTERNS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </td>
                  <td style={cell}><input type="number" className="form-input" aria-label="Min" value={s.pattern === "cycle" ? "" : s.min} placeholder="—" disabled={s.pattern === "cycle"} onChange={(e) => setSignal(i, { min: num(e.target.value) })} /></td>
                  <td style={cell}><input type="number" className="form-input" aria-label="Max" value={s.pattern === "counter" || s.pattern === "cycle" ? "" : s.max} placeholder="—" disabled={s.pattern === "counter" || s.pattern === "cycle"} onChange={(e) => setSignal(i, { max: num(e.target.value) })} /></td>
                  <td style={cell}><input type="number" className="form-input" aria-label="Seconds or step" value={s.period} onChange={(e) => setSignal(i, { period: num(e.target.value) })} /></td>
                  <td style={cell}>
                    <input className="form-input" aria-label="Values" placeholder={s.pattern === "cycle" ? "running, stopped" : "—"} value={s.pattern === "cycle" ? s.values : ""} disabled={s.pattern !== "cycle"} onChange={(e) => setSignal(i, { values: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove ${s.key}`} onClick={() => onChange({ ...value, signals: value.signals.filter((_, j) => j !== i) })}>
                      <X size="1em" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onChange({ ...value, signals: [...value.signals, { key: `signal_${value.signals.length + 1}`, pattern: "random", min: 0, max: 100, period: 10, values: "" }] })}
          >
            <Plus size="1em" /> Add signal
          </button>
        </div>
      </Field>
    </fieldset>
  );
}
