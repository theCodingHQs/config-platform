/**
 * Drawing helpers for shapes. A shape draws in its own axes: a along its length, b across it, z up,
 * all in tiles from its anchor. The frame maps those onto the floor's u/v (turned shapes swap them),
 * so boxes always shade the same way: lit top, mid left side, dark right side.
 */
import React from "react";
import { isoPoint, type Point } from "@config-platform/schema";

export interface IsoFrame {
  turned: boolean;
  /** Screen point of (a, b, z) */
  pt: (a: number, b: number, z?: number) => Point;
  /** SVG points attribute */
  points: (pts: Array<[number, number, number]>) => string;
  /** Screen vector for one tile along a (for animating along the shape's length) */
  alongA: Point;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function isoFrame(turned: boolean): IsoFrame {
  const pt = (a: number, b: number, z = 0) => (turned ? isoPoint(b, a, z) : isoPoint(a, b, z));
  const o = pt(0, 0);
  const one = pt(1, 0);
  return {
    turned,
    pt,
    points: (pts) =>
      pts
        .map(([a, b, z]) => {
          const p = pt(a, b, z);
          return `${r2(p.x)},${r2(p.y)}`;
        })
        .join(" "),
    alongA: { x: one.x - o.x, y: one.y - o.y },
  };
}

type Faces = "top" | "left" | "right";

/**
 * A box from (a, b, z) of size (da, db, dz). Draws the three faces facing the viewer; `fill` is the
 * top colour and the sides are darker shades of it.
 */
export function IsoBox({
  g,
  a = 0,
  b = 0,
  z = 0,
  da,
  db,
  dz,
  fill,
  className,
  only,
}: {
  g: IsoFrame;
  a?: number;
  b?: number;
  z?: number;
  da: number;
  db: number;
  dz: number;
  fill: string;
  className?: string;
  only?: Faces[];
}) {
  // In floor terms (u, v) the visible sides are the ones at the far u and far v ends
  const [u0, v0, du, dv] = g.turned ? [b, a, db, da] : [a, b, da, db];
  const u1 = u0 + du;
  const v1 = v0 + dv;
  const z1 = z + dz;
  const poly = (pts: Array<[number, number, number]>) =>
    pts
      .map(([u, v, h]) => {
        const p = isoPoint(u, v, h);
        return `${r2(p.x)},${r2(p.y)}`;
      })
      .join(" ");
  const show = (f: Faces) => !only || only.includes(f);
  return (
    <g className={className} style={{ ["--c" as string]: fill }}>
      {show("left") && <polygon className="vis-face-left" points={poly([[u0, v1, z], [u1, v1, z], [u1, v1, z1], [u0, v1, z1]])} />}
      {show("right") && <polygon className="vis-face-right" points={poly([[u1, v0, z], [u1, v1, z], [u1, v1, z1], [u1, v0, z1]])} />}
      {show("top") && <polygon className="vis-face-top" points={poly([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]])} />}
    </g>
  );
}

/** An upright cylinder (tank, post, motor) centred at (a, b) with radius r in tiles */
export function IsoCylinder({
  g,
  a,
  b,
  z = 0,
  r,
  h,
  fill,
  className,
  top = true,
}: {
  g: IsoFrame;
  a: number;
  b: number;
  z?: number;
  r: number;
  h: number;
  fill: string;
  className?: string;
  /** Draw the top face; off for bands and rings around something else */
  top?: boolean;
}) {
  const c0 = g.pt(a, b, z);
  const c1 = g.pt(a, b, z + h);
  const rx = r * Math.SQRT2 * 32;
  const ry = rx / 2;
  const body = `M${r2(c0.x - rx)},${r2(c0.y)} A${r2(rx)},${r2(ry)} 0 0 0 ${r2(c0.x + rx)},${r2(c0.y)} L${r2(c1.x + rx)},${r2(c1.y)} A${r2(rx)},${r2(ry)} 0 0 1 ${r2(c1.x - rx)},${r2(c1.y)} Z`;
  return (
    <g className={className} style={{ ["--c" as string]: fill }}>
      <path className="vis-cyl-side" d={body} />
      {top && <ellipse className="vis-face-top" cx={r2(c1.x)} cy={r2(c1.y)} rx={r2(rx)} ry={r2(ry)} />}
    </g>
  );
}

/** Screen size of an upright cylinder of radius r, for shapes drawing inside one */
export const cylinderRadii = (r: number) => ({ rx: r * Math.SQRT2 * 32, ry: r * Math.SQRT2 * 16 });

/** A flat (u, v) drawing laid on a horizontal plane at height z: children draw in tile units around (a, b) */
export function OnFloor({ g, a, b, z = 0, children }: { g: IsoFrame; a: number; b: number; z?: number; children: React.ReactNode }) {
  const c = g.pt(a, b, z);
  return <g transform={`matrix(32,16,-32,16,${r2(c.x)},${r2(c.y)})`}>{children}</g>;
}
