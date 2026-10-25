/** Lining up selected shapes by their boxes, or spacing them evenly; returns how far to move each one */
import type { Box } from "./resize";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom" | "spread-x" | "spread-y";

export function alignMoves(items: ReadonlyArray<{ id: string; box: Box }>, mode: AlignMode): Map<string, { dx: number; dy: number }> {
  const moves = new Map<string, { dx: number; dy: number }>();
  if (items.length < 2) return moves;
  const left = Math.min(...items.map((i) => i.box.x));
  const right = Math.max(...items.map((i) => i.box.x + i.box.width));
  const top = Math.min(...items.map((i) => i.box.y));
  const bottom = Math.max(...items.map((i) => i.box.y + i.box.height));
  const to = (id: string, dx: number, dy: number) => (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) && moves.set(id, { dx, dy });

  if (mode === "spread-x" || mode === "spread-y") {
    // Equal gaps between neighbours; the outermost two stay where they are
    const horizontal = mode === "spread-x";
    const sorted = [...items].sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
    const total = sorted.reduce((sum, i) => sum + (horizontal ? i.box.width : i.box.height), 0);
    const gap = ((horizontal ? right - left : bottom - top) - total) / (sorted.length - 1);
    let at = horizontal ? left : top;
    for (const i of sorted) {
      if (horizontal) to(i.id, at - i.box.x, 0);
      else to(i.id, 0, at - i.box.y);
      at += (horizontal ? i.box.width : i.box.height) + gap;
    }
    return moves;
  }
  for (const { id, box } of items) {
    if (mode === "left") to(id, left - box.x, 0);
    if (mode === "right") to(id, right - box.x - box.width, 0);
    if (mode === "center") to(id, (left + right) / 2 - box.x - box.width / 2, 0);
    if (mode === "top") to(id, 0, top - box.y);
    if (mode === "bottom") to(id, 0, bottom - box.y - box.height);
    if (mode === "middle") to(id, 0, (top + bottom) / 2 - box.y - box.height / 2);
  }
  return moves;
}
