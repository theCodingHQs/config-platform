/**
 * The drawing being edited. The active tool decides what the pointer does (see the gesture hooks);
 * parts can be dropped from the palette. Shapes move with live data while you edit.
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import type { ExpressionScope, VisualDefinition } from "@config-platform/schema";
import { VisualScene } from "../../visuals/VisualScene";
import { SHAPE_DRAG_TYPE } from "./ShapePalette";
import type { EditorAction, EditorState } from "./editor-state";
import type { CanvasCtx } from "./canvas-context";
import { nodeBox, snapPoint, toDrawing } from "./canvas-geometry";
import { findNode } from "./node-tree";
import type { Box } from "./resize";
import { useSelectGestures } from "./use-select-gestures";
import { useDrawGestures } from "./use-draw-gestures";
import { SelectionOverlay } from "./SelectionOverlay";
import type { ToolId } from "./tools";

interface Props {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  scope: ExpressionScope | null;
  symbols?: ReadonlyMap<string, VisualDefinition>;
  zoom: number;
  tool: ToolId;
  onToolDone: () => void;
  onEditText: (id: string) => void;
  onDropPart: (type: string, x: number, y: number) => void;
}

type Measured = Array<{ id: string; box: Box; locked: boolean }>;

const same = (a: Measured, b: Measured) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id && m.locked === b[i].locked && (["x", "y", "width", "height"] as const).every((k) => Math.abs(m.box[k] - b[i].box[k]) < 0.01));

export function EditorCanvas({ state, dispatch, scope, symbols, zoom, tool, onToolDone, onEditText, onDropPart }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { definition } = state;
  const ctxRef = useRef<CanvasCtx>(null as unknown as CanvasCtx);
  ctxRef.current = {
    svg: svgRef.current,
    state,
    dispatch,
    grid: { on: definition.grid, size: definition.gridSize, isometric: definition.mode === "isometric" },
    unit: 1 / zoom,
  };

  const select = useSelectGestures(ctxRef, onEditText);
  const draw = useDrawGestures(ctxRef, tool, onToolDone);
  const gestures = tool === "select" ? select : draw;

  // The selection outlines follow what's drawn (bindings and animations can change it)
  const [measured, setMeasured] = useState<Measured>([]);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    ctxRef.current.svg = svg;
    const next: Measured = [];
    for (const id of state.selection) {
      const box = svg && nodeBox(svg, id);
      if (box) next.push({ id, box, locked: Boolean(findNode(definition.nodes, id)?.locked) });
    }
    setMeasured((cur) => (same(cur, next) ? cur : next));
  });

  return (
    <div
      style={{ width: `${definition.width * zoom}px`, height: `${definition.height * zoom}px`, flex: "none", boxShadow: "var(--shadow-sm)", cursor: tool === "select" ? "default" : "crosshair", touchAction: "none" }}
      onPointerDown={gestures.onPointerDown}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerUp}
      onDoubleClick={gestures.onDoubleClick}
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
        const g = ctxRef.current.grid;
        const at = snapPoint(toDrawing(svgRef.current, e.clientX, e.clientY), { ...g, on: g.on && !e.altKey });
        onDropPart(type, at.x, at.y);
      }}
      data-testid="visual-canvas"
    >
      <VisualScene
        definition={definition}
        scope={scope}
        symbols={symbols}
        svgRef={svgRef}
        showGrid
        ariaLabel="Drawing"
        renderOverlay={() => (
          <>
            {tool === "select" && <SelectionOverlay boxes={measured} unit={1 / zoom} onResize={select.startResize} onRotate={select.startRotate} />}
            {gestures.overlay}
          </>
        )}
      />
    </div>
  );
}
