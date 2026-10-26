/**
 * Every node in drawing order (top of the list draws on top), with groups opened out. Rows look
 * like the page builder's component tree: the selected row outlined in the accent colour, a
 * dashed outline on hover, and a line down the left of each group's contents.
 * Drag a row by its handle to move it: drop on the upper or lower edge of another row to put it
 * just in front of or behind that layer, or on the middle of a group to put it in that group.
 * Dragging a selected row moves everything selected. Selecting a shape on the canvas opens the
 * groups it's in and scrolls its row smoothly into view.
 */
import React, { useEffect, useRef, useState } from "react";
import { closestCenter, DndContext, DragOverlay, PointerSensor, pointerWithin, type CollisionDetection, useDraggable, useDroppable, useSensor, useSensors, type DragMoveEvent } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import type { VisualNode } from "@config-platform/schema";
import { nodeLabel } from "./NodeInspector";
import { findNode } from "./node-tree";
import { canDrop, type DropPlace, type LayerDrop } from "./layer-moves";

interface Props {
  nodes: readonly VisualNode[];
  selection: readonly string[];
  openGroup: string | null;
  onSelect: (ids: string[], openGroup: string | null) => void;
  onToggleHidden: (node: VisualNode) => void;
  onMove: (ids: string[], drop: LayerDrop) => void;
}

interface Drag {
  /** The layers being dragged */
  ids: readonly string[];
  /** Where they'd go if dropped now; null = nowhere they can go */
  drop: LayerDrop | null;
}

/** A group's contents: one step in, with a line down the left (as in the page builder's tree) */
const CHILDREN_STYLE: React.CSSProperties = {
  listStyle: "none",
  margin: "0 0 0 0.6rem",
  padding: "0 0 0 var(--space-1)",
  borderLeft: "var(--border-width-sm) solid var(--border)",
};

/** Where a drop above or below a row lands: an accent line just outside that edge */
function DropLine({ place }: { place: "above" | "below" }) {
  return (
    <span
      aria-hidden="true"
      style={{ position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1, background: "var(--accent)", pointerEvents: "none", ...(place === "above" ? { top: -3 } : { bottom: -3 }) }}
    />
  );
}

/** Whether any of `ids` is somewhere inside this node */
const holdsAny = (node: VisualNode, ids: readonly string[]): boolean => (node.children ?? []).some((c) => ids.includes(c.id) || holdsAny(c, ids));

const usesLiveData = (node: VisualNode) => Boolean((node.bindings && Object.keys(node.bindings).length) || node.rules?.length);

function Row({ node, parentId, props, drag }: { node: VisualNode; parentId: string | null; props: Props; drag: Drag | null }) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const draggable = useDraggable({ id: node.id, disabled: Boolean(node.locked) });
  const droppable = useDroppable({ id: node.id });
  const selected = props.selection.includes(node.id);
  const kids = node.children ?? [];
  // A shape picked on the canvas inside a closed group opens it, so its row can be shown
  const holdsSelected = holdsAny(node, props.selection);
  useEffect(() => {
    if (holdsSelected) setExpanded(true);
  }, [holdsSelected]);
  const dropHere = drag?.drop?.targetId === node.id ? drag.drop.place : null;
  const moving = Boolean(drag?.ids.includes(node.id));
  const highlighted = !drag && hovered;
  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={kids.length ? expanded : undefined}>
      <div
        ref={droppable.setNodeRef}
        data-layer-row={node.id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "0.125rem 0.375rem",
          marginBottom: "2px",
          borderRadius: "var(--radius-control)",
          backgroundColor: dropHere === "inside" || selected ? "var(--accent-subtle)" : highlighted ? "var(--surface-2)" : "transparent",
          border: dropHere === "inside" ? "1px dashed var(--accent)" : selected ? "1px solid var(--accent)" : highlighted ? "1px dashed var(--accent)" : "1px solid transparent",
          opacity: moving ? 0.35 : 1,
          transition: "background-color 0.12s ease, border-color 0.12s ease",
          fontSize: "var(--font-size-xs)",
          color: node.hidden ? "var(--text-muted)" : selected || highlighted ? "var(--accent)" : "var(--text)",
        }}
      >
        {dropHere && dropHere !== "inside" && <DropLine place={dropHere} />}
        <span
          ref={draggable.setNodeRef}
          {...draggable.attributes}
          {...draggable.listeners}
          aria-label={`Move ${nodeLabel(node)}`}
          title={node.locked ? "Locked: unlock it to move it" : "Drag to put it in front of or behind other layers, or into a group"}
          style={{ display: "inline-flex", alignItems: "center", touchAction: "none", cursor: node.locked ? "not-allowed" : drag ? "grabbing" : "grab", color: "var(--text-muted)", opacity: node.locked ? 0.35 : 1 }}
        >
          <GripVertical size={13} />
        </span>
        <button type="button" className="btn btn-ghost" aria-label={expanded ? "Collapse" : "Expand"} style={{ padding: 0, visibility: kids.length ? "visible" : "hidden" }} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size="1em" /> : <ChevronRight size="1em" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            const ids = e.shiftKey ? (selected ? props.selection.filter((x) => x !== node.id) : [...props.selection, node.id]) : [node.id];
            props.onSelect(ids, parentId);
          }}
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, padding: "var(--space-1) 0", cursor: "pointer", color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: selected ? 600 : 400 }}
        >
          {nodeLabel(node)}
          {usesLiveData(node) ? <span title="Uses live data" style={{ color: "var(--accent)" }}> ⚡</span> : null}
        </button>
        {node.locked && <Lock size="0.9em" aria-label="Locked" style={{ color: "var(--text-muted)" }} />}
        <button type="button" className="btn btn-ghost" style={{ padding: 0 }} aria-label={node.hidden ? `Show ${nodeLabel(node)}` : `Hide ${nodeLabel(node)}`} title={node.hidden ? "Show" : "Hide while editing"} onClick={() => props.onToggleHidden(node)}>
          {node.hidden ? <EyeOff size="1em" /> : <Eye size="1em" />}
        </button>
      </div>
      {expanded && kids.length > 0 && (
        <ul role="group" style={CHILDREN_STYLE}>
          {[...kids].reverse().map((k) => (
            <Row key={k.id} node={k} parentId={node.id} props={props} drag={drag} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The row under the pointer, or the nearest one when it's in a gap or at an edge */
const rowAtPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

/** Which part of the row under the pointer it's over: groups take the middle as "into" */
function placeOn(target: VisualNode, pointerY: number, rect: { top: number; height: number }): DropPlace {
  const at = (pointerY - rect.top) / Math.max(1, rect.height);
  if (target.kind === "group") return at < 0.3 ? "above" : at > 0.7 ? "below" : "inside";
  return at < 0.5 ? "above" : "below";
}

export function LayersPanel(props: Props) {
  const [drag, setDragState] = useState<Drag | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  // The selected row scrolls smoothly into view (after any group it's in has opened)
  const first = props.selection[0];
  useEffect(() => {
    if (!first) return;
    const frame = requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-layer-row="${CSS.escape(first)}"]`);
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [first]);
  // Drag events can come before React has re-rendered, so they read the latest drag from here
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  if (!props.nodes.length) return <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Nothing drawn yet.</p>;

  const track = (e: DragMoveEvent) => {
    const current = dragRef.current;
    const ids = current?.ids ?? [];
    const target = e.over ? findNode(props.nodes, String(e.over.id)) : undefined;
    const start = e.activatorEvent as PointerEvent;
    if (!target || !e.over || typeof start.clientY !== "number") return setDrag({ ids, drop: null });
    const drop: LayerDrop = { targetId: target.id, place: placeOn(target, start.clientY + e.delta.y, e.over.rect) };
    const next = canDrop(props.nodes, ids, drop) ? drop : null;
    if (next?.targetId !== current?.drop?.targetId || next?.place !== current?.drop?.place) setDrag({ ids, drop: next });
  };
  const dragged = drag ? findNode(props.nodes, drag.ids[drag.ids.length - 1] ?? "") : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rowAtPointer}
      onDragStart={(e) => {
        const id = String(e.active.id);
        // A selected row brings the rest of the selection with it
        setDrag({ ids: props.selection.includes(id) ? [...props.selection] : [id], drop: null });
      }}
      onDragMove={track}
      onDragEnd={() => {
        const done = dragRef.current;
        if (done?.drop) props.onMove([...done.ids], done.drop);
        setDrag(null);
      }}
      onDragCancel={() => setDrag(null)}
    >
      <ul ref={treeRef} role="tree" aria-label="Layers" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {[...props.nodes].reverse().map((n) => (
          <Row key={n.id} node={n} parentId={null} props={props} drag={drag} />
        ))}
      </ul>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", padding: "0.25rem 0.5rem", borderRadius: "var(--radius-control)", backgroundColor: "var(--surface)", border: "1px solid var(--accent)", boxShadow: "var(--shadow-md)", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--accent)", cursor: "grabbing", whiteSpace: "nowrap" }}>
            <GripVertical size={13} />
            {nodeLabel(dragged)}
            {drag && drag.ids.length > 1 ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>+ {drag.ids.length - 1} more</span> : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
