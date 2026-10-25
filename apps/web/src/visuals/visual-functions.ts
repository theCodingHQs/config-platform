/**
 * Extra functions for visual bindings, on top of the usual expression functions:
 *   scale(live.cart.position, 0, 30700, 20, 1380)   a value in one range → the same place in another
 *   clamp(live.tank.level, 0, 100)
 *   pick(live.sqf1.status, "running", "green", "alarm", "red", "grey")   value → result, last = otherwise
 */
import type { ExpressionFunctions } from "@config-platform/schema";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const VISUAL_FUNCTIONS: ExpressionFunctions = {
  scale: (value: unknown, inMin: unknown, inMax: unknown, outMin: unknown, outMax: unknown) => {
    const [v, a, b, c, d] = [value, inMin, inMax, outMin, outMax].map(num);
    if (a === b) return c;
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return c + t * (d - c);
  },
  clamp: (value: unknown, min: unknown, max: unknown) => Math.min(num(max), Math.max(num(min), num(value))),
  pick: (value: unknown, ...pairs: unknown[]) => {
    for (let i = 0; i + 1 < pairs.length; i += 2) if (String(pairs[i]).toLowerCase() === String(value).toLowerCase()) return pairs[i + 1];
    return pairs.length % 2 === 1 ? pairs[pairs.length - 1] : null;
  },
};
