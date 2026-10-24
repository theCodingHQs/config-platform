/**
 * GET /api/live/agent (WebSocket): where edge agents connect, from inside the factory network
 * (outbound only). Not a signed-in route: the agent's token is its key, sent as
 * Authorization: Bearer <token>; a wrong token is refused before the socket opens.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AgentToServer } from '@config-platform/schema';
import { agentRepository, type StoredAgent } from './agent-repository.js';
import { agentGateway } from './agent-gateway.js';

const HEARTBEAT_MS = 30_000;

declare module 'fastify' {
  interface FastifyRequest {
    liveAgent?: StoredAgent;
  }
}

async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  const token = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const agent = token ? await agentRepository.byToken(token) : null;
  if (!agent) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unknown edge agent token' });
  req.liveAgent = agent;
}

export async function agentSocketRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/live/agent',
    { websocket: true, preValidation: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    (socket: WebSocket, req: FastifyRequest) => {
      const agent = req.liveAgent!;
      const handle = { send: (text: string) => socket.readyState === socket.OPEN && socket.send(text), close: (code?: number, reason?: string) => socket.close(code, reason) };
      agentGateway.connected(agent.id, handle);

      // Online while connected; pings keep proxies and firewalls from dropping an idle socket
      const heartbeat = setInterval(() => {
        handle.send(JSON.stringify({ type: 'ping' }));
        void agentRepository.markOnline(agent.id).catch(() => undefined);
      }, HEARTBEAT_MS);
      heartbeat.unref();

      socket.on('message', (data) => {
        let message: AgentToServer;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message.type === 'hello') {
          void agentRepository.markOnline(agent.id, { version: String(message.version ?? ''), hostname: String(message.hostname ?? '') }).catch(() => undefined);
        }
        agentGateway.received(agent.id, handle, message);
      });
      socket.on('close', () => {
        clearInterval(heartbeat);
        agentGateway.disconnected(agent.id, handle);
        void agentRepository.markOffline(agent.id).catch(() => undefined);
      });
    },
  );
}
