/**
 * A vendor's REST API, the kind an HTTP polling connection reads every few seconds:
 *   GET /api/machines/m06   (X-Api-Key header)
 *   → {"id":"m06","state":{"status":"running"},"metrics":{"speed":5.8,…}}
 * The nesting is different from the other sources on purpose: tag rules pick values from
 * wherever they are.
 */
import { createServer, type Server } from 'node:http';
import type { Plant } from '../plant/plant.js';

export function startRestApi(plant: Plant, port: number, apiKey: string): () => Promise<void> {
  const server: Server = createServer((req, res) => {
    const match = /^\/api\/machines\/(m\d+)$/.exec(req.url ?? '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-api-key'] !== apiKey) return send(401, { error: 'Missing or wrong X-Api-Key' });
    if (req.method !== 'GET' || !match) return send(404, { error: 'Try GET /api/machines/m06' });
    try {
      const { status, ...metrics } = plant.reading(match[1]);
      send(200, { id: match[1], state: { status }, metrics, readAt: new Date().toISOString() });
    } catch {
      send(404, { error: `No machine ${match[1]}` });
    }
  });
  server.listen(port);
  return () => new Promise((resolve) => server.close(() => resolve()));
}
