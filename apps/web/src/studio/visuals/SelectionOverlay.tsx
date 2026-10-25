/** Outlines around the selected shapes, with resize handles and a turn handle when one is selected */
import React from "react";
import type { Box } from "./resize";

const HANDLES: Array<[string, number, number, string]> = [
  ["nw", 0, 0, "nwse-resize"],
  ["n", 0.5, 0, "ns-resize"],
  ["ne", 1, 0, "nesw-resize"],
  ["e", 1, 0.5, "ew-resize"],
  ["se", 1, 1, "nwse-resize"],
  ["s", 0.5, 1, "ns-resize"],
  ["sw", 0, 1, "nesw-resize"],
  ["w", 0, 0.5, "ew-resize"],
];

interface Props {
  boxes: ReadonlyArray<{ id: string; box: Box; locked: boolean }>;
  /** Drawing units per screen pixel */
  unit: number;
  onResize: (e: React.PointerEvent, id: string, handle: string, box: Box) => void;
  onRotate: (e: React.PointerEvent, id: string, box: Box) => void;
}

export function SelectionOverlay({ boxes, unit, onResize, onRotate }: Props) {
  const pad = 2 * unit;
  const size = 8 * unit;
  const one = boxes.length === 1 && !boxes[0].locked ? boxes[0] : null;
  // On small shapes the side handles would hide the shape; the corners are enough
  const handles = one && Math.min(one.box.width, one.box.height) < size * 4 ? HANDLES.filter(([h]) => h.length === 2) : HANDLES;
  return (
    <g data-testid="selection">
      {boxes.map(({ id, box }) => (
        <rect key={id} className="vis-selection" x={box.x - pad} y={box.y - pad} width={box.width + pad * 2} height={box.height + pad * 2} />
      ))}
      {one && (
        <g>
          <line className="vis-selection" x1={one.box.x + one.box.width / 2} y1={one.box.y - pad} x2={one.box.x + one.box.width / 2} y2={one.box.y - 22 * unit} />
          <circle
            className="vis-handle"
            cx={one.box.x + one.box.width / 2}
            cy={one.box.y - 22 * unit}
            r={size / 1.6}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => onRotate(e, one.id, one.box)}
            aria-label="Turn"
          />
          {handles.map(([handle, fx, fy, cursor]) => (
            <rect
              key={handle}
              className="vis-handle"
              data-handle={handle}
              x={one.box.x - pad + fx * (one.box.width + pad * 2) - size / 2}
              y={one.box.y - pad + fy * (one.box.height + pad * 2) - size / 2}
              width={size}
              height={size}
              style={{ cursor }}
              onPointerDown={(e) => onResize(e, one.id, handle, one.box)}
            />
          ))}
        </g>
      )}
    </g>
  );
}
