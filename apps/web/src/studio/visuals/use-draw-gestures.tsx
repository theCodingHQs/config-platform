/**
 * Drawing new shapes: drag out rectangles, ellipses and lines; click point by point for polylines,
 * polygons and pen paths; click once for text and pictures. New shapes go into the open group.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasCtx } from "./canvas-context";
import { groupSpace, snapPoint, toDrawing, type Pt } from "./canvas-geometry";
import { allIds, nextId } from "./node-tree";
import { clickAttrs, dragAttrs, makeNode, penAttrs, pointsAttrs, toolOf, type PenAnchor, type ToolId } from "./tools";

type Draft = { kind: "drag"; p0: Pt; p1: Pt; shift: boolean } | { kind: "points"; anchors: PenAnchor[]; hover: Pt | null; pressed: boolean };

const MIN_POINTS: Partial<Record<ToolId, number>> = { polyline: 2, polygon: 3, path: 2 };

export function useDrawGestures(ctxRef: React.MutableRefObject<CanvasCtx>, tool: ToolId, onDone: () => void) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const point = (e: { clientX: number; clientY: number; altKey: boolean }): Pt | null => {
    const { svg, grid } = ctxRef.current;
    if (!svg) return null;
    return snapPoint(toDrawing(svg, e.clientX, e.clientY), { ...grid, on: grid.on && !e.altKey, isometric: false });
  };

  /** Adds the finished shape (points in drawing coordinates are moved into the open group) */
  const create = useCallback(
    (attrs: (local: (p: Pt) => Pt) => Record<string, string | number>) => {
      const { svg, state, dispatch } = ctxRef.current;
      if (!svg) return;
      const local = groupSpace(svg, state.openGroup);
      const kind = tool === "select" ? "rect" : tool;
      dispatch({ type: "add", nodes: [makeNode(kind, nextId(allIds(state.definition.nodes), kind), attrs(local))] });
      setDraft(null);
      onDone();
    },
    [ctxRef, tool, onDone],
  );

  const finishPoints = useCallback(
    (closed: boolean) => {
      const d = draftRef.current;
      if (d?.kind !== "points") return;
      const anchors = d.anchors.filter((a, i) => i === 0 || Math.hypot(a.p.x - d.anchors[i - 1].p.x, a.p.y - d.anchors[i - 1].p.y) > 0.5);
      if (anchors.length < (MIN_POINTS[tool] ?? 2)) return setDraft(null);
      create((local) => {
        const moved = anchors.map((a) => ({ p: local(a.p), h: a.h && local(a.h) }));
        // An open pen curve is a line, not a filled shape
        if (tool === "path") return { ...penAttrs(moved, closed), ...(closed ? {} : { fill: "none" }) };
        return pointsAttrs(moved.map((a) => a.p));
      });
    },
    [create, tool],
  );

  // Enter finishes a shape drawn point by point, Escape drops it
  useEffect(() => {
    if (toolOf(tool).gesture !== "points") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") finishPoints(tool === "polygon");
      if (e.key === "Escape") setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, finishPoints]);

  useEffect(() => setDraft(null), [tool]);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = point(e);
    if (e.button !== 0 || !p) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const gesture = toolOf(tool).gesture;
    if (gesture === "click") return create((local) => clickAttrs(local(p)));
    if (gesture === "drag") return setDraft({ kind: "drag", p0: p, p1: p, shift: e.shiftKey });
    const d = draftRef.current;
    const anchors = d?.kind === "points" ? d.anchors : [];
    // Clicking the first point again closes the shape
    const first = anchors[0]?.p;
    if (first && anchors.length >= 2 && tool !== "polyline" && Math.hypot(p.x - first.x, p.y - first.y) < 6 * ctxRef.current.unit) return finishPoints(true);
    setDraft({ kind: "points", anchors: [...anchors, { p }], hover: p, pressed: true });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = draftRef.current;
    const p = point(e);
    if (!d || !p) return;
    if (d.kind === "drag") return setDraft({ ...d, p1: p, shift: e.shiftKey });
    if (d.pressed && tool === "path") {
      // Dragging while placing a pen point pulls out a curve handle
      const last = d.anchors[d.anchors.length - 1];
      const far = Math.hypot(p.x - last.p.x, p.y - last.p.y) > 3 * ctxRef.current.unit;
      return setDraft({ ...d, anchors: [...d.anchors.slice(0, -1), { p: last.p, h: far ? p : undefined }], hover: p });
    }
    setDraft({ ...d, hover: p });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = draftRef.current;
    if (d?.kind === "points") return setDraft({ ...d, pressed: false });
    if (d?.kind !== "drag" || tool === "select") return;
    const shape = tool as "rect" | "ellipse" | "line";
    create((local) => dragAttrs(shape, local(d.p0), local(d.p1), e.shiftKey) ?? clickAttrs(local(d.p0)));
  };

  const onDoubleClick = () => finishPoints(tool === "polygon");

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, overlay: <DraftPreview draft={draft} tool={tool} /> };
}

function DraftPreview({ draft, tool }: { draft: Draft | null; tool: ToolId }) {
  if (!draft) return null;
  if (draft.kind === "drag") {
    const a = dragAttrs(tool as "rect" | "ellipse" | "line", draft.p0, draft.p1, draft.shift);
    if (!a) return null;
    if (tool === "line") return <line className="vis-draft" x1={a.x} y1={a.y} x2={a.x + a.x2} y2={a.y + a.y2} />;
    if (tool === "ellipse") return <ellipse className="vis-draft" cx={a.x} cy={a.y} rx={a.rx} ry={a.ry} />;
    return <rect className="vis-draft" x={a.x} y={a.y} width={a.width} height={a.height} />;
  }
  const anchors = draft.hover ? [...draft.anchors, ...(draft.pressed ? [] : [{ p: draft.hover }])] : draft.anchors;
  const d = tool === "path" ? penAttrs(anchors, false) : null;
  return (
    <g pointerEvents="none">
      {d ? <path className="vis-draft" transform={`translate(${d.x} ${d.y})`} d={d.d} /> : <polyline className="vis-draft" points={anchors.map((a) => `${a.p.x},${a.p.y}`).join(" ")} />}
      {draft.anchors.map((a, i) => (
        <circle key={i} className="vis-handle" cx={a.p.x} cy={a.p.y} r={3} />
      ))}
    </g>
  );
}
