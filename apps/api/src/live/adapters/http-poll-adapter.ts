/** HTTP polling source: fetches an MES/ERP or device web API every few seconds. */
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';
import { describeConnectionError } from './connection-errors.js';

const TIMEOUT_MS = 10_000;

export function createHttpPollAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const url = String(settings.url);
  const headers = Object.fromEntries(((settings.headers ?? []) as Array<{ name: string; value?: string }>).map((h) => [h.name, h.value ?? '']));
  const intervalMs = Math.max(1, Number(settings.intervalSec) || 10) * 1000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let healthy: boolean | null = null;

  const setHealthy = (ok: boolean, error?: string) => {
    if (ok && healthy !== true) events.onState('connected');
    if (!ok) events.onState('error', error);
    healthy = ok;
  };

  const poll = async () => {
    if (stopped) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        setHealthy(false, describeConnectionError({ message: `${res.status} ${res.statusText}` }, url));
      } else {
        const body = await res.text();
        setHealthy(true);
        events.onMessage({ payload: body });
      }
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? `No answer from ${new URL(url).host} within ${TIMEOUT_MS / 1000} seconds.` : describeConnectionError(err?.cause ?? err, url);
      setHealthy(false, reason);
    } finally {
      clearTimeout(timeout);
      if (!stopped) timer = setTimeout(() => void poll(), intervalMs);
    }
  };

  return {
    start() {
      events.onState('connecting');
      void poll();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
