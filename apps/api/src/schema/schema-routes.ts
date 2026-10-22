import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  CreateEntityInputSchema,
  UpdateEntityInputSchema,
  AddFieldInputSchema,
  UpdateFieldInputSchema,
  SetUniqueRulesInputSchema,
  DropFieldInputSchema,
  DropEntityInputSchema,
  AddRelationInputSchema,
} from '@config-platform/schema';
import { migrationService } from '../migrations/migration-service.js';
import { erdService } from './erd-service.js';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole } from '../auth/auth-types.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { auditLogService } from '../audit/audit-service.js';

/** Only builder+ may manage schema */
function requireBuilder(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!hasMinRole(req.session.role, 'builder')) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    return false;
  }
  return true;
}

export async function schemaRoutes(fastify: FastifyInstance) {
  // GET /schema/erd - Live ERD derived from metadata
  fastify.get('/schema/erd', async (req: FastifyRequest) => {
    const { tenantId } = req.session;
    return await erdService.getLiveErd(tenantId);
  });

  // GET /schema/ddl - Live DDL derived from metadata (builder+)
  fastify.get('/schema/ddl', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const ddl = await erdService.getLiveDDL(tenantId);
    reply.type('text/plain');
    return ddl;
  });

  // GET /schema/migrations - Migration history (builder+)
  fastify.get('/schema/migrations', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    return await migrationService.getMigrations(tenantId);
  });

  // GET /schema/entities - List all entities with their fields
  fastify.get('/schema/entities', async (req: FastifyRequest) => {
    const { tenantId } = req.session;
    const erd = await erdService.getLiveErd(tenantId);
    return erd.tables;
  });

  // POST /schema/entities - Create new entity (builder+)
  fastify.post('/schema/entities', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const parsed = CreateEntityInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    await tenantLimitsService.checkEntityLimit(tenantId);

    const result = await migrationService.createEntity(tenantId, parsed.data);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'entity.create',
      entityType: 'entity',
      entityId: result.entityId || result.entity.id,
      afterState: result.entity,
    });

    return reply.status(201).send(result);
  });

  // PUT /schema/entities/:id - Update entity (builder+)
  // PUT /schema/entities/:id/unique-rules - Field combinations no two records may share (builder+)
  fastify.put('/schema/entities/:id/unique-rules', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const parsed = SetUniqueRulesInputSchema.safeParse({ ...(req.body as any), entityId: id });
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    const result = await migrationService.setUniqueRules(tenantId, parsed.data);
    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'entity.unique_rules.update',
      entityType: 'entity',
      entityId: id,
      afterState: { uniqueRules: result.uniqueRules },
    });
    return result;
  });

  fastify.put('/schema/entities/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const parsed = UpdateEntityInputSchema.safeParse({
      ...(req.body as any),
      entityId: id,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    const result = await migrationService.updateEntity(tenantId, parsed.data);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'entity.update',
      entityType: 'entity',
      entityId: id,
      afterState: result.entity,
    });

    return result;
  });

  // DELETE /schema/entities/:id - Drop entity (builder+)
  fastify.delete('/schema/entities/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const query = req.query as { expectedVersion?: string };
    const expectedVersion = Number(query.expectedVersion || (req.body as any)?.expectedVersion);
    const parsed = DropEntityInputSchema.safeParse({
      entityId: id,
      expectedVersion,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    const result = await migrationService.dropEntity(tenantId, parsed.data);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'entity.drop',
      entityType: 'entity',
      entityId: id,
    });

    return result;
  });

  // POST /schema/entities/:id/fields - Add field (builder+)
  fastify.post('/schema/entities/:id/fields', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const parsed = AddFieldInputSchema.safeParse({
      ...(req.body as any),
      entityId: id,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    await tenantLimitsService.checkFieldLimit(tenantId, id);

    const result = await migrationService.addField(tenantId, parsed.data);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'field.create',
      entityType: 'field',
      entityId: result.field?.id || id,
      afterState: result.field,
    });

    return reply.status(201).send(result);
  });

  // PUT /schema/entities/:id/fields/:fieldId - Update field (builder+)
  fastify.put(
    '/schema/entities/:id/fields/:fieldId',
    {
      preHandler: csrfCheckHook,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireBuilder(req, reply)) return;
      const { tenantId } = req.session;
      const { id, fieldId } = req.params as { id: string; fieldId: string };
      const parsed = UpdateFieldInputSchema.safeParse({
        ...(req.body as any),
        entityId: id,
        fieldId,
      });
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.format() });
      }
      const result = await migrationService.updateField(tenantId, parsed.data);

      await auditLogService.log({
        tenantId,
        userId: req.session.userId,
        userEmail: req.session.email,
        action: 'field.update',
        entityType: 'field',
        entityId: fieldId,
        afterState: result.field,
      });

      return result;
    }
  );

  // DELETE /schema/entities/:id/fields/:fieldId - Drop field (builder+)
  fastify.delete(
    '/schema/entities/:id/fields/:fieldId',
    {
      preHandler: csrfCheckHook,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireBuilder(req, reply)) return;
      const { tenantId } = req.session;
      const { id, fieldId } = req.params as { id: string; fieldId: string };
      const expectedVersion = Number(
        (req.query as any)?.expectedVersion || (req.body as any)?.expectedVersion
      );
      const parsed = DropFieldInputSchema.safeParse({
        entityId: id,
        fieldId,
        expectedVersion,
      });
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.format() });
      }
      const result = await migrationService.dropField(tenantId, parsed.data);

      await auditLogService.log({
        tenantId,
        userId: req.session.userId,
        userEmail: req.session.email,
        action: 'field.drop',
        entityType: 'field',
        entityId: fieldId,
      });

      return result;
    }
  );

  // PUT /schema/entities/:id/fields/reorder - Reorder fields (builder+)
  fastify.put('/schema/entities/:id/fields/reorder', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const { fieldIds } = (req.body as any) || {};
    if (!Array.isArray(fieldIds)) {
      return reply.status(400).send({ error: 'fieldIds must be an array of strings' });
    }
    await migrationService.reorderFields(tenantId, id, fieldIds);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'field.reorder',
      entityType: 'entity',
      entityId: id,
      afterState: { fieldIds },
    });

    return { success: true };
  });

  // POST /schema/relations - Add foreign key relation (builder+)
  fastify.post('/schema/relations', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireBuilder(req, reply)) return;
    const { tenantId } = req.session;
    const parsed = AddRelationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    const result = await migrationService.addRelation(tenantId, parsed.data);
    return reply.status(201).send(result);
  });
}
