/**
 * Live rules (Studio → Live → Rules). Builders can see rules and their runs; only admins and
 * owners change them, since rules write records on their own.
 */
import type { FastifyInstance } from 'fastify';
import { csrfCheckHook } from '../../auth/session-middleware.js';
import { auditLogService } from '../../audit/audit-service.js';
import { guarded, idOf } from '../live-route-guard.js';
import { liveRuleService } from './live-rule-service.js';

export async function liveRuleRoutes(fastify: FastifyInstance) {
  fastify.get('/live/rules', guarded('builder', async (req) => liveRuleService.list(req.session.tenantId)));

  fastify.get('/live/rules/:id/runs', guarded('builder', async (req) => liveRuleService.runs(req.session.tenantId, idOf(req))));

  fastify.post('/live/rules', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const saved = await liveRuleService.create(tenantId, userId, req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.rule.create', entityType: 'live_rule', entityId: saved.id, afterState: saved });
    return reply.status(201).send(saved);
  }));

  fastify.put('/live/rules/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req) => {
    const { tenantId, userId, email } = req.session;
    const { before, after } = await liveRuleService.update(tenantId, idOf(req), userId, req.body);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.rule.update', entityType: 'live_rule', entityId: after.id, beforeState: before, afterState: after });
    return after;
  }));

  fastify.delete('/live/rules/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const removed = await liveRuleService.remove(tenantId, idOf(req));
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.rule.delete', entityType: 'live_rule', entityId: removed.id, beforeState: removed });
    return reply.status(204).send();
  }));
}
