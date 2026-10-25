/**
 * An element's property values right now: its shape's defaults, then the values set in the editor,
 * then its bindings worked out against live data. A binding that fails or gives the wrong kind of
 * value keeps the set value, and the editor shows why.
 */
import { evaluateRawExpression, type ExpressionScope, type VisualElement } from "@config-platform/schema";
import { SWATCHES, type PropSpec, type ResolvedProps, type ShapeDef } from "./shapes";

export interface ResolvedElement {
  props: ResolvedProps;
  /** Property name → why its binding didn't apply */
  problems: Record<string, string>;
}

function coerce(spec: PropSpec, value: unknown): { ok: true; value: string | number | boolean } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: false, reason: "has no value yet" };
  switch (spec.kind) {
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : Number(String(value).trim());
      if (!Number.isFinite(n) || (typeof value === "string" && !value.trim())) return { ok: false, reason: `"${String(value)}" isn't a number` };
      const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
      return { ok: true, value: clamped };
    }
    case "boolean":
      if (typeof value === "string") return { ok: true, value: !["", "0", "false", "off", "no"].includes(value.trim().toLowerCase()) };
      return { ok: true, value: Boolean(value) };
    case "text":
      return { ok: true, value: typeof value === "object" ? JSON.stringify(value) : String(value) };
    case "swatch": {
      const name = String(value).trim().toLowerCase();
      return (SWATCHES as readonly string[]).includes(name) ? { ok: true, value: name } : { ok: false, reason: `"${String(value)}" isn't one of the colours (${SWATCHES.join(", ")})` };
    }
    case "select": {
      const v = String(value).trim();
      const match = spec.options.find((o) => o.value.toLowerCase() === v.toLowerCase());
      return match ? { ok: true, value: match.value } : { ok: false, reason: `"${v}" isn't one of ${spec.options.map((o) => o.value).join(", ")}` };
    }
  }
}

export function resolveElement(shape: ShapeDef, el: Pick<VisualElement, "props" | "bindings">, scope: ExpressionScope | null): ResolvedElement {
  const props: ResolvedProps = {};
  const problems: Record<string, string> = {};
  for (const spec of shape.props) {
    const set = el.props?.[spec.name];
    const fixed = set === undefined || set === null ? undefined : coerce(spec, set);
    props[spec.name] = fixed?.ok ? fixed.value : spec.default;

    const expr = el.bindings?.[spec.name]?.trim();
    if (!expr || !scope || spec.bindable === false) continue;
    const { value, error } = evaluateRawExpression(expr, scope);
    if (error) {
      problems[spec.name] = error;
      continue;
    }
    const bound = coerce(spec, value);
    if (bound.ok) props[spec.name] = bound.value;
    else problems[spec.name] = `The binding ${bound.reason}`;
  }
  return { props, problems };
}

/** A new element's property values: every shape default, so the saved drawing doesn't change if defaults do */
export function defaultProps(shape: ShapeDef): Record<string, string | number | boolean> {
  return Object.fromEntries(shape.props.map((p) => [p.name, p.default]));
}
