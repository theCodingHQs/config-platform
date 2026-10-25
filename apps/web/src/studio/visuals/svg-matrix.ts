/**
 * SVG transforms as 2D matrices [a, b, c, d, e, f], and turning one back into the move, turn and
 * scale a node has (skew can't be kept; it's rare in drawings).
 */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

const translate = (x: number, y = 0): Matrix => [1, 0, 0, 1, x, y];
const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];
function rotate(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180;
  const m: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  return cx || cy ? multiply(multiply(translate(cx, cy), m), translate(-cx, -cy)) : m;
}

/** The transform attribute ("translate(10 20) rotate(45)"), or a CSS transform with px units */
export function parseTransform(text: string | null | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!text) return m;
  for (const [, fn, args] of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map((a) => parseFloat(a));
    let step: Matrix | null = null;
    switch (fn) {
      case "matrix":
        if (v.length === 6) step = v as Matrix;
        break;
      case "translate":
        step = translate(v[0] ?? 0, v[1] ?? 0);
        break;
      case "translateX":
        step = translate(v[0] ?? 0, 0);
        break;
      case "translateY":
        step = translate(0, v[0] ?? 0);
        break;
      case "scale":
        step = scale(v[0] ?? 1, v[1] ?? v[0] ?? 1);
        break;
      case "scaleX":
        step = scale(v[0] ?? 1, 1);
        break;
      case "scaleY":
        step = scale(1, v[0] ?? 1);
        break;
      case "rotate":
        step = rotate(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        break;
    }
    if (step && step.every(Number.isFinite)) m = multiply(m, step);
  }
  return m;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

/** Move, turn and scale that make the same picture (when there's no skew) */
export function decompose([a, b, c, d, e, f]: Matrix): { x: number; y: number; rotate: number; scaleX: number; scaleY: number } {
  const scaleX = Math.hypot(a, b);
  const rotate = scaleX ? (Math.atan2(b, a) * 180) / Math.PI : 0;
  const scaleY = scaleX ? (a * d - b * c) / scaleX : Math.hypot(c, d);
  return { x: r2(e), y: r2(f), rotate: r2(rotate), scaleX: r2(scaleX), scaleY: r2(scaleY) };
}
