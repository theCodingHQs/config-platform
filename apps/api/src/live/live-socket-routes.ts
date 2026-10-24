/**
 * GET /api/live/socket (WebSocket): the browser's one live connection. It must be inside the
 * signed-in routes, so req.session is set; the session is checked again every minute so a
 * logged-out or removed user stops receiving data.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { authService, SESSION_COOKIE } from '../auth/auth-service.js';
import { liveHub } from './live-hub.js';
import { LiveViewer } from './live-viewer.js';
import { recordEvents } from './record-events.js';
import { permissionService } from '../permissions/permission-service.js';

const SESSION_RECHECK_MS = 60_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

export async function liveSocketRoutes(fastify: FastifyInstance) {
  fastify.get('/live/socket', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const { tenantId, role } = req.session;
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const viewer = new LiveViewer(
      liveHub,
      tenantId,
      role,
      (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
      {
        subscribe: (listener) => recordEvents.subscribe(listener),
        canRead: async (entityId) => (await permissionService.getEntityPermission(tenantId, entityId, role)).canRead,
      },
    );

    const recheck = setInterval(async () => {
      const session = sessionId ? await authService.resolveSession(sessionId).catch(() => null) : null;
      if (!session || session.tenantId !== tenantId) socket.close(4401, 'Signed out');
    }, SESSION_RECHECK_MS);
    recheck.unref();

    socket.on('message', (data) => {
      const text = data.toString();
      if (text.length > MAX_MESSAGE_BYTES) return;
      viewer.handle(text);
    });
    socket.on('close', () => {
      clearInterval(recheck);
      viewer.close();
    });
  });
}
