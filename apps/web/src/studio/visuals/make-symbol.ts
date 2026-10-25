/**
 * Turning selected shapes into a symbol: the shapes move onto the symbol's own small canvas
 * (keeping how they look), and a copy of the new symbol takes their place in the drawing.
 */
import { emptyVisualDefinition, type VisualDefinition, type VisualNode } from "@config-platform/schema";
import type { Box } from "./resize";

const PAD = 4;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * `box` is where the shapes sit, in the coordinates of their parent. The gradients they use are
 * copied into the symbol so it looks the same.
 */
export function symbolFromNodes(nodes: readonly VisualNode[], box: Box, from: VisualDefinition): { definition: VisualDefinition; at: { x: number; y: number } } {
  const dx = PAD - box.x;
  const dy = PAD - box.y;
  const moved = nodes.map((n) => ({ ...n, attrs: { ...n.attrs, x: Math.round((num(n.attrs.x) + dx) * 100) / 100, y: Math.round((num(n.attrs.y) + dy) * 100) / 100 } }));
  const used = JSON.stringify(nodes);
  const paints = (from.paints ?? []).filter((p) => used.includes(`url(#${p.id})`));
  return {
    definition: {
      ...emptyVisualDefinition("flat"),
      width: Math.max(20, Math.ceil(box.width + PAD * 2)),
      height: Math.max(20, Math.ceil(box.height + PAD * 2)),
      grid: from.grid,
      gridSize: from.gridSize,
      ...(paints.length ? { paints } : {}),
      inputs: [],
      nodes: moved,
    },
    at: { x: Math.round((box.x - PAD) * 100) / 100, y: Math.round((box.y - PAD) * 100) / 100 },
  };
}
