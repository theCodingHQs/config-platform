/**
 * Smart guides, as in other drawing tools: while a shape is moved or resized, its edges and centre
 * snap to the edges and centres of the shapes around it (and of the canvas) when they come close,
 * and lines show what it now lines up with. Resizing also snaps to a neighbour's width or height.
 * Everything is in drawing coordinates, with boxes as drawn on screen.
 */
import type { Box } from "./resize";

/** A line to draw: axis "x" is an upright line at x = at, from y = from to y = to */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** Shapes with the same width (axis "x") or height (axis "y") as the one being resized */
export interface SizeMatch {
  axis: "x" | "y";
  size: number;
  boxes: Box[];
}

export interface Canvas {
  width: number;
  height: number;
}

/** Left, centre, right (or top, middle, bottom) */
const linesX = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
const linesY = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
const LINES = { x: linesX, y: linesY };
const canvasLines = (c: Canvas, axis: "x" | "y") => (axis === "x" ? [0, c.width / 2, c.width] : [0, c.height / 2, c.height]);
const ON = 0.5;

/** The smallest shift that puts one of `own` on one of `lines`, if one is within `threshold` */
function nearest(own: number[], lines: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const o of own) for (const l of lines) {
    const d = l - o;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** The lines showing what `box` lines up with on one axis */
export function guidesFor(box: Box, targets: readonly Box[], canvas: Canvas, axis: "x" | "y", own = LINES[axis](box)): Guide[] {
  const guides: Guide[] = [];
  const across = (b: Box): [number, number] => (axis === "x" ? [b.y, b.y + b.height] : [b.x, b.x + b.width]);
  for (const v of own) {
    if (guides.some((g) => Math.abs(g.at - v) < ON)) continue;
    let [from, to] = across(box);
    let found = false;
    for (const t of targets) {
      if (!LINES[axis](t).some((l) => Math.abs(l - v) < ON)) continue;
      const [a, b] = across(t);
      from = Math.min(from, a);
      to = Math.max(to, b);
      found = true;
    }
    if (canvasLines(canvas, axis).some((l) => Math.abs(l - v) < ON)) {
      from = 0;
      to = axis === "x" ? canvas.height : canvas.width;
      found = true;
    }
    if (found) guides.push({ axis, at: v, from, to });
  }
  return guides;
}

/** Moving: how far to shift a box (dragged to `box`) on each axis so it lines up; null = nothing near */
export function snapMove(box: Box, targets: readonly Box[], canvas: Canvas, threshold: number): { dx: number | null; dy: number | null; guides: Guide[] } {
  const dx = nearest(linesX(box), [...targets.flatMap(linesX), ...canvasLines(canvas, "x")], threshold);
  const dy = nearest(linesY(box), [...targets.flatMap(linesY), ...canvasLines(canvas, "y")], threshold);
  const moved = { ...box, x: box.x + (dx ?? 0), y: box.y + (dy ?? 0) };
  return {
    dx,
    dy,
    guides: [...(dx !== null ? guidesFor(moved, targets, canvas, "x") : []), ...(dy !== null ? guidesFor(moved, targets, canvas, "y") : [])],
  };
}

/**
 * Resizing with `handle` ("e", "nw", …) to `box`: the edges being dragged snap to nearby lines, or
 * failing that the size snaps to a neighbour's. Returns the adjusted box and what to show.
 */
export function snapResize(box: Box, handle: string, targets: readonly Box[], canvas: Canvas, threshold: number): { box: Box; guides: Guide[]; sizes: SizeMatch[] } {
  let { x, y, width, height } = box;
  const guides: Guide[] = [];
  const sizes: SizeMatch[] = [];
  const sides = [
    { axis: "x" as const, low: handle.includes("w"), high: handle.includes("e") },
    { axis: "y" as const, low: handle.includes("n"), high: handle.includes("s") },
  ];
  for (const { axis, low, high } of sides) {
    if (!low && !high) continue;
    const start = axis === "x" ? x : y;
    const size = axis === "x" ? width : height;
    const edge = low ? start : start + size;
    const lines = [...targets.flatMap(LINES[axis]), ...canvasLines(canvas, axis)];
    const shift = nearest([edge], lines, threshold);
    let next = { start, size };
    if (shift !== null) {
      next = low ? { start: start + shift, size: size - shift } : { start, size: size + shift };
    } else {
      // No edge nearby: the same size as a neighbour, if one is close
      const sizeOf = (t: Box) => (axis === "x" ? t.width : t.height);
      const match = targets.map(sizeOf).filter((s) => Math.abs(s - size) <= threshold).sort((a, b) => Math.abs(a - size) - Math.abs(b - size))[0];
      if (match !== undefined && match > 0) {
        next = low ? { start: start + size - match, size: match } : { start, size: match };
        sizes.push({ axis, size: match, boxes: targets.filter((t) => Math.abs(sizeOf(t) - match) < ON) });
      }
    }
    if (axis === "x") [x, width] = [next.start, next.size];
    else [y, height] = [next.start, next.size];
    if (shift !== null) {
      const edgeNow = low ? next.start : next.start + next.size;
      guides.push(...guidesFor({ x, y, width, height }, targets, canvas, axis, [edgeNow]));
    }
  }
  const out = { x, y, width: Math.max(1, width), height: Math.max(1, height) };
  for (const s of sizes) s.boxes = [out, ...s.boxes];
  return { box: out, guides, sizes };
}
