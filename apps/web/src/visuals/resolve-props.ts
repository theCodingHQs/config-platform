/**
 * A node's attributes right now: the defaults, then the values set in the editor, then the rules
 * whose condition holds (in order), then the bindings, all worked out against live data. A binding
 * or rule that fails, or gives the wrong kind of value, is skipped and the editor shows why.
 */
import { evaluateRawExpression, type ExpressionScope, type VisualEffectType, type VisualNode } from "@config-platform/schema";
import type { PropSpec, ResolvedProps, ShapeDef } from "./shapes";
import { coerce } from "./coerce";
import { VISUAL_FUNCTIONS } from "./visual-functions";

export interface ActiveEffect {
  type: VisualEffectType;
  speed: number;
}

export interface ResolvedNode {
  attrs: ResolvedProps;
  /** Attribute name, "rule:<n>" or "effect:<n>" → why it didn't apply */
  problems: Record<string, string>;
  /** Whether each rule applies right now */
  rulesOn: boolean[];
  effects: ActiveEffect[];
}

export const evaluate = (expr: string, scope: ExpressionScope) => evaluateRawExpression(expr, scope, VISUAL_FUNCTIONS);

const truthy = (v: unknown) => (typeof v === "string" ? !["", "0", "false", "off", "no"].includes(v.trim().toLowerCase()) : Boolean(v));

/** Whether a condition holds; null when it can't be worked out (with the reason) */
function condition(expr: string, scope: ExpressionScope): { on: boolean; error?: string } {
  const { value, error } = evaluate(expr, scope);
  if (error) return { on: false, error };
  return { on: truthy(value) };
}

type NodeLike = Pick<VisualNode, "attrs" | "bindings" | "rules" | "effects">;

function applyRules(node: NodeLike, byName: Map<string, PropSpec>, scope: ExpressionScope | null, out: ResolvedNode): void {
  out.rulesOn = (node.rules ?? []).map((rule, i) => {
    if (!scope || !rule.when.trim()) return false;
    const { on, error } = condition(rule.when, scope);
    if (error) out.problems[`rule:${i}`] = error;
    if (!on) return false;
    for (const [name, value] of Object.entries(rule.set)) {
      const spec = byName.get(name);
      const c = spec && coerce(spec, value);
      if (c?.ok) out.attrs[name] = c.value;
      else if (c) out.problems[`rule:${i}`] = `${spec.label} ${c.reason}`;
    }
    if (rule.effect) out.effects.push({ type: rule.effect, speed: 1 });
    return true;
  });
}

function applyBindings(node: NodeLike, byName: Map<string, PropSpec>, scope: ExpressionScope, out: ResolvedNode): void {
  for (const [name, raw] of Object.entries(node.bindings ?? {})) {
    const spec = byName.get(name);
    const expr = raw.trim();
    if (!spec || !expr || spec.bindable === false) continue;
    const { value, error } = evaluate(expr, scope);
    if (error) {
      out.problems[name] = error;
      continue;
    }
    const bound = coerce(spec, value);
    if (bound.ok) out.attrs[name] = bound.value;
    else out.problems[name] = `The binding ${bound.reason}`;
  }
}

function applyEffects(node: NodeLike, scope: ExpressionScope | null, out: ResolvedNode): void {
  (node.effects ?? []).forEach((effect, i) => {
    const when = effect.when?.trim();
    if (!when) return out.effects.push({ type: effect.type, speed: effect.speed ?? 1 });
    if (!scope) return;
    const { on, error } = condition(when, scope);
    if (error) out.problems[`effect:${i}`] = error;
    if (on) out.effects.push({ type: effect.type, speed: effect.speed ?? 1 });
  });
}

/** `scope` null: the set values only (thumbnails, and the editor without live data) */
export function resolveNode(node: NodeLike, specs: readonly PropSpec[], scope: ExpressionScope | null): ResolvedNode {
  const out: ResolvedNode = { attrs: {}, problems: {}, rulesOn: [], effects: [] };
  const byName = new Map(specs.map((s) => [s.name, s]));
  for (const spec of specs) {
    const set = node.attrs?.[spec.name];
    const fixed = set === undefined || set === null ? undefined : coerce(spec, set);
    out.attrs[spec.name] = fixed?.ok ? fixed.value : spec.default;
  }
  applyRules(node, byName, scope, out);
  if (scope) applyBindings(node, byName, scope, out);
  applyEffects(node, scope, out);
  return out;
}

/** A new part's property values: every default, so the saved drawing doesn't change if defaults do */
export function defaultProps(shape: ShapeDef): Record<string, string | number | boolean> {
  return Object.fromEntries(shape.props.map((p) => [p.name, p.default]));
}
