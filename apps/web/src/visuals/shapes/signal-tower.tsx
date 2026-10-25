import React from "react";
import { IsoCylinder } from "./iso-draw";
import type { ShapeDef } from "./shape-types";

const LIGHTS = [
  { name: "green", color: "var(--vis-on)" },
  { name: "amber", color: "var(--vis-idle)" },
  { name: "red", color: "var(--vis-alarm)" },
] as const;

/** A stack light (andon tower): green, amber and red lights, each on or off */
export const signalTower: ShapeDef = {
  type: "signal-tower",
  label: "Signal tower",
  category: "Signals & text",
  description: "A stack light with green, amber and red lights",
  props: [
    { name: "green", label: "Green on", kind: "boolean", default: true, hint: "e.g. live.line1.status == \"running\"" },
    { name: "amber", label: "Amber on", kind: "boolean", default: false },
    { name: "red", label: "Red on", kind: "boolean", default: false },
    { name: "blink", label: "Lit lights blink", kind: "boolean", default: false },
    { name: "height", label: "Height", kind: "number", default: 1.6, min: 0.8, max: 4, step: 0.1 },
  ],
  footprint: () => ({ a: 0.5, b: 0.5, h: 1.6 }),
  Render: ({ p, g }) => {
    const H = Number(p.height);
    const seg = 0.22;
    const pole = Math.max(0.1, H - seg * 3);
    return (
      <g>
        <IsoCylinder g={g} a={0.25} b={0.25} r={0.18} h={0.08} fill="var(--vis-dark)" />
        <IsoCylinder g={g} a={0.25} b={0.25} z={0.08} r={0.04} h={pole} fill="var(--vis-steel)" />
        {LIGHTS.map((light, i) => {
          const on = Boolean(p[light.name]);
          return (
            <g key={light.name} className={on && p.blink ? "vis-blink" : undefined}>
              <IsoCylinder
                g={g}
                a={0.25}
                b={0.25}
                z={0.08 + pole + i * seg}
                r={0.12}
                h={seg - 0.02}
                fill={on ? light.color : `color-mix(in srgb, ${light.color} 22%, var(--vis-dark))`}
              />
            </g>
          );
        })}
      </g>
    );
  },
};
