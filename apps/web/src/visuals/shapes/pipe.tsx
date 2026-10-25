import React from "react";
import { IsoBox } from "./iso-draw";
import { commonProps, swatchVar, type ShapeDef } from "./shape-types";

/** A straight pipe run; its contents flow while flowing is on */
export const pipe: ShapeDef = {
  type: "pipe",
  label: "Pipe",
  category: "Storage & flow",
  description: "A pipe with flowing contents; join several to make a route",
  props: [
    { name: "flowing", label: "Flowing", kind: "boolean", default: true, hint: "e.g. live.pump1.on" },
    commonProps.speed(1),
    { name: "reverse", label: "Flows backwards", kind: "boolean", default: false },
    { name: "length", label: "Length", kind: "number", default: 4, min: 0.5, max: 40, step: 0.5, unit: "tiles" },
    { name: "elevation", label: "Height above floor", kind: "number", default: 0.6, min: 0, max: 6, step: 0.1 },
    { name: "liquid", label: "Contents colour", kind: "swatch", default: "blue" },
    commonProps.color("steel", "Pipe colour"),
  ],
  footprint: (p) => ({ a: Number(p.length), b: 0.3, h: Number(p.elevation) + 0.2 }),
  Render: ({ p, g }) => {
    const L = Number(p.length);
    const z = Number(p.elevation);
    const from = g.pt(0, 0.15, z + 0.1);
    const to = g.pt(L, 0.15, z + 0.1);
    const flowing = Boolean(p.flowing) && Number(p.speed) > 0;
    const d = p.reverse ? `M${to.x},${to.y} L${from.x},${from.y}` : `M${from.x},${from.y} L${to.x},${to.y}`;
    return (
      <g>
        {z > 0.15 &&
          [0.2, L - 0.3].map((a) => <IsoBox key={a} g={g} a={a} b={0.1} da={0.1} db={0.1} dz={z} fill="var(--vis-dark)" />)}
        <path d={d} style={{ stroke: `color-mix(in srgb, ${swatchVar(String(p.color))} 70%, var(--vis-shade))`, strokeWidth: 11, strokeLinecap: "round", fill: "none" }} />
        <path d={d} style={{ stroke: swatchVar(String(p.color)), strokeWidth: 8, strokeLinecap: "round", fill: "none" }} />
        <path
          d={d}
          className={flowing ? "vis-flow" : undefined}
          style={{
            stroke: swatchVar(String(p.liquid)),
            strokeWidth: 3.5,
            strokeDasharray: "7 5",
            fill: "none",
            opacity: flowing ? 1 : 0.35,
            ["--vis-dash" as string]: 12,
            ["--vis-dur" as string]: `${0.6 / Math.max(Number(p.speed), 0.01)}s`,
          }}
        />
      </g>
    );
  },
};
