/**
 * The shared library. Everyone in a workspace can load a shared item (pages show drawings that
 * place shared symbols); builders and above publish and unpublish their workspace's items;
 * platform owners share any item with every workspace.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { auditLogService } from '../audit/audit-service.js';
import { guarded, idOf } from '../live/live-route-guard.js';
import { LiveSettingsError } from '../live/live-errors.js';
import { platformSettings } from '../platform/platform-settings.js';
import { sharedService } from './shared-service.js';

// Checked against the database, not the session, so a removed platform owner loses this at once
const isPlatformOwner = (req: FastifyRequest) => platformSettings.isPlatformAdmin(req.session.userId);

export async function sharedRoutes(fastify: FastifyInstance) {
  fastify.get('/shared', guarded('viewer', async (req) => {
    const { kind, all } = req.query as { kind?: string; all?: string };
    const everyWorkspace = all === 'true' && (await isPlatformOwner(req));
    return sharedService.list(req.session.tenantId, kind, everyWorkspace);
  }));

  fastify.get('/shared/:id', guarded('viewer', async (req) => sharedService.get(req.session.tenantId, idOf(req))));

  fastify.post('/shared', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const saved = await sharedService.publish(tenantId, userId, req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'shared.publish', entityType: 'shared_item', entityId: saved.id, afterState: { name: saved.name, version: saved.version } });
    return reply.status(saved.version === 1 ? 201 : 200).send(saved);
  }));

  fastify.put('/shared/:id/everywhere', { preHandler: csrfCheckHook }, guarded('viewer', async (req) => {
    if (!(await isPlatformOwner(req))) throw new LiveSettingsError('Only platform owners can share with every workspace', 403);
    const everywhere = (req.body as { everywhere?: unknown } | null)?.everywhere;
    if (typeof everywhere !== 'boolean') throw new LiveSettingsError('everywhere must be true or false');
    const { tenantId, userId, email } = req.session;
    const result = await sharedService.setEverywhere(idOf(req), everywhere);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: everywhere ? 'shared.everywhere' : 'shared.workspace-only', entityType: 'shared_item', entityId: result.id, afterState: result });
    return result;
  }));

  fastify.delete('/shared/:id', { preHandler: csrfCheckHook }, guarded('builder', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const removed = await sharedService.unpublish(tenantId, idOf(req));
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'shared.unpublish', entityType: 'shared_item', entityId: removed.id, beforeState: { name: removed.name, version: removed.version } });
    return reply.status(204).send();
  }));
}
