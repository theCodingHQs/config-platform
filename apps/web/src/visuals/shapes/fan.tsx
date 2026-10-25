import React from "react";
import { IsoBox, OnFloor } from "./iso-draw";
import { commonProps, swatchVar, type ShapeDef } from "./shape-types";

/** A fan, mixer or motor seen from above: the blades turn while it runs */
export const fan: ShapeDef = {
  type: "fan",
  label: "Fan / mixer",
  category: "Machines",
  description: "Turning blades: a fan, mixer, cooling unit or motor",
  props: [
    commonProps.running(),
    { name: "speed", label: "Turns per second", kind: "number", default: 1, min: 0, max: 10, step: 0.1 },
    { name: "size", label: "Size", kind: "number", default: 1.2, min: 0.5, max: 4, step: 0.1, unit: "tiles" },
    commonProps.color("grey", "Housing colour"),
  ],
  footprint: (p) => ({ a: Number(p.size), b: Number(p.size), h: 0.4 }),
  Render: ({ p, g }) => {
    const s = Number(p.size);
    const speed = Number(p.speed);
    const moving = Boolean(p.running) && speed > 0;
    const r = s * 0.42;
    return (
      <g className={moving ? undefined : "vis-paused"}>
        <IsoBox g={g} da={s} db={s} dz={0.4} fill={swatchVar(String(p.color))} />
        <OnFloor g={g} a={s / 2} b={s / 2} z={0.41}>
          <circle r={r} style={{ fill: "var(--vis-dark)" }} />
          <g className="vis-spin" style={{ ["--vis-dur" as string]: `${1 / Math.max(speed, 0.01)}s` }}>
            {[0, 90, 180, 270].map((deg) => (
              <ellipse key={deg} cx={r * 0.5} cy={0} rx={r * 0.46} ry={r * 0.16} transform={`rotate(${deg})`} style={{ fill: "var(--vis-steel)" }} />
            ))}
            <circle r={r * 0.16} style={{ fill: "var(--vis-white)" }} />
          </g>
        </OnFloor>
      </g>
    );
  },
};
