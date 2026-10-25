/**
 * How a node is placed: moved to (x, y), optionally laid on the isometric floor or a wall, then
 * turned and scaled around its pivot.
 */
import type React from "react";
import type { ResolvedProps } from "./shapes";

const K = Math.SQRT1_2;
/** Flat drawing → isometric plane, matching the floor tiles (64 × 32) */
const PLANES: Record<string, string> = {
  floor: `matrix(${K} ${K / 2} ${-K} ${K / 2} 0 0)`,
  "left-wall": `matrix(${K} ${K / 2} 0 1 0 0)`,
  "right-wall": `matrix(${K} ${-K / 2} 0 1 0 0)`,
};

const ORIGINS: Record<string, string> = {
  center: "center",
  "top-left": "left top",
  top: "center top",
  "top-right": "right top",
  left: "left center",
  right: "right center",
  "bottom-left": "left bottom",
  bottom: "center bottom",
  "bottom-right": "right bottom",
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** The outer group: position (and plane, in isometric drawings) */
export function placeTransform(a: ResolvedProps, isometric: boolean): string {
  const plane = isometric ? PLANES[String(a.plane)] : undefined;
  return `translate(${num(a.x, 0)} ${num(a.y, 0)})${plane ? ` ${plane}` : ""}`;
}

/** The inner group: turning and scaling around the pivot. Empty when there's nothing to do. */
export function pivotTransform(a: ResolvedProps): { transform?: string; style?: React.CSSProperties } {
  const r = num(a.rotate, 0);
  const sx = num(a.scaleX, 1);
  const sy = num(a.scaleY, 1);
  if (r === 0 && sx === 1 && sy === 1) return {};
  const scaled = sx !== 1 || sy !== 1;
  if (a.pivot === "anchor") return { transform: [r ? `rotate(${r})` : "", scaled ? `scale(${sx} ${sy})` : ""].join(" ").trim() };
  return {
    style: {
      transform: [r ? `rotate(${r}deg)` : "", scaled ? `scale(${sx}, ${sy})` : ""].join(" ").trim(),
      transformBox: "fill-box",
      transformOrigin: ORIGINS[String(a.pivot)] ?? "center",
    },
  };
}
