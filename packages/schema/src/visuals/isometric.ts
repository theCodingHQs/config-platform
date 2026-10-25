/**
 * Isometric (2.5D) geometry. A point in the scene is (u, v, z): u runs down-right on screen, v runs
 * down-left, z goes up, all in tiles. One tile is 64 × 32 px on screen; one unit of height 36 px.
 */
export const ISO = { tileW: 64, tileH: 32, unitZ: 36 } as const;

export interface Point {
  x: number;
  y: number;
}

/** Screen position of a scene point, relative to the scene's origin */
export function isoPoint(u: number, v: number, z = 0): Point {
  return { x: ((u - v) * ISO.tileW) / 2, y: ((u + v) * ISO.tileH) / 2 - z * ISO.unitZ };
}

/** The floor point (z = 0) under a screen position */
export function screenToIso(x: number, y: number): { u: number; v: number } {
  const a = x / (ISO.tileW / 2);
  const b = y / (ISO.tileH / 2);
  return { u: (a + b) / 2, v: (b - a) / 2 };
}

/** The nearest grid crossing on the floor, so shapes line up with the tiles and each other */
export function snapToIsoGrid(x: number, y: number, step = 0.5): Point {
  const { u, v } = screenToIso(x, y);
  const round = (n: number) => Math.round(n / step) * step;
  return isoPoint(round(u), round(v));
}

/** SVG polygon points for a list of scene points */
export function polygon(points: Array<[number, number, number]>): string {
  return points
    .map(([u, v, z]) => {
      const p = isoPoint(u, v, z);
      return `${round2(p.x)},${round2(p.y)}`;
    })
    .join(' ');
}

const round2 = (n: number) => Math.round(n * 100) / 100;
