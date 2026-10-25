/** Building blocks for the layout: floor zones and plain boxes (walls, racks, pallets…) */
import React from "react";
import { IsoBox } from "./iso-draw";
import { commonProps, swatchVar, type ShapeDef } from "./shape-types";

export const zone: ShapeDef = {
  type: "zone",
  label: "Floor zone",
  category: "Layout",
  description: "A marked area on the floor (a cell, a bay, a danger zone); it draws under everything",
  layer: -5,
  props: [
    { name: "length", label: "Length", kind: "number", default: 6, min: 1, max: 60, step: 0.5, unit: "tiles" },
    { name: "width", label: "Width", kind: "number", default: 4, min: 1, max: 60, step: 0.5, unit: "tiles" },
    commonProps.color("blue"),
    commonProps.label(""),
    { name: "highlight", label: "Highlight", kind: "boolean", default: false, hint: "Pulses, e.g. while someone is in the zone" },
  ],
  footprint: (p) => ({ a: Number(p.length), b: Number(p.width), h: 0 }),
  Render: ({ p, g }) => {
    const L = Number(p.length);
    const W = Number(p.width);
    const c = swatchVar(String(p.color));
    // Name along the front edge, where shapes on the zone don't cover it
    const corner = g.pt(Math.min(1.2, L / 2), W - 0.35);
    return (
      <g>
        <polygon
          className={p.highlight ? "vis-pulse" : undefined}
          points={g.points([[0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0]])}
          style={{ fill: `color-mix(in srgb, ${c} 20%, var(--vis-floor))`, stroke: c, strokeWidth: 1.5, strokeDasharray: "8 5" }}
        />
        {String(p.label) && (
          <text className="vis-text-strong" x={corner.x} y={corner.y} textAnchor="middle" dominantBaseline="central" fontSize={12} style={{ fill: c }}>
            {String(p.label)}
          </text>
        )}
      </g>
    );
  },
};

export const box: ShapeDef = {
  type: "box",
  label: "Box",
  category: "Layout",
  description: "A plain block: a wall, rack, pallet, cabinet or anything square",
  props: [
    { name: "length", label: "Length", kind: "number", default: 1, min: 0.1, max: 40, step: 0.1, unit: "tiles" },
    { name: "width", label: "Width", kind: "number", default: 1, min: 0.1, max: 40, step: 0.1, unit: "tiles" },
    { name: "height", label: "Height", kind: "number", default: 1, min: 0.05, max: 10, step: 0.05 },
    commonProps.color("grey"),
  ],
  footprint: (p) => ({ a: Number(p.length), b: Number(p.width), h: Number(p.height) }),
  Render: ({ p, g }) => <IsoBox g={g} da={Number(p.length)} db={Number(p.width)} dz={Number(p.height)} fill={swatchVar(String(p.color))} />,
};
