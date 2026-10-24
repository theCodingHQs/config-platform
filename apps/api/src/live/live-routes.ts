/**
 * Live connection settings (Studio → Live). Builders can see connections, tags and recent
 * messages (to bind pages); only admins and owners change connections, since they hold
 * passwords and reach into the factory's network.
 */
import type { FastifyInstance } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { auditLogService } from '../audit/audit-service.js';
import { liveHub } from './live-hub.js';
import { liveConnectionService } from './live-connection-service.js';
import { guarded, idOf } from './live-route-guard.js';


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

  fastify.post('/live/connections/:id/push-token', { preHandler: csrfCheckHook }, guarded('admin', async (req) => {
    const { tenantId, userId, email } = req.session;
    const result = await liveConnectionService.newPushToken(tenantId, idOf(req));
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.connection.push_token', entityType: 'live_connection', entityId: idOf(req) });
    return result;
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
