/**
 * The select tool: click to select (Shift adds), drag to move (snapping to the shapes around it
 * with smart guides, else to the grid; Alt places freely), drag on empty canvas to select
 * everything in a box, drag a handle to resize or turn, double-click a group to work inside it.
 */
import React, { useRef, useState } from "react";
import type { VisualNode } from "@config-platform/schema";
import type { CanvasCtx } from "./canvas-context";
import { hitPath, nodeBox, parentSpace, snapPoint, toDrawing, unionBox, type Pt } from "./canvas-geometry";
import { childrenOf, findNode, parentIdOf, type NodePatch } from "./node-tree";
import { dragBox, resizePatch, type Box } from "./resize";
import { snapMove, snapResize, type Guide, type SizeMatch } from "./smart-guides";
import { SmartGuides } from "./SmartGuides";

type Drag =
  | { mode: "move"; start: Pt; box: Box | null; items: Array<{ id: string; x: number; y: number; vector: (v: Pt) => Pt }>; targets: Box[]; group: string; moved: boolean }
  | { mode: "marquee"; start: Pt; now: Pt; additive: boolean }
  | { mode: "resize"; id: string; handle: string; start: Pt; box: Box; node: VisualNode; targets: Box[]; group: string }
  | { mode: "rotate"; id: string; centre: Pt; startAngle: number; startRotate: number; group: string };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** Smart guides catch within this many screen pixels */
const GUIDE_REACH = 6;

/** The shapes a moved or resized one lines up with: the others at its level, as drawn */
function guideTargets(svg: SVGSVGElement, nodes: readonly VisualNode[], ids: readonly string[]): Box[] {
  return childrenOf(nodes, parentIdOf(nodes, ids[0]))
    .filter((n) => !n.hidden && !ids.includes(n.id))
    .flatMap((n) => {
      const b = nodeBox(svg, n.id);
      return b ? [b] : [];
    });
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Which node a click on `path` (top-down ids) picks, given the open group */
export function pickTarget(path: string[], openGroup: string | null, deepest: boolean): { id: string | null; leaveGroup: boolean } {
  if (!path.length) return { id: null, leaveGroup: false };
  if (deepest) return { id: path[path.length - 1], leaveGroup: false };
  if (!openGroup) return { id: path[0], leaveGroup: false };
  const at = path.indexOf(openGroup);
  if (at >= 0 && path[at + 1]) return { id: path[at + 1], leaveGroup: false };
  return { id: path[0], leaveGroup: true };
}

export function useSelectGestures(ctxRef: React.MutableRefObject<CanvasCtx>, onEditText: (id: string) => void) {
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<{ lines: Guide[]; sizes: SizeMatch[] }>({ lines: [], sizes: [] });
  const showGuides = (lines: Guide[], sizes: SizeMatch[] = []) => setGuides((cur) => (!cur.lines.length && !cur.sizes.length && !lines.length && !sizes.length ? cur : { lines, sizes }));

  const startMove = (ids: string[], p: Pt) => {
    const { svg, state } = ctxRef.current;
    if (!svg) return;
    const items = ids
      .map((id) => findNode(state.definition.nodes, id))
      .filter((n): n is VisualNode => Boolean(n && !n.locked))
      .map((n) => ({ id: n.id, x: num(n.attrs.x), y: num(n.attrs.y), vector: parentSpace(svg, n.id).vector }));
    if (!items.length) return;
    const targets = guideTargets(svg, state.definition.nodes, items.map((i) => i.id));
    drag.current = { mode: "move", start: p, box: unionBox(items.map((i) => nodeBox(svg, i.id))), items, targets, group: `move-${Date.now()}`, moved: false };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { svg, state, dispatch } = ctxRef.current;
    if (e.button !== 0 || !svg) return;
    const p = toDrawing(svg, e.clientX, e.clientY);
    const { id, leaveGroup } = pickTarget(hitPath(e.target), state.openGroup, e.ctrlKey || e.metaKey);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (!id) {
      drag.current = { mode: "marquee", start: p, now: p, additive: e.shiftKey };
      if (!e.shiftKey) dispatch({ type: "select", ids: [] });
      return;
    }
    if (leaveGroup) dispatch({ type: "open", id: null });
    const current = leaveGroup ? [] : state.selection;
    let ids: string[];
    if (e.shiftKey) ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    else ids = current.includes(id) ? current : [id];
    dispatch({ type: "select", ids });
    if (ids.includes(id)) startMove(ids, p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { svg, dispatch, grid, unit, state } = ctxRef.current;
    const d = drag.current;
    if (!d || !svg) return;
    const p = toDrawing(svg, e.clientX, e.clientY);
    if (d.mode === "marquee") {
      d.now = p;
      setMarquee({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), width: Math.abs(p.x - d.start.x), height: Math.abs(p.y - d.start.y) });
      return;
    }
    if (d.mode === "move") {
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) < 3 * unit) return;
      d.moved = true;
      const snapping = { ...grid, on: grid.on && !e.altKey };
      const only = d.items.length === 1 ? findNode(state.definition.nodes, d.items[0].id) : undefined;
      if (snapping.on && snapping.isometric && only?.kind === "preset") {
        // Parts snap their anchor to the floor grid
        const s = snapPoint({ x: d.items[0].x + dx, y: d.items[0].y + dy }, snapping);
        dx = s.x - d.items[0].x;
        dy = s.y - d.items[0].y;
      } else if (d.box) {
        const s = snapPoint({ x: d.box.x + dx, y: d.box.y + dy }, { ...snapping, isometric: false });
        dx = s.x - d.box.x;
        dy = s.y - d.box.y;
      }
      // Lining up with the shapes around it wins over the grid, axis by axis
      if (d.box && !e.altKey) {
        const raw = { x: p.x - d.start.x, y: p.y - d.start.y };
        const smart = snapMove({ ...d.box, x: d.box.x + raw.x, y: d.box.y + raw.y }, d.targets, state.definition, GUIDE_REACH * unit);
        if (smart.dx !== null) dx = raw.x + smart.dx;
        if (smart.dy !== null) dy = raw.y + smart.dy;
        showGuides(smart.guides);
      } else showGuides([]);
      const changes = d.items.map((i) => {
        const v = i.vector({ x: dx, y: dy });
        return { id: i.id, patch: { attrs: { x: Math.round((i.x + v.x) * 100) / 100, y: Math.round((i.y + v.y) * 100) / 100 } } as NodePatch };
      });
      dispatch({ type: "update", changes, group: d.group });
      return;
    }
    if (d.mode === "resize") {
      let next = dragBox(d.box, d.handle, p.x - d.start.x, p.y - d.start.y, e.shiftKey, e.altKey);
      // Smart guides for a plain resize (not keeping the shape with Shift, or from the centre with Alt)
      if (!e.shiftKey && !e.altKey) {
        const smart = snapResize(next, d.handle, d.targets, state.definition, GUIDE_REACH * unit);
        next = smart.box;
        showGuides(smart.guides, smart.sizes);
      } else showGuides([]);
      const space = parentSpace(svg, d.id).point;
      const local = (b: Box): Box => {
        const a = space({ x: b.x, y: b.y });
        const c = space({ x: b.x + b.width, y: b.y + b.height });
        return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y) };
      };
      dispatch({ type: "update", changes: [{ id: d.id, patch: resizePatch(d.node, local(d.box), local(next), grid.isometric) }], group: d.group });
      return;
    }
    const angle = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) * 180) / Math.PI;
    let rotate = d.startRotate + angle - d.startAngle;
    rotate = e.shiftKey ? Math.round(rotate / 15) * 15 : Math.round(rotate);
    rotate = ((((rotate + 180) % 360) + 360) % 360) - 180;
    dispatch({ type: "update", changes: [{ id: d.id, patch: { attrs: { rotate } } }], group: d.group });
  };

  const onPointerUp = () => {
    const { svg, state, dispatch } = ctxRef.current;
    const d = drag.current;
    drag.current = null;
    showGuides([]);
    if (d?.mode !== "marquee" || !svg) return;
    setMarquee(null);
    const area = { x: Math.min(d.start.x, d.now.x), y: Math.min(d.start.y, d.now.y), width: Math.abs(d.now.x - d.start.x), height: Math.abs(d.now.y - d.start.y) };
    if (area.width < 2 && area.height < 2) return;
    const inside = childrenOf(state.definition.nodes, state.openGroup)
      .filter((n) => !n.hidden)
      .filter((n) => {
        const b = nodeBox(svg, n.id);
        return b && intersects(b, area);
      })
      .map((n) => n.id);
    dispatch({ type: "select", ids: d.additive ? [...new Set([...state.selection, ...inside])] : inside });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { state, dispatch } = ctxRef.current;
    const path = hitPath(e.target);
    const { id } = pickTarget(path, state.openGroup, false);
    const node = id ? findNode(state.definition.nodes, id) : undefined;
    if (!node) return;
    if (node.kind === "group") {
      // Work inside the group, starting with the shape under the pointer
      dispatch({ type: "open", id: node.id });
      const child = path[path.indexOf(node.id) + 1];
      if (child) dispatch({ type: "select", ids: [child] });
    } else if (node.kind === "text") onEditText(node.id);
  };

  /** Called by the selection handles */
  const startResize = (e: React.PointerEvent, id: string, handle: string, box: Box) => {
    const { svg, state } = ctxRef.current;
    const node = findNode(state.definition.nodes, id);
    if (!svg || !node || node.locked) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode: "resize", id, handle, start: toDrawing(svg, e.clientX, e.clientY), box, node, targets: guideTargets(svg, state.definition.nodes, [id]), group: `resize-${Date.now()}` };
  };

  const startRotate = (e: React.PointerEvent, id: string, box: Box) => {
    const { svg, state } = ctxRef.current;
    const node = findNode(state.definition.nodes, id);
    if (!svg || !node || node.locked) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const p = toDrawing(svg, e.clientX, e.clientY);
    drag.current = { mode: "rotate", id, centre, startAngle: (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI, startRotate: num(node.attrs.rotate), group: `rotate-${Date.now()}` };
  };

  const unit = ctxRef.current.unit;
  const overlay = (
    <>
      {marquee && <rect className="vis-marquee" {...marquee} />}
      <SmartGuides guides={guides.lines} sizes={guides.sizes} unit={unit} />
    </>
  );
  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, overlay, startResize, startRotate };
}
