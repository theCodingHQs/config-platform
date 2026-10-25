import React from "react";
import { IsoCylinder } from "./iso-draw";
import { commonProps, swatchVar, type ShapeDef } from "./shape-types";

/** A pick-and-place robot arm swinging back and forth while it runs */
export const robotArm: ShapeDef = {
  type: "robot-arm",
  label: "Robot arm",
  category: "Machines",
  description: "A robot arm that swings while running",
  props: [
    commonProps.running(),
    { name: "cycle", label: "Seconds per cycle", kind: "number", default: 3, min: 0.5, max: 30, step: 0.5 },
    { name: "reach", label: "Reach", kind: "number", default: 1.2, min: 0.6, max: 3, step: 0.1 },
    commonProps.color("orange"),
  ],
  footprint: () => ({ a: 1, b: 1, h: 1.5 }),
  Render: ({ p, g }) => {
    const reach = Number(p.reach);
    const moving = Boolean(p.running);
    const color = swatchVar(String(p.color));
    const shoulder = g.pt(0.5, 0.5, 0.75);
    const upper = reach * 34;
    const fore = reach * 28;
    const arm = (len: number, w: number) => (
      <rect x={-w / 2} y={-len} width={w} height={len} rx={w / 2} style={{ fill: color, stroke: `color-mix(in srgb, ${color} 55%, var(--vis-shade))`, strokeWidth: 1 }} />
    );
    return (
      <g className={moving ? undefined : "vis-paused"}>
        <IsoCylinder g={g} a={0.5} b={0.5} r={0.42} h={0.2} fill="var(--vis-dark)" />
        <IsoCylinder g={g} a={0.5} b={0.5} z={0.2} r={0.26} h={0.55} fill={color} />
        <g transform={`translate(${shoulder.x},${shoulder.y})`}>
          <g className="vis-swing" style={{ ["--vis-dur" as string]: `${Number(p.cycle)}s`, ["--vis-swing" as string]: "28deg" }}>
            {arm(upper, 11)}
            <g transform={`translate(0,${-upper})`}>
              <g transform="rotate(70)">
                <g className="vis-swing" style={{ ["--vis-dur" as string]: `${Number(p.cycle)}s`, ["--vis-swing" as string]: "-40deg" }}>
                  {arm(fore, 8)}
                  <rect x={-8} y={-fore - 6} width={16} height={6} rx={2} style={{ fill: "var(--vis-dark)" }} />
                </g>
              </g>
              <circle r={6} style={{ fill: "var(--vis-dark)" }} />
            </g>
          </g>
          <circle r={7} style={{ fill: "var(--vis-dark)" }} />
        </g>
      </g>
    );
  },
};
