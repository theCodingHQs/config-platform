import React from "react";
import { IsoBox, IsoCylinder } from "./iso-draw";
import { commonProps, statusVar, swatchVar, type ShapeDef } from "./shape-types";
import { FloatingLabel } from "./floating-label";

/** A machine (press, CNC, filler…) with a window and a status light on top */
export const machine: ShapeDef = {
  type: "machine",
  label: "Machine",
  category: "Machines",
  description: "A machine body with a status light: running, idle, stopped, alarm or off",
  props: [
    commonProps.status(),
    commonProps.label(),
    { name: "width", label: "Length", kind: "number", default: 2, min: 0.5, max: 10, step: 0.25, unit: "tiles" },
    { name: "depth", label: "Depth", kind: "number", default: 1.5, min: 0.5, max: 10, step: 0.25, unit: "tiles" },
    { name: "height", label: "Height", kind: "number", default: 1.4, min: 0.3, max: 6, step: 0.1 },
    commonProps.color("blue"),
    { name: "light", label: "Status light", kind: "boolean", default: true },
  ],
  footprint: (p) => ({ a: Number(p.width), b: Number(p.depth), h: Number(p.height) }),
  Render: ({ p, g }) => {
    const L = Number(p.width);
    const D = Number(p.depth);
    const H = Number(p.height);
    const status = String(p.status);
    const lamp = statusVar(status);
    const winA = Math.min(0.9, L * 0.45);
    const top = g.pt(L / 2, D / 2, H + 0.75);
    return (
      <g>
        <IsoBox g={g} da={L} db={D} dz={0.12} fill="var(--vis-dark)" />
        <IsoBox g={g} a={0.04} b={0.04} z={0.12} da={L - 0.08} db={D - 0.08} dz={H - 0.12} fill={swatchVar(String(p.color))} />
        {/* Window on the long side facing the viewer, and a status strip under it */}
        <polygon
          points={g.points([[0.25, D - 0.04, H * 0.45], [0.25 + winA, D - 0.04, H * 0.45], [0.25 + winA, D - 0.04, H * 0.82], [0.25, D - 0.04, H * 0.82]])}
          style={{ fill: "var(--vis-glass)", stroke: "var(--vis-dark)", strokeWidth: 1 }}
        />
        <polygon
          points={g.points([[0.25, D - 0.04, H * 0.3], [0.25 + winA, D - 0.04, H * 0.3], [0.25 + winA, D - 0.04, H * 0.36], [0.25, D - 0.04, H * 0.36]])}
          style={{ fill: lamp }}
        />
        {p.light && (
          <g>
            <IsoCylinder g={g} a={L / 2} b={D / 2} z={H} r={0.05} h={0.3} fill="var(--vis-dark)" />
            <g className={status === "alarm" ? "vis-blink" : undefined}>
              <IsoCylinder g={g} a={L / 2} b={D / 2} z={H + 0.3} r={0.14} h={0.3} fill={lamp} />
            </g>
          </g>
        )}
        {String(p.label) && <FloatingLabel x={top.x} y={top.y - 6} text={String(p.label)} />}
      </g>
    );
  },
};
