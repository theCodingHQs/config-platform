/**
 * POST /api/live/push/:connectionId — where devices and systems send messages to an HTTP push
 * connection. Not a signed-in route: the connection's token is the key, sent as
 *   Authorization: Bearer <token>   (or an X-Live-Token header)
 * The body is the message (JSON or text); ?topic=… is passed to tag rules like an MQTT topic.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { deliverPush } from './adapters/http-push-adapter.js';

const MAX_BODY_BYTES = 256 * 1024;

function tokenOf(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers['x-live-token'];
  return typeof header === 'string' ? header.trim() : null;
}

export async function livePushRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/live/push/:connectionId',
    { bodyLimit: MAX_BODY_BYTES, config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = tokenOf(req);
      if (!token) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Send the connection token as "Authorization: Bearer <token>"' });
      const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      const topic = (req.query as { topic?: string }).topic;
      const result = deliverPush((req.params as { connectionId: string }).connectionId, token, payload, typeof topic === 'string' ? topic : undefined);
      if (result === 'unknown') return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No such connection, or it is switched off' });
      if (result === 'forbidden') return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong token for this connection' });
      return reply.status(202).send({ accepted: true });
    },
  );
}
