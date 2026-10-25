import React from "react";
import { IsoCylinder, cylinderRadii } from "./iso-draw";
import { swatchVar, type ShapeDef } from "./shape-types";

/** A see-through tank or silo showing how full it is */
export const tank: ShapeDef = {
  type: "tank",
  label: "Tank",
  category: "Storage & flow",
  description: "A tank or silo; its level (0–100%) shows how full it is",
  props: [
    { name: "level", label: "Level", kind: "number", default: 60, min: 0, max: 100, step: 1, unit: "%", hint: "e.g. live.tank1.level" },
    { name: "radius", label: "Radius", kind: "number", default: 0.8, min: 0.3, max: 4, step: 0.1, unit: "tiles" },
    { name: "height", label: "Height", kind: "number", default: 2.2, min: 0.5, max: 8, step: 0.1 },
    { name: "liquid", label: "Contents colour", kind: "swatch", default: "blue" },
    { name: "showLevel", label: "Show the percentage", kind: "boolean", default: true },
    { name: "alarmBelow", label: "Warn below", kind: "number", default: 0, min: 0, max: 100, step: 1, unit: "%", hint: "Shown in the alarm colour under this level (0 = never)" },
  ],
  footprint: (p) => ({ a: Number(p.radius) * 2, b: Number(p.radius) * 2, h: Number(p.height) }),
  Render: ({ p, g }) => {
    const r = Number(p.radius);
    const H = Number(p.height);
    const level = Math.min(100, Math.max(0, Number(p.level) || 0));
    const low = Number(p.alarmBelow) > 0 && level < Number(p.alarmBelow);
    const liquidH = Math.max(0.001, (H - 0.1) * (level / 100));
    const base = g.pt(r, r, 0);
    const top = g.pt(r, r, H);
    const { ry } = cylinderRadii(r);
    return (
      <g>
        {/* Back of the tank, the contents, then a see-through front with steel bands */}
        <IsoCylinder g={g} a={r} b={r} r={r} h={H} fill="var(--vis-glass)" />
        {level > 0 && <IsoCylinder g={g} a={r} b={r} z={0.05} r={r * 0.94} h={liquidH} fill={low ? "var(--vis-alarm)" : swatchVar(String(p.liquid))} />}
        <g opacity={0.3}>
          <IsoCylinder g={g} a={r} b={r} r={r} h={H} fill="var(--vis-glass)" top={false} />
        </g>
        <IsoCylinder g={g} a={r} b={r} r={r * 1.01} h={0.12} fill="var(--vis-steel)" top={false} />
        <ellipse cx={top.x} cy={top.y} rx={cylinderRadii(r).rx} ry={ry} style={{ fill: "none", stroke: "var(--vis-steel)", strokeWidth: 2 }} />
        {p.showLevel && (
          <text className="vis-text-strong" x={base.x} y={(base.y + top.y) / 2 + ry / 2} textAnchor="middle" dominantBaseline="central" fontSize={13}>
            {Math.round(level)}%
          </text>
        )}
      </g>
    );
  },
};
