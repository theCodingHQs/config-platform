/**
 * A device that sends its own readings to the app (HTTP push): every few seconds it POSTs to the
 * connection's address with the connection's token. Nothing listens here; the app does.
 */
import type { Plant } from '../plant/plant.js';

export interface PushTarget {
  platformUrl: string;
  connectionId: string;
  token: string;
}

export function startHttpPusher(plant: Plant, code: string, target: PushTarget, everyMs = 2000, log = console.log): () => Promise<void> {
  const url = `${target.platformUrl}/api/live/push/${target.connectionId}`;
  let lastProblem = '';
  const send = async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ device: code, ...plant.reading(code), sentAt: new Date().toISOString() }),
      });
      const problem = res.ok ? '' : `HTTP push got ${res.status}: ${await res.text()}`;
      if (problem && problem !== lastProblem) log(problem);
      lastProblem = problem;
    } catch (err) {
      const problem = `HTTP push can't reach ${url}: ${(err as Error).message}`;
      if (problem !== lastProblem) log(problem);
      lastProblem = problem;
    }
  };
  const timer = setInterval(() => void send(), everyMs);
  return async () => clearInterval(timer);
}
