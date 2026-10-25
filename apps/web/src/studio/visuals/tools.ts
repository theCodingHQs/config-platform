/** The drawing tools and how each new shape is built from the pointer gesture */
import { MousePointer2, Square, Circle, Minus, Spline, Hexagon, PenTool, Type, Image, type LucideIcon } from "lucide-react";
import type { VisualNode, VisualNodeKind } from "@config-platform/schema";
import { startingAttrs } from "../../visuals/node-specs";
import type { Pt } from "./canvas-geometry";

export type ToolId = "select" | "rect" | "ellipse" | "line" | "polyline" | "polygon" | "path" | "text" | "image";

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: LucideIcon;
  /** drag: press and drag out the shape; points: click each point, double-click (or Enter) to finish; click: one click places it */
  gesture: "none" | "drag" | "points" | "click";
  hint: string;
}

export const TOOLS: readonly ToolDef[] = [
  { id: "select", label: "Select", key: "v", icon: MousePointer2, gesture: "none", hint: "Click to select, drag to move; Shift adds to the selection; double-click a group to work inside it" },
  { id: "rect", label: "Rectangle", key: "r", icon: Square, gesture: "drag", hint: "Drag to draw; Shift for a square" },
  { id: "ellipse", label: "Ellipse", key: "o", icon: Circle, gesture: "drag", hint: "Drag to draw; Shift for a circle" },
  { id: "line", label: "Line", key: "l", icon: Minus, gesture: "drag", hint: "Drag to draw; Shift keeps it at 45° steps" },
  { id: "polyline", label: "Polyline", key: "y", icon: Spline, gesture: "points", hint: "Click each point; double-click or Enter to finish, Esc to cancel" },
  { id: "polygon", label: "Polygon", key: "g", icon: Hexagon, gesture: "points", hint: "Click each corner; double-click or Enter to close it" },
  { id: "path", label: "Pen", key: "p", icon: PenTool, gesture: "points", hint: "Click for corners, drag for curves; click the first point or press Enter to finish" },
  { id: "text", label: "Text", key: "t", icon: Type, gesture: "click", hint: "Click where the text goes" },
  { id: "image", label: "Picture", key: "i", icon: Image, gesture: "click", hint: "Click where the picture goes, then paste its link on the right" },
];

export const toolOf = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function makeNode(kind: VisualNodeKind, id: string, attrs: Record<string, string | number | boolean>): VisualNode {
  return { id, kind, attrs: { ...startingAttrs(kind), ...attrs } };
}

/** Holding Shift: lines snap to 45° steps, boxes become squares */
function constrain(p0: Pt, p1: Pt, kind: "line" | "box"): Pt {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  if (kind === "box") {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: p0.x + Math.sign(dx || 1) * s, y: p0.y + Math.sign(dy || 1) * s };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: p0.x + Math.cos(angle) * len, y: p0.y + Math.sin(angle) * len };
}

/** The attributes of a dragged-out shape; null when the drag was too small (a click: use the default size) */
export function dragAttrs(tool: "rect" | "ellipse" | "line", p0: Pt, raw: Pt, shift: boolean): Record<string, number> | null {
  const p1 = shift ? constrain(p0, raw, tool === "line" ? "line" : "box") : raw;
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  if (w < 3 && h < 3) return null;
  if (tool === "line") return { x: r1(p0.x), y: r1(p0.y), x1: 0, y1: 0, x2: r1(p1.x - p0.x), y2: r1(p1.y - p0.y) };
  if (tool === "ellipse") return { x: r1((p0.x + p1.x) / 2), y: r1((p0.y + p1.y) / 2), rx: r1(w / 2), ry: r1(h / 2) };
  return { x: r1(Math.min(p0.x, p1.x)), y: r1(Math.min(p0.y, p1.y)), width: r1(w), height: r1(h) };
}

/** A click with a drag tool: the shape at its default size, placed at the point (an ellipse centred on it) */
export const clickAttrs = (p: Pt): Record<string, number> => ({ x: r1(p.x), y: r1(p.y) });

/** Points relative to the first one, which becomes the shape's position */
export function pointsAttrs(points: Pt[]): { x: number; y: number; points: string } {
  const [o] = points;
  return { x: r1(o.x), y: r1(o.y), points: points.map((p) => `${r1(p.x - o.x)},${r1(p.y - o.y)}`).join(" ") };
}

export interface PenAnchor {
  p: Pt;
  /** Where the outgoing curve handle points (the incoming one is its mirror); none = a corner */
  h?: Pt;
}

/** Path data for pen anchors, relative to the first anchor */
export function penAttrs(anchors: PenAnchor[], closed: boolean): { x: number; y: number; d: string } {
  const o = anchors[0].p;
  const rel = (p: Pt) => `${r1(p.x - o.x)} ${r1(p.y - o.y)}`;
  const mirror = (a: PenAnchor) => (a.h ? { x: 2 * a.p.x - a.h.x, y: 2 * a.p.y - a.h.y } : a.p);
  const seg = (from: PenAnchor, to: PenAnchor) => (from.h || to.h ? `C${rel(from.h ?? from.p)} ${rel(mirror(to))} ${rel(to.p)}` : `L${rel(to.p)}`);
  let d = `M${rel(o)}`;
  for (let i = 1; i < anchors.length; i++) d += ` ${seg(anchors[i - 1], anchors[i])}`;
  if (closed) d += ` ${anchors.length > 1 ? seg(anchors[anchors.length - 1], anchors[0]) : ""} Z`;
  return { x: r1(o.x), y: r1(o.y), d: d.replace(/\s+/g, " ").trim() };
}
