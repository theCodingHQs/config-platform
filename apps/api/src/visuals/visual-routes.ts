/**
 * Visuals (Studio → Visuals). Everyone in the workspace can load one (pages show them); builders
 * and above create, change and delete them.
 */
import type { FastifyInstance } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { auditLogService } from '../audit/audit-service.js';
import { guarded, idOf } from '../live/live-route-guard.js';
import { visualService } from './visual-service.js';

export async function visualRoutes(fastify: FastifyInstance) {
  fastify.get('/visuals', guarded('builder', async (req) => visualService.list(req.session.tenantId)));

  fastify.get('/visuals/:id', guarded('viewer', async (req) => visualService.get(req.session.tenantId, idOf(req))));

  fastify.post('/visuals', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const saved = await visualService.create(tenantId, userId, req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'visual.create', entityType: 'visual', entityId: saved.id, afterState: { name: saved.name } });
    return reply.status(201).send(saved);
  }));

  fastify.put('/visuals/:id', { preHandler: csrfCheckHook }, guarded('builder', async (req) => {
    const { tenantId, userId, email } = req.session;
    const { before, after } = await visualService.update(tenantId, idOf(req), req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'visual.update', entityType: 'visual', entityId: after.id, beforeState: { name: before.name, version: before.version }, afterState: { name: after.name, version: after.version } });
    return after;
  }));

  fastify.delete('/visuals/:id', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const removed = await visualService.remove(tenantId, idOf(req));
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'visual.delete', entityType: 'visual', entityId: removed.id, beforeState: { name: removed.name } });
    return reply.status(204).send();
  }));
}
