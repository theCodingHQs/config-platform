/**
 * Live connection settings (Studio → Live). Builders can see connections, tags and recent
 * messages (to bind pages); only admins and owners change connections, since they hold
 * passwords and reach into the factory's network.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole, type TenantRole } from '../auth/auth-types.js';
import { auditLogService } from '../audit/audit-service.js';
import { liveHub } from './live-hub.js';
import { liveConnectionService, LiveConnectionError } from './live-connection-service.js';

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Runs a handler for `minRole` and above, turning LiveConnectionError into its status code */
const guarded = (minRole: TenantRole, handler: Handler): Handler => async (req, reply) => {
  if (!hasMinRole(req.session.role, minRole)) {
    const who = minRole === 'admin' ? 'Admins and owners' : 'Builders, admins and owners';
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: `${who} can do this` });
  }
  try {
    return await handler(req, reply);
  } catch (err) {
    if (err instanceof LiveConnectionError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message });
    }
    throw err;
  }
};

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export async function liveRoutes(fastify: FastifyInstance) {
  fastify.get('/live/connections', guarded('builder', async (req) => liveConnectionService.list(req.session.tenantId)));

  fastify.get('/live/tags', guarded('builder', async (req) => liveConnectionService.tags(req.session.tenantId)));

  fastify.get('/live/connections/:id/messages', guarded('builder', async (req) => liveHub.recentMessages(req.session.tenantId, idOf(req))));

  fastify.post('/live/connections', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const saved = await liveConnectionService.create(tenantId, userId, req.body);
    await auditLogService.log({
      tenantId, userId, userEmail: email,
      action: 'live.connection.create', entityType: 'live_connection', entityId: saved.id,
      afterState: saved, // secrets are never in it
    });
    return reply.status(201).send(saved);
  }));

  fastify.put('/live/connections/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req) => {
    const { tenantId, userId, email } = req.session;
    const { before, after } = await liveConnectionService.update(tenantId, idOf(req), req.body);
    await auditLogService.log({
      tenantId, userId, userEmail: email,
      action: 'live.connection.update', entityType: 'live_connection', entityId: after.id,
      beforeState: before, afterState: after,
    });
    return after;
  }));

  fastify.delete('/live/connections/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const removed = await liveConnectionService.remove(tenantId, idOf(req));
    await auditLogService.log({
      tenantId, userId, userEmail: email,
      action: 'live.connection.delete', entityType: 'live_connection', entityId: removed.id,
      beforeState: removed,
    });
    return reply.status(204).send();
  }));
}
