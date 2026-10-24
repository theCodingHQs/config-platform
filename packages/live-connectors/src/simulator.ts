/**
 * Simulator: demo data without hardware, for trying pages and visuals or showing a customer an
 * animated line before their machines are connected. Sends one JSON message per tick, e.g.
 * { "speed": 41.2, "status": "running", "count": 1532 }.
 */
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';

interface Signal {
  key: string;
  pattern: 'wave' | 'random' | 'counter' | 'cycle';
  min: number;
  max: number;
  period: number;
  values?: string[];
}

/** The value of one signal at tick `tick` (pure, so it can be tested). */
export function simulatedValue(signal: Signal, tick: number, intervalMs: number, previous?: number): number | string {
  const { min, max } = signal;
  switch (signal.pattern) {
    case 'wave': {
      const seconds = (tick * intervalMs) / 1000;
      const phase = (2 * Math.PI * seconds) / signal.period;
      return round2(min + ((Math.sin(phase) + 1) / 2) * (max - min));
    }
    case 'random': {
      // A random walk stays believable (a speed doesn't jump from 10 to 90 in a second)
      const start = previous ?? (min + max) / 2;
      const step = (max - min) * 0.05 * (Math.random() * 2 - 1);
      return round2(Math.min(max, Math.max(min, start + step)));
    }
    case 'counter':
      return min + tick * signal.period;
    case 'cycle': {
      const values = signal.values?.length ? signal.values : ['running', 'stopped'];
      // Each value lasts `period` seconds
      const index = Math.floor((tick * intervalMs) / 1000 / signal.period) % values.length;
      return values[index];
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function createSimulatorAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const intervalMs = Number(settings.intervalMs) || 1000;
  const signals = settings.signals as Signal[];
  const last: Record<string, number | string> = {};
  let timer: NodeJS.Timeout | null = null;
  let tick = 0;

  return {
    start() {
      events.onState('connected');
      timer = setInterval(() => {
        for (const signal of signals) {
          const previous = typeof last[signal.key] === 'number' ? (last[signal.key] as number) : undefined;
          last[signal.key] = simulatedValue(signal, tick, intervalMs, previous);
        }
        tick += 1;
        events.onMessage({ payload: JSON.stringify(last) });
      }, intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
