/** Measuring the drawn canvas: pointer positions, node boxes and coordinate spaces, all in drawing units */
import { snapToIsoGrid } from "@config-platform/schema";
import type { Box } from "./resize";

export interface Pt {
  x: number;
  y: number;
}

/** A pointer position in drawing coordinates */
export function toDrawing(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const m = svg.getScreenCTM();
  if (!m) return { x: clientX, y: clientY };
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export const nodeElement = (svg: SVGSVGElement, id: string) => svg.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`);

/** The box a node covers on screen, in drawing coordinates */
export function nodeBox(svg: SVGSVGElement, id: string): Box | null {
  const el = nodeElement(svg, id);
  const m = svg.getScreenCTM();
  if (!el || !m) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const inv = m.inverse();
  const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
  const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function unionBox(boxes: Array<Box | null>): Box | null {
  const real = boxes.filter((b): b is Box => Boolean(b));
  if (!real.length) return null;
  const x = Math.min(...real.map((b) => b.x));
  const y = Math.min(...real.map((b) => b.y));
  return { x, y, width: Math.max(...real.map((b) => b.x + b.width)) - x, height: Math.max(...real.map((b) => b.y + b.height)) - y };
}

/**
 * Drawing coordinates → the coordinates of a node's parent (a group may be moved, scaled or turned).
 * `id` null: the top level, which is drawing coordinates already.
 */
export function parentSpace(svg: SVGSVGElement, id: string | null): { point: (p: Pt) => Pt; vector: (v: Pt) => Pt } {
  const el = id ? nodeElement(svg, id) : null;
  const parent = el?.parentElement;
  const m = parent instanceof SVGGraphicsElement && !(parent instanceof SVGSVGElement) ? parent.getCTM() : null;
  if (!m) return { point: (p) => p, vector: (v) => v };
  const inv = m.inverse();
  return {
    point: (p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(inv);
      return { x: q.x, y: q.y };
    },
    vector: (v) => {
      const o = new DOMPoint(0, 0).matrixTransform(inv);
      const q = new DOMPoint(v.x, v.y).matrixTransform(inv);
      return { x: q.x - o.x, y: q.y - o.y };
    },
  };
}

/** Coordinates inside an open group's body (where new shapes go); drawing coordinates at the top level */
export function groupSpace(svg: SVGSVGElement, groupId: string | null): (p: Pt) => Pt {
  // The first body inside is the group's own (it comes before its children's in document order)
  const body = groupId ? nodeElement(svg, groupId)?.querySelector<SVGGElement>("g[data-node-body]") : null;
  const lookG = body?.firstElementChild;
  const m = lookG instanceof SVGGraphicsElement ? lookG.getCTM() : null;
  if (!m) return (p) => p;
  const inv = m.inverse();
  return (p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(inv);
    return { x: q.x, y: q.y };
  };
}

const snapTo = (v: number, step: number) => Math.round(v / step) * step;

export function snapPoint(p: Pt, grid: { on: boolean; size: number; isometric: boolean }): Pt {
  if (!grid.on) return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  if (grid.isometric) return snapToIsoGrid(p.x, p.y);
  return { x: snapTo(p.x, grid.size), y: snapTo(p.y, grid.size) };
}

/**
 * Which node a click picks: the top-level one, or inside the open group, or (with Ctrl) the
 * deepest one. Clicks inside a symbol pick the placed symbol. Returns the path top-down.
 */
export function hitPath(target: EventTarget | null): string[] {
  const path: string[] = [];
  let el = target instanceof Element ? target : null;
  while (el && !(el instanceof SVGSVGElement && el.classList.contains("vis-scene"))) {
    if (el.hasAttribute("data-symbol-body")) path.length = 0;
    const id = el.getAttribute("data-node-id");
    if (id) path.unshift(id);
    el = el.parentElement;
  }
  return path;
}
