import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { auditLogService } from './audit-service.js';
import { hasMinRole } from '../auth/auth-types.js';

export async function auditRoutes(fastify: FastifyInstance) {
  // GET /audit-logs - Query audit trail for tenant (admin+ only)
  fastify.get('/audit-logs', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    if (!hasMinRole(role, 'admin')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin role or higher required to view audit logs',
      });
    }

    const query = (req.query as any) || {};
    const limit = parseInt(query.limit, 10) || 50;
    const offset = parseInt(query.offset, 10) || 0;
    const entityType = query.entityType as string | undefined;
    const action = query.action as string | undefined;

    const logs = await auditLogService.getLogs(tenantId, { limit, offset, entityType, action });
    return logs;
  });
}
