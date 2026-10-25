import React from "react";
import { IsoBox } from "./iso-draw";
import { commonProps, swatchVar, type ShapeDef } from "./shape-types";

const MARK_GAP = 0.5;

/** A belt conveyor: the belt's marks and the items on it move while it runs */
export const conveyor: ShapeDef = {
  type: "conveyor",
  label: "Conveyor",
  category: "Conveying",
  description: "A belt that moves items along while running",
  props: [
    { name: "length", label: "Length", kind: "number", default: 4, min: 1, max: 30, step: 0.5, unit: "tiles" },
    { name: "width", label: "Width", kind: "number", default: 1, min: 0.5, max: 3, step: 0.25, unit: "tiles" },
    { name: "height", label: "Height", kind: "number", default: 0.6, min: 0.2, max: 3, step: 0.1 },
    commonProps.running(),
    commonProps.speed(1),
    { name: "items", label: "Items on the belt", kind: "boolean", default: true },
    { name: "reverse", label: "Runs backwards", kind: "boolean", default: false },
    commonProps.color("steel", "Frame colour"),
  ],
  footprint: (p) => ({ a: Number(p.length), b: Number(p.width), h: Number(p.height) }),
  Render: ({ p, g, uid }) => {
    const L = Number(p.length);
    const W = Number(p.width);
    const H = Number(p.height);
    const frame = swatchVar(String(p.color));
    const speed = Number(p.speed);
    const moving = Boolean(p.running) && speed > 0;
    const dir = p.reverse ? -1 : 1;
    const top = H + 0.01;
    const beltPts = g.points([[0, 0.08, top], [L, 0.08, top], [L, W - 0.08, top], [0, W - 0.08, top]]);
    const marks = Math.ceil(L / MARK_GAP) + 2;
    const step = { x: g.alongA.x * MARK_GAP * dir, y: g.alongA.y * MARK_GAP * dir };
    const itemCount = Math.max(1, Math.floor(L / 1.5));
    const itemLen = Math.min(0.5, L / 3);
    const ride = { x: g.alongA.x * (L - itemLen) * dir, y: g.alongA.y * (L - itemLen) * dir };
    const rideDur = speed > 0 ? L / speed : 1;
    const legH = Math.max(0.05, H - 0.15);

    return (
      <g className={moving ? undefined : "vis-paused"}>
        {[0.15, L - 0.3].flatMap((a) =>
          [0.05, W - 0.17].map((b) => <IsoBox key={`${a}-${b}`} g={g} a={a} b={b} da={0.12} db={0.12} dz={legH} fill="var(--vis-dark)" />),
        )}
        <IsoBox g={g} a={0} b={0} z={H - 0.15} da={L} db={W} dz={0.15} fill={frame} />
        <clipPath id={`${uid}-belt`}>
          <polygon points={beltPts} />
        </clipPath>
        <polygon points={beltPts} style={{ fill: "var(--vis-belt)" }} />
        <g clipPath={`url(#${uid}-belt)`}>
          <g className="vis-slide" style={{ ["--vis-dx" as string]: `${step.x}px`, ["--vis-dy" as string]: `${step.y}px`, ["--vis-dur" as string]: `${MARK_GAP / Math.max(speed, 0.01)}s` }}>
            {Array.from({ length: marks }, (_, i) => {
              const a = (i - 1) * MARK_GAP;
              return <polygon key={i} points={g.points([[a, 0.1, top], [a + 0.06, 0.1, top], [a + 0.06, W - 0.1, top], [a, W - 0.1, top]])} style={{ fill: "var(--vis-belt-mark)" }} />;
            })}
          </g>
        </g>
        <IsoBox g={g} a={0} b={0} z={H} da={L} db={0.08} dz={0.06} fill={frame} />
        {p.items &&
          Array.from({ length: itemCount }, (_, i) => (
            <g
              key={i}
              className="vis-ride"
              style={{
                ["--vis-dx" as string]: `${ride.x}px`,
                ["--vis-dy" as string]: `${ride.y}px`,
                ["--vis-dur" as string]: `${rideDur}s`,
                animationDelay: `${(-i * rideDur) / itemCount}s`,
              }}
            >
              <IsoBox g={g} a={dir > 0 ? 0 : L - itemLen} b={W * 0.22} z={top} da={itemLen} db={W * 0.56} dz={0.35} fill="var(--vis-item)" />
            </g>
          ))}
        <IsoBox g={g} a={0} b={W - 0.08} z={H} da={L} db={0.08} dz={0.06} fill={frame} />
      </g>
    );
  },
};
