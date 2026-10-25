/** Shorthand for writing drawings in code: shapes, groups and placed symbols with their live settings */
import type { VisualAttrValue, VisualNode, VisualNodeKind } from "@config-platform/schema";

type Attrs = Record<string, VisualAttrValue>;
type Extra = Partial<Pick<VisualNode, "name" | "bindings" | "rules" | "effects" | "smooth" | "locked">>;

export const shape = (kind: Exclude<VisualNodeKind, "group" | "symbol" | "preset">, id: string, attrs: Attrs, extra: Extra = {}): VisualNode => ({ id, kind, attrs, ...extra });

export const group = (id: string, children: VisualNode[], attrs: Attrs = {}, extra: Extra = {}): VisualNode => ({ id, kind: "group", attrs, children, ...extra });

export const symbol = (id: string, ref: string, attrs: Attrs, extra: Extra = {}): VisualNode => ({ id, kind: "symbol", ref, attrs, ...extra });

/** Only shown while a condition holds (a symbol's look, a lamp that appears) */
export const shownWhen = (node: VisualNode, expr: string): VisualNode => ({ ...node, bindings: { ...node.bindings, visible: expr } });

/** A basket of parts: a framed grid, as on the line's tables, furnaces and baths */
export function basket(id: string, x: number, y: number, w: number, h: number, cols = 4, rows = 3): VisualNode {
  const lines: VisualNode[] = [];
  for (let c = 1; c < cols; c++) lines.push(shape("line", `${id}-c${c}`, { x1: (w / cols) * c, y1: 0, x2: (w / cols) * c, y2: h }));
  for (let r = 1; r < rows; r++) lines.push(shape("line", `${id}-r${r}`, { x1: 0, y1: (h / rows) * r, x2: w, y2: (h / rows) * r }));
  return group(id, [shape("rect", `${id}-frame`, { width: w, height: h, rx: 2, fill: "var(--vis-white)", stroke: "var(--vis-dark)", strokeWidth: 1.1 }), group(`${id}-grid`, lines, { stroke: "var(--vis-steel)", strokeWidth: 0.8 })], { x, y }, { name: "Basket" });
}

/** Text at (x, y) in a size (drawing units) */
export const text = (id: string, x: number, y: number, content: string, size: number, attrs: Attrs = {}, extra: Extra = {}): VisualNode =>
  shape("text", id, { x, y, text: content, fontSize: size, ...attrs }, extra);
