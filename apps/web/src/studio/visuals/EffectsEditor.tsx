/** Animations a node runs always, or while a condition holds; and gliding to new values */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { VISUAL_EFFECTS, type VisualEffect, type VisualEffectType } from "@config-platform/schema";
import type { ResolvedNode } from "../../visuals/resolve-props";
import { EFFECT_LABELS } from "./RulesEditor";
import { Field } from "../live/Field";
import { ExpressionInput } from "../../components/expression-input/ExpressionInput";

interface Props {
  effects: readonly VisualEffect[];
  smooth: number | undefined;
  resolved: ResolvedNode | undefined;
  onEffects: (effects: VisualEffect[], group?: string) => void;
  onSmooth: (ms: number | undefined) => void;
}

const small = { fontSize: "var(--font-size-xs)" } as const;

export function EffectsEditor({ effects, smooth, resolved, onEffects, onSmooth }: Props) {
  const change = (i: number, fx: VisualEffect, group?: string) => onEffects(effects.map((e, j) => (j === i ? fx : e)), group);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {effects.map((fx, i) => {
        const problem = resolved?.problems[`effect:${i}`];
        const running = resolved?.effects.some((a) => a.type === fx.type);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)", padding: "var(--space-2)" }}>
            <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
              <select className="form-select" aria-label={`Animation ${i + 1}`} value={fx.type} onChange={(e) => change(i, { ...fx, type: e.target.value as VisualEffectType })} style={{ flex: 1, ...small }}>
                {VISUAL_EFFECTS.map((t) => (
                  <option key={t} value={t}>
                    {EFFECT_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                className="form-input"
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                aria-label={`Animation ${i + 1} speed`}
                title="Speed (1 = normal)"
                value={fx.speed ?? 1}
                onChange={(e) => e.target.value && change(i, { ...fx, speed: Math.min(20, Math.max(0.05, Number(e.target.value))) }, `fx-${i}-speed`)}
                style={{ width: "4.5rem", ...small }}
              />
              <button type="button" className="btn btn-ghost" aria-label={`Delete animation ${i + 1}`} style={{ padding: "var(--space-1)", color: "var(--danger)" }} onClick={() => onEffects(effects.filter((_, j) => j !== i))}>
                <Trash2 size="1em" />
              </button>
            </div>
            <ExpressionInput
              aria-label={`Animation ${i + 1} runs while`}
              placeholder="Always, or while… e.g. live.fan1.running"
              value={fx.when ?? ""}
              onChange={(v) => change(i, { ...fx, when: v || undefined }, `fx-${i}-when`)}
            />
            <span style={{ ...small, color: problem ? "var(--warning)" : "var(--text-muted)" }}>{problem ?? (running ? "Running now" : "Not running now")}</span>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", ...small }} onClick={() => onEffects([...effects, { type: "blink" }])}>
        <Plus size="1em" /> Add an animation
      </button>
      <Field label="Glide to new values" htmlFor="vis-smooth" hint="Moves and resizes smoothly when live values change, e.g. a cart along its rail (milliseconds; 0 = jump)">
        <input id="vis-smooth" className="form-input" type="number" min={0} max={10000} step={50} value={smooth ?? 0} onChange={(e) => onSmooth(Number(e.target.value) > 0 ? Math.min(10000, Math.round(Number(e.target.value))) : undefined)} />
      </Field>
    </div>
  );
}
