/** Turning a set or bound value into what a property accepts, with a readable reason when it can't */
import { SWATCHES, type PropSpec } from "./shapes/shape-types";

export type Coerced = { ok: true; value: string | number | boolean } | { ok: false; reason: string };

/**
 * Colours as SVG accepts them, limited so a drawing can't load anything from elsewhere: names,
 * #hex, rgb()/hsl(), var(--token), color-mix(), and gradients of this drawing (url(#id)).
 */
export function safeColor(value: string): string | null {
  const v = value.trim();
  if (v === "" || v === "none" || v === "transparent" || v === "currentColor") return v;
  if (/^url\(#[a-zA-Z][a-zA-Z0-9_-]*\)$/.test(v)) return v;
  if (/^[#a-zA-Z0-9(),.%\s+-]+$/.test(v) && !/url\s*\(/i.test(v)) return v;
  return null;
}

/** Links an image may load from: https, or an image embedded in the drawing */
export const safeImageHref = (v: string) => /^(https:\/\/|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,)/i.test(v.trim());

export function coerce(spec: PropSpec, value: unknown): Coerced {
  if (value === undefined || value === null) return { ok: false, reason: "has no value yet" };
  switch (spec.kind) {
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : Number(String(value).trim());
      if (!Number.isFinite(n) || (typeof value === "string" && !value.trim())) return { ok: false, reason: `"${String(value)}" isn't a number` };
      return { ok: true, value: Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n)) };
    }
    case "boolean":
      if (typeof value === "string") return { ok: true, value: !["", "0", "false", "off", "no"].includes(value.trim().toLowerCase()) };
      return { ok: true, value: Boolean(value) };
    case "text":
    case "code":
      return { ok: true, value: typeof value === "object" ? JSON.stringify(value) : String(value) };
    case "color": {
      const c = safeColor(String(value));
      return c === null ? { ok: false, reason: `"${String(value)}" isn't a colour` } : { ok: true, value: c };
    }
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
