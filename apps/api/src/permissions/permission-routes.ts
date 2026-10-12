import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { permissionService } from './permission-service.js';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole, isValidRole } from '../auth/auth-types.js';
import type { TenantRole } from '../auth/auth-types.js';
import { auditLogService } from '../audit/audit-service.js';

export async function permissionRoutes(fastify: FastifyInstance) {
  // GET /schema/entities/:entityId/permissions - Get entity permissions matrix (builder+)
  fastify.get('/schema/entities/:entityId/permissions', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { tenantId } = req.session;
    const { entityId } = req.params as { entityId: string };
    return await permissionService.getEntityPermissions(tenantId, entityId);
  });

  // PUT /schema/entities/:entityId/permissions/:role - Set entity permission (admin+)
  fastify.put('/schema/entities/:entityId/permissions/:role', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { tenantId } = req.session;
    const { entityId, role } = req.params as { entityId: string; role: string };
    if (!isValidRole(role)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }
    const { canRead, canCreate, canUpdate, canDelete, canExport } = (req.body as any) || {};
    const perm = {
      canRead: Boolean(canRead),
      canCreate: Boolean(canCreate),
      canUpdate: Boolean(canUpdate),
      canDelete: Boolean(canDelete),
      canExport: canExport !== undefined ? Boolean(canExport) : (role === 'viewer' ? false : true),
    };
    await permissionService.setEntityPermission(tenantId, entityId, role as TenantRole, perm);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'permission.entity.update',
      entityType: 'permission',
      entityId: `${entityId}:${role}`,
      afterState: perm,
    });

    return { success: true };
  });

  // GET /schema/entities/:entityId/fields/permissions - Get all field permissions (builder+)
  fastify.get('/schema/entities/:entityId/fields/permissions', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { tenantId } = req.session;
    const { entityId } = req.params as { entityId: string };
    return await permissionService.getAllFieldPermissions(tenantId, entityId);
  });

  // PUT /schema/entities/:entityId/fields/:fieldId/permissions/:role - Set field permission (admin+)
  fastify.put('/schema/entities/:entityId/fields/:fieldId/permissions/:role', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { tenantId } = req.session;
    const { entityId, fieldId, role } = req.params as { entityId: string; fieldId: string; role: string };
    if (!isValidRole(role)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }
    const { hidden, readOnly } = (req.body as any) || {};
    const perm = {
      hidden: Boolean(hidden),
      readOnly: Boolean(readOnly),
    };
    await permissionService.setFieldPermission(tenantId, entityId, fieldId, role as TenantRole, perm);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'permission.field.update',
      entityType: 'permission',
      entityId: `${entityId}:${fieldId}:${role}`,
      afterState: perm,
    });

    return { success: true };
  });
}
