/**
 * Glides a node's numbers to their new values instead of jumping: a cart moving along its rail as
 * the position tag updates, a level rising. Only numbers glide; everything else changes at once.
 */
import { useEffect, useRef, useState } from "react";
import type { ResolvedProps } from "./shapes";

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function useSmooth(target: ResolvedProps, ms: number | undefined): ResolvedProps {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = shown;

  useEffect(() => {
    if (!ms) return;
    if (typeof requestAnimationFrame === "undefined") return setShown(target);
    const from = shownRef.current;
    const moving = Object.keys(target).filter((k) => typeof target[k] === "number" && typeof from[k] === "number" && from[k] !== target[k]);
    if (!moving.length) {
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      const next: ResolvedProps = { ...target };
      for (const key of moving) next[key] = (from[key] as number) + ((target[key] as number) - (from[key] as number)) * k;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return ms ? shown : target;
}
