/**
 * Rules: "when this is true, change these attributes (and maybe animate)". The everyday way to
 * colour a lamp by status or flash an alarm, without writing an expression for every attribute.
 */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { VISUAL_EFFECTS, type VisualAttrValue, type VisualEffectType, type VisualRule } from "@config-platform/schema";
import type { PropSpec } from "../../visuals/shapes";
import type { ResolvedNode } from "../../visuals/resolve-props";
import { ValueInput } from "./PropField";
import { ExpressionInput } from "../../components/expression-input/ExpressionInput";

interface Props {
  rules: readonly VisualRule[];
  specs: readonly PropSpec[];
  resolved: ResolvedNode | undefined;
  paints: readonly string[];
  onChange: (rules: VisualRule[], group?: string) => void;
}

export const EFFECT_LABELS: Record<VisualEffectType, string> = { blink: "Blink", pulse: "Pulse", spin: "Spin", flow: "Flow (moving dashes)", shake: "Shake" };

const small = { fontSize: "var(--font-size-xs)" } as const;

export function RulesEditor({ rules, specs, resolved, paints, onChange }: Props) {
  const settable = specs.filter((s) => s.bindable !== false);
  const change = (i: number, rule: VisualRule, group?: string) => onChange(rules.map((r, j) => (j === i ? rule : r)), group);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {rules.map((rule, i) => {
        const on = resolved?.rulesOn[i];
        const problem = resolved?.problems[`rule:${i}`];
        const unused = settable.filter((s) => !(s.name in rule.set));
        return (
          <div key={i} style={{ border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)", padding: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <span style={{ ...small, fontWeight: 600 }}>When</span>
              <ExpressionInput
                aria-label={`Rule ${i + 1} condition`}
                placeholder='live.sqf1.status == "alarm"'
                value={rule.when}
                onChange={(v) => change(i, { ...rule, when: v }, `rule-${i}-when`)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="btn btn-ghost" aria-label={`Delete rule ${i + 1}`} title="Delete this rule" style={{ padding: "var(--space-1)", color: "var(--danger)" }} onClick={() => onChange(rules.filter((_, j) => j !== i))}>
                <Trash2 size="1em" />
              </button>
            </div>
            <span style={{ ...small, color: problem ? "var(--warning)" : on ? "var(--success)" : "var(--text-muted)" }}>
              {!rule.when.trim() ? "Type a condition" : problem ? problem : on ? "Applies now" : "Doesn't apply now"}
            </span>
            {Object.entries(rule.set).map(([name, value]) => {
              const spec = specs.find((s) => s.name === name);
              if (!spec) return null;
              return (
                <div key={name} style={{ display: "grid", gridTemplateColumns: "6.5rem minmax(0, 1fr) auto", gap: "var(--space-1)", alignItems: "start" }}>
                  <span style={{ ...small, paddingTop: "var(--space-1)" }}>{spec.label}</span>
                  <ValueInput
                    spec={spec}
                    value={value}
                    id={`rule-${i}-${name}`}
                    paints={paints}
                    onValue={(v) => change(i, { ...rule, set: { ...rule.set, [name]: v as VisualAttrValue } }, `rule-${i}-${name}`)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label={`Stop changing ${spec.label}`}
                    style={{ padding: "var(--space-1)" }}
                    onClick={() => {
                      const set = { ...rule.set };
                      delete set[name];
                      change(i, { ...rule, set });
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
              <select
                className="form-select"
                aria-label={`Rule ${i + 1}: add a change`}
                value=""
                onChange={(e) => {
                  const spec = specs.find((s) => s.name === e.target.value);
                  if (spec) change(i, { ...rule, set: { ...rule.set, [spec.name]: (resolved?.attrs[spec.name] ?? spec.default) as VisualAttrValue } });
                }}
                style={{ flex: 1, ...small }}
              >
                <option value="">Change…</option>
                {unused.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                aria-label={`Rule ${i + 1}: animation`}
                value={rule.effect ?? ""}
                onChange={(e) => change(i, { ...rule, effect: (e.target.value || undefined) as VisualEffectType | undefined })}
                style={{ flex: 1, ...small }}
              >
                <option value="">No animation</option>
                {VISUAL_EFFECTS.map((fx) => (
                  <option key={fx} value={fx}>
                    {EFFECT_LABELS[fx]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", ...small }} onClick={() => onChange([...rules, { when: "", set: {} }])}>
        <Plus size="1em" /> Add a rule
      </button>
    </div>
  );
}
