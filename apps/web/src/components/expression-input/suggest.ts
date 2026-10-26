/**
 * What to suggest while typing an expression: the next part of the name being typed, wherever the
 * cursor is (also inside a function call). "live.area.ma" offers the children of live.area starting
 * with "wa"; a name with no dot offers the top-level names (live, inputs…) and functions.
 */

export interface SuggestEntry {
  /** Full name, e.g. "live.area.machine.speed" */
  path: string;
  /** Shown beside it: label, unit, where it comes from */
  detail?: string;
  /** Its value right now, when known */
  value?: unknown;
}

export interface FunctionDoc {
  name: string;
  /** e.g. "scale(value, from, to, newFrom, newTo)" */
  signature: string;
  detail: string;
}

export interface Suggestion {
  /** The text that replaces the name being typed */
  insert: string;
  label: string;
  detail?: string;
  value?: unknown;
  kind: "group" | "value" | "function";
}

export interface SuggestResult {
  /** Range of the text being replaced */
  start: number;
  end: number;
  items: Suggestion[];
}

const NAME_CHAR = /[A-Za-z0-9_.]/;

/** True when the cursor is inside a "quoted string" (nothing to suggest there) */
function inString(text: string, caret: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < caret; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
  }
  return quote !== null;
}

export function suggest(text: string, caret: number, entries: readonly SuggestEntry[], functions: readonly FunctionDoc[], limit = 50): SuggestResult | null {
  if (inString(text, caret)) return null;
  let start = caret;
  while (start > 0 && NAME_CHAR.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
  const token = text.slice(start, caret);
  // A number like 0.5 isn't a name
  if (/^\d/.test(token)) return null;

  const dot = token.lastIndexOf(".");
  const prefix = dot >= 0 ? token.slice(0, dot + 1) : "";
  const partial = token.slice(dot + 1).toLowerCase();

  const children = new Map<string, Suggestion>();
  for (const e of entries) {
    if (!e.path.startsWith(prefix)) continue;
    const rest = e.path.slice(prefix.length);
    const [segment, ...more] = rest.split(".");
    if (!segment) continue;
    const existing = children.get(segment);
    if (more.length) {
      if (!existing) children.set(segment, { insert: `${prefix}${segment}.`, label: segment, kind: "group" });
    } else {
      children.set(segment, { insert: `${prefix}${segment}`, label: segment, detail: e.detail, value: e.value, kind: "value" });
    }
  }
  let items = [...children.values()];
  if (!prefix) items.push(...functions.map((f): Suggestion => ({ insert: `${f.name}(`, label: f.signature, detail: f.detail, kind: "function" })));

  // Names starting with what's typed first, then names containing it
  const key = (s: Suggestion) => (s.kind === "function" ? s.insert.slice(0, -1) : s.label).toLowerCase();
  const starts = items.filter((s) => key(s).startsWith(partial));
  const contains = partial ? items.filter((s) => !key(s).startsWith(partial) && key(s).includes(partial)) : [];
  items = [...starts.sort((a, b) => kindOrder(a) - kindOrder(b) || key(a).localeCompare(key(b))), ...contains];
  // Nothing more to offer when the name is already complete
  if (items.length === 1 && items[0].insert === token) return null;
  return items.length ? { start, end, items: items.slice(0, limit) } : null;
}

const kindOrder = (s: Suggestion) => (s.kind === "function" ? 1 : 0);

/** Where a value sits in a nested object, e.g. ["area", "machine", "speed"] */
export function valueAt(root: unknown, path: readonly string[]): unknown {
  let at: unknown = root;
  for (const key of path) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** A value shown briefly beside a suggestion */
export function preview(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return `"${v.length > 24 ? `${v.slice(0, 24)}…` : v}"`;
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  if (typeof v === "boolean") return String(v);
  return undefined;
}
