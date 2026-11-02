/**
 * The shared library, inside one workspace. Everyone in it can load a shared item (pages show
 * drawings that place shared symbols); builders and above publish, use, install and unpublish.
 */
import type { FastifyInstance } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { auditLogService } from '../audit/audit-service.js';
import { guarded, idOf } from '../live/live-route-guard.js';
import { sharedService } from './shared-service.js';

export async function sharedRoutes(fastify: FastifyInstance) {
  fastify.get('/shared', guarded('viewer', async (req) => sharedService.list(req.session.tenantId, (req.query as { kind?: string }).kind)));

  fastify.get('/shared/:id', guarded('viewer', async (req) => sharedService.get(req.session.tenantId, idOf(req))));

  fastify.post('/shared', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const saved = await sharedService.publish(tenantId, userId, req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'shared.publish', entityType: 'shared_item', entityId: saved.id, afterState: { name: saved.name, version: saved.version } });
    return reply.status(saved.version === 1 ? 201 : 200).send(saved);
  }));

  // Builders apply a shared page or export template to their own page or export
  fastify.post('/shared/:id/use', { preHandler: csrfCheckHook }, guarded('builder', async (req) => sharedService.use(req.session.tenantId, idOf(req), req.body)));

  // Builders install a shared solution: first what it would do, then the install with their choices
  fastify.get('/shared/:id/install-plan', guarded('builder', async (req) => sharedService.installPlan(req.session.tenantId, idOf(req))));

  fastify.post('/shared/:id/install', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const result = await sharedService.install(tenantId, idOf(req), req.body, req.session);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'shared.install', entityType: 'shared_item', entityId: idOf(req), afterState: { created: result.created, reused: result.reused, pages: result.pages.length, exportTemplates: result.exportTemplates.length } });
    return reply.status(201).send(result);
  }));

  fastify.delete('/shared/:id', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const removed = await sharedService.unpublish(tenantId, idOf(req));
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'shared.unpublish', entityType: 'shared_item', entityId: removed.id, beforeState: { name: removed.name, version: removed.version } });
    return reply.status(204).send();
  }));
}
