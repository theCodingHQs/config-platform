/**
 * Scaling path data and point lists, so resizing a drawn shape changes its coordinates (keeping
 * outline widths as they are) instead of stretching it.
 */

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** "0,0 40,20" scaled by (fx, fy) */
export function scalePoints(points: string, fx: number, fy: number): string {
  const nums = points.trim().split(/[\s,]+/).map(Number);
  const out: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push(`${fmt(nums[i] * fx)},${fmt(nums[i + 1] * fy)}`);
  return out.join(" ");
}

/** Numbers each command takes, and which of them are x (true) / y (false) coordinates; null = not a coordinate */
const SHAPES: Record<string, Array<boolean | null | "rx" | "ry">> = {
  M: [true, false],
  L: [true, false],
  T: [true, false],
  H: [true],
  V: [false],
  C: [true, false, true, false, true, false],
  S: [true, false, true, false],
  Q: [true, false, true, false],
  A: ["rx", "ry", null, null, null, true, false],
  Z: [],
};

function factor(role: boolean | null | "rx" | "ry", fx: number, fy: number): number {
  if (role === true) return fx;
  if (role === false) return fy;
  if (role === "rx") return Math.abs(fx);
  if (role === "ry") return Math.abs(fy);
  return 1;
}

/**
 * Scales every coordinate of a path by (fx, fy) around (0, 0). Works for absolute and relative
 * commands alike, since scaling around the origin is the same for both.
 */
export function scalePath(d: string, fx: number, fy: number): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = "";
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      out.push(t);
      i++;
      if (cmd.toUpperCase() === "Z") continue;
    }
    const shape = SHAPES[cmd.toUpperCase()];
    if (!shape || !shape.length) {
      i++;
      continue;
    }
    // One set of arguments (commands repeat their arguments without repeating the letter)
    for (const role of shape) {
      const v = Number(tokens[i++]);
      if (!Number.isFinite(v)) break;
      out.push(fmt(v * factor(role, fx, fy)));
    }
  }
  return out.join(" ").replace(/ ([a-zA-Z])/g, "$1").replace(/([a-zA-Z]) /g, "$1");
}
