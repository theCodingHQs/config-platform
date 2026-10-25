/**
 * For a node set to follow a path: where along that path it is now (its "How far along" %), in
 * the node's own parent coordinates, and which way the path heads there. Measured from the drawn
 * path, so any line, polyline, polygon or path works, wherever it sits in the drawing.
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { PathPoint } from "./node-transform";

const GEOMETRY = "path, polyline, polygon, line, rect, ellipse";

export function usePathPoint(ref: RefObject<SVGGElement | null>, targetId: string | undefined, progress: number): PathPoint | null {
  const [point, setPoint] = useState<PathPoint | null>(null);
  useLayoutEffect(() => {
    const g = ref.current;
    const svg = g?.ownerSVGElement;
    const target = targetId && svg ? svg.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`) : null;
    const shape = target?.querySelector<SVGGeometryElement>(GEOMETRY);
    const parent = g?.parentElement;
    if (!g || !shape || typeof shape.getTotalLength !== "function" || !(parent instanceof SVGGraphicsElement)) {
      setPoint((cur) => (cur === null ? cur : null));
      return;
    }
    const length = shape.getTotalLength();
    const at = (Math.min(100, Math.max(0, progress)) / 100) * length;
    // Path coordinates → drawing → this node's parent: inverse(parent CTM) · path CTM
    const parentCtm = parent.getCTM();
    const shapeCtm = shape.getCTM();
    if (!parentCtm || !shapeCtm) return;
    const m = parentCtm.inverse().multiply(shapeCtm);
    const p = shape.getPointAtLength(at).matrixTransform(m);
    const ahead = shape.getPointAtLength(Math.min(length, at + 1)).matrixTransform(m);
    const behind = shape.getPointAtLength(Math.max(0, at - 1)).matrixTransform(m);
    const next = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, angle: (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI };
    setPoint((cur) => (cur && Math.abs(cur.x - next.x) < 0.01 && Math.abs(cur.y - next.y) < 0.01 && Math.abs(cur.angle - next.angle) < 0.05 ? cur : next));
  });
  return targetId ? point : null;
}
