/**
 * The drawing being edited: click to select, drag to move (snapping to the floor grid; hold Alt to
 * place freely), drop shapes from the palette. Shapes move with live data while you edit.
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import { snapToIsoGrid, type ExpressionScope, type VisualDefinition, type VisualElement } from "@config-platform/schema";
import { VisualScene } from "../../visuals/VisualScene";
import { SHAPE_DRAG_TYPE } from "./ShapePalette";

interface Props {
  definition: VisualDefinition;
  scope: ExpressionScope | null;
  selectedId: string | null;
  zoom: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number, group: string) => void;
  onDropShape: (type: string, x: number, y: number) => void;
}

interface Drag {
  id: string;
  pointerId: number;
  start: { x: number; y: number };
  from: { x: number; y: number };
  group: string;
  moved: boolean;
}

/** A pointer position in drawing coordinates */
function toDrawing(svg: SVGSVGElement, clientX: number, clientY: number) {
  const m = svg.getScreenCTM();
  if (!m) return { x: clientX, y: clientY };
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export const placeAt = (x: number, y: number, free: boolean) => (free ? { x: Math.round(x), y: Math.round(y) } : snapToIsoGrid(x, y));

export function EditorCanvas({ definition, scope, selectedId, zoom, onSelect, onMove, onDropShape }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [outline, setOutline] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const selected = definition.elements.find((el) => el.id === selectedId);

  // The selection outline follows the selected shape's drawn size (which bindings can change)
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const node = selected && svg?.querySelector<SVGGElement>(`[data-element-id="${CSS.escape(selected.id)}"]`);
    if (!node || !selected) return setOutline(null);
    const b = node.getBBox();
    const next = { x: selected.x + b.x * selected.scale - 4, y: selected.y + b.y * selected.scale - 4, width: b.width * selected.scale + 8, height: b.height * selected.scale + 8 };
    setOutline((cur) => (cur && cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height ? cur : next));
  });

  const elementProps = (el: VisualElement): React.SVGProps<SVGGElement> => ({
    className: el.locked ? undefined : "vis-hit",
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect(el.id);
      if (el.locked || !svgRef.current) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      drag.current = { id: el.id, pointerId: e.pointerId, start: toDrawing(svgRef.current, e.clientX, e.clientY), from: { x: el.x, y: el.y }, group: `drag-${el.id}-${Date.now()}`, moved: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId || !svgRef.current) return;
      const p = toDrawing(svgRef.current, e.clientX, e.clientY);
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const next = placeAt(d.from.x + dx, d.from.y + dy, e.altKey);
      onMove(d.id, next.x, next.y, d.group);
    },
    onPointerUp: (e) => {
      if (drag.current?.pointerId === e.pointerId) drag.current = null;
    },
  });

  return (
    <div
      style={{ width: `${definition.width * zoom}px`, height: `${definition.height * zoom}px`, flex: "none", boxShadow: "var(--shadow-sm)" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(SHAPE_DRAG_TYPE);
        if (!type || !svgRef.current) return;
        e.preventDefault();
        const p = toDrawing(svgRef.current, e.clientX, e.clientY);
        const at = placeAt(p.x, p.y, e.altKey);
        onDropShape(type, at.x, at.y);
      }}
      onPointerDown={() => onSelect(null)}
      data-testid="visual-canvas"
    >
      <VisualScene
        definition={definition}
        scope={scope}
        svgRef={svgRef}
        elementProps={elementProps}
        ariaLabel="Drawing"
        renderOverlay={() =>
          outline && selected ? (
            <g pointerEvents="none">
              <rect className="vis-selection" {...outline} rx={4} />
              <circle cx={selected.x} cy={selected.y} r={3.5} style={{ fill: "var(--vis-select)" }} />
            </g>
          ) : null
        }
      />
    </div>
  );
}
