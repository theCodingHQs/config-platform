/**
 * Whether the app's server answers: its health check, every so often while the tab is visible,
 * and straight away when the tab comes back or the network returns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../config";

export type ServerState = "checking" | "ok" | "slow" | "down";

export interface ServerHealth {
  state: ServerState;
  /** How long the last answer took */
  latencyMs: number | null;
  checkedAt: number | null;
  /** When it last answered, to say how long it's been unreachable */
  lastOkAt: number | null;
  /** Check again now */
  recheck: () => void;
}

export const HEALTH_EVERY_MS = 20_000;
/** Slower than this counts as slow */
export const SLOW_MS = 1500;
/** No answer within this counts as unreachable */
export const HEALTH_TIMEOUT_MS = 6000;

export function useServerHealth(enabled: boolean, online: boolean): ServerHealth {
  const [health, setHealth] = useState<Omit<ServerHealth, "recheck">>({ state: "checking", latencyMs: null, checkedAt: null, lastOkAt: null });
  const lastOk = useRef<number | null>(null);
  const checkNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const started = performance.now();
      const abort = new AbortController();
      const giveUp = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
      let ok = false;
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { cache: "no-store", signal: abort.signal });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(giveUp);
        inFlight = false;
      }
      if (cancelled) return;
      const now = Date.now();
      const latencyMs = Math.round(performance.now() - started);
      if (ok) lastOk.current = now;
      setHealth({ state: !ok ? "down" : latencyMs > SLOW_MS ? "slow" : "ok", latencyMs: ok ? latencyMs : null, checkedAt: now, lastOkAt: lastOk.current });
      // Only while someone can see it
      if (document.visibilityState === "visible") timer = setTimeout(check, HEALTH_EVERY_MS);
    };

    checkNow.current = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !timer) void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Checking again when the network comes back
  }, [enabled, online]);

  const recheck = useCallback(() => checkNow.current(), []);
  return useMemo(() => ({ ...health, recheck }), [health, recheck]);
}
