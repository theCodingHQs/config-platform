import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole } from '../auth/auth-types.js';
import { auditLogService } from '../audit/audit-service.js';
import { listSolutionTemplates, solutionTemplateService } from './solution-template-service.js';

/** Template gallery: ready-made apps (Production Tracker, Maintenance Log, …). */
export async function solutionTemplateRoutes(fastify: FastifyInstance) {
  // GET /solution-templates - The gallery
  fastify.get('/solution-templates', async () => listSolutionTemplates());

  // POST /solution-templates/:id/install - Install into this workspace (builder+)
  fastify.post('/solution-templates/:id/install', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role, userId, email } = req.session;
    if (!hasMinRole(role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { id } = req.params as { id: string };
    const sampleData = (req.body as any)?.sampleData !== false;
    const result = await solutionTemplateService.install(tenantId, id, { sampleData });
    await auditLogService.log({
      tenantId,
      userId,
      userEmail: email,
      action: 'solution_template.install',
      entityType: 'workspace',
      entityId: tenantId,
      afterState: { templateId: id, sampleData, entities: result.entities.length, pages: result.pages.length },
    });
    return reply.status(201).send(result);
  });
}
