/**
 * Resizing a node with the selection handles: from the box it fills now to a new box (both in its
 * parent's coordinates). Plain shapes change their own size and points, so outlines keep their
 * width; groups, parts, symbols and turned shapes are scaled instead.
 */
import type { VisualNode } from "@config-platform/schema";
import { resolveNode } from "../../visuals/resolve-props";
import { specsFor } from "../../visuals/node-specs";
import type { NodePatch } from "./node-tree";
import { scalePath, scalePoints } from "./path-scale";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Where the pivot sits in its box, as fractions; null = the node's own anchor point */
const PIVOT_AT: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};

export function resizePatch(node: VisualNode, from: Box, to: Box, isometric: boolean): NodePatch {
  const a = resolveNode(node, specsFor(node), null).attrs;
  const fx = from.width > 0.01 ? to.width / from.width : 1;
  const fy = from.height > 0.01 ? to.height / from.height : 1;
  const x = num(a.x);
  const y = num(a.y);
  const moved = { x: r2(to.x + (x - from.x) * fx), y: r2(to.y + (y - from.y) * fy) };
  const plain = num(a.rotate) === 0 && num(a.scaleX, 1) === 1 && num(a.scaleY, 1) === 1 && (!isometric || a.plane === "screen" || a.plane === undefined);

  if (plain) {
    switch (node.kind) {
      case "rect":
      case "image":
        return { attrs: { ...moved, width: r2(num(a.width) * fx), height: r2(num(a.height) * fy) } };
      case "ellipse":
        return { attrs: { ...moved, rx: r2(num(a.rx) * fx), ry: r2(num(a.ry) * fy) } };
      case "line":
        return { attrs: { ...moved, x1: r2(num(a.x1) * fx), y1: r2(num(a.y1) * fy), x2: r2(num(a.x2) * fx), y2: r2(num(a.y2) * fy) } };
      case "polyline":
      case "polygon":
        return { attrs: { ...moved, points: scalePoints(String(a.points), fx, fy) } };
      case "path":
        return { attrs: { ...moved, d: scalePath(String(a.d), fx, fy) } };
      case "text":
        return { attrs: { ...moved, fontSize: r2(Math.max(1, num(a.fontSize, 14) * fy)) } };
    }
  }

  const scale = { scaleX: r2(num(a.scaleX, 1) * fx), scaleY: r2(num(a.scaleY, 1) * fy) };
  const at = PIVOT_AT[String(a.pivot)];
  if (!at) return { attrs: { ...moved, ...scale } };
  // Scaling happens around the pivot, so move by however far the pivot itself has to go
  const dx = to.x + at[0] * to.width - (from.x + at[0] * from.width);
  const dy = to.y + at[1] * to.height - (from.y + at[1] * from.height);
  return { attrs: { x: r2(x + dx), y: r2(y + dy), ...scale } };
}

/** The box a handle drag gives: `handle` is which edges move (e.g. "nw", "e"); Shift keeps the shape, Alt resizes from the centre */
export function dragBox(start: Box, handle: string, dx: number, dy: number, keepRatio: boolean, fromCentre: boolean): Box {
  let { x, y, width, height } = start;
  const k = fromCentre ? 2 : 1;
  if (handle.includes("e")) width += dx * k;
  if (handle.includes("w")) {
    width -= dx * k;
    x += dx;
  }
  if (handle.includes("s")) height += dy * k;
  if (handle.includes("n")) {
    height -= dy * k;
    y += dy;
  }
  if (keepRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const byWidth = handle.length === 2 ? Math.abs(width / start.width) > Math.abs(height / start.height) : handle === "e" || handle === "w";
    if (byWidth) {
      const h = width / ratio;
      if (handle.includes("n")) y += height - h;
      height = h;
    } else {
      const w = height * ratio;
      if (handle.includes("w")) x += width - w;
      width = w;
    }
  }
  if (fromCentre) {
    x = start.x + (start.width - width) / 2;
    y = start.y + (start.height - height) / 2;
  }
  // Dragging past the opposite edge flips the box round
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}
