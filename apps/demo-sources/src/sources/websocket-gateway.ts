/**
 * A machine gateway with a WebSocket stream (like Node-RED or a vendor gateway): it wants a
 * token, waits for a subscribe message, then streams JSON for the machines asked for:
 *   → {"subscribe":["m05"]}
 *   ← {"machine":"m05","ts":"…","data":{"status":"running","speed":29.4,…}}
 * and a heartbeat now and then, which the connection's `when` condition ignores.
 */
import { WebSocketServer } from 'ws';
import type { Plant } from '../plant/plant.js';

export function startWebSocketGateway(plant: Plant, port: number, token: string): () => Promise<void> {
  const wss = new WebSocketServer({ port, verifyClient: (info: { req: { headers: Record<string, unknown> } }) => info.req.headers.authorization === `Bearer ${token}` });
  wss.on('connection', (ws) => {
    let wanted = new Set<string>();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (Array.isArray(msg.subscribe)) wanted = new Set(msg.subscribe.map(String));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Send {"subscribe":["m05"]}' }));
      }
    });
    const offTick = plant.onTick((code, reading) => {
      if (wanted.has(code)) ws.send(JSON.stringify({ machine: code, ts: new Date().toISOString(), data: reading }));
    });
    const heartbeat = setInterval(() => ws.send(JSON.stringify({ type: 'heartbeat' })), 10_000);
    ws.on('close', () => {
      offTick();
      clearInterval(heartbeat);
    });
  });
  return () => new Promise((resolve) => wss.close(() => resolve()));
}
