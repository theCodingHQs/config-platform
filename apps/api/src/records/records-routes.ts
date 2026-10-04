import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recordsService } from './records-service.js';
import { permissionService } from '../permissions/permission-service.js';
import { entityCache } from './entity-cache.js';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole } from '../auth/auth-types.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';

export async function recordsRoutes(fastify: FastifyInstance) {
  // POST /entities/:entityId/records - Create record (editor+)
  fastify.post('/entities/:entityId/records', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId } = req.params as { entityId: string };
    const body = (req.body as Record<string, any>) || {};

    // Resolve entity to get stable entityId for permission lookup
    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canCreate) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to create records' });
    }

    // Check record limit
    await tenantLimitsService.checkRecordLimit(tenantId, resolved.entity.physicalTableName);

    // Strip read-only and hidden fields from write payload
    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, role);
    const readOnlyFieldIds = await permissionService.getReadOnlyFieldIds(tenantId, resolved.entity.id, role);
    const filteredBody = filterWriteBody(body, resolved, hiddenFieldIds, readOnlyFieldIds, reply);
    if (filteredBody === null) return;

    const record = await recordsService.createRecord(tenantId, entityId, filteredBody);
    // Strip hidden fields from response
    return reply.status(201).send(stripHiddenFromRecord(record, resolved, hiddenFieldIds));
  });

  // GET /entities/:entityId/records - Query records with filter, sort, pagination
  fastify.get('/entities/:entityId/records', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId } = req.params as { entityId: string };
    const query = (req.query as Record<string, any>) || {};

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canRead) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to read records' });
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, role);

    // Reject filters/sorts on hidden fields
    const rejectHiddenErr = rejectHiddenInQuery(query, resolved, hiddenFieldIds);
    if (rejectHiddenErr) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: rejectHiddenErr });
    }

    const result = await recordsService.getRecords(tenantId, entityId, query);
    return {
      ...result,
      data: result.data.map((r) => stripHiddenFromRecord(r, resolved, hiddenFieldIds)),
    };
  });

  // GET /entities/:entityId/aggregate - Aggregate calculation
  fastify.get('/entities/:entityId/aggregate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId } = req.params as { entityId: string };
    const query = (req.query as Record<string, any>) || {};

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canRead) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to aggregate records' });
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, role);

    // Check if the aggregate field is hidden
    const aggField = query.field as string | undefined;
    if (aggField) {
      const fieldDef = resolved.fieldByName.get(aggField) || resolved.fieldById.get(aggField);
      if (fieldDef && hiddenFieldIds.has(fieldDef.id)) {
        return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: `Field '${aggField}' is not accessible` });
      }
    }

    return await recordsService.getAggregate(tenantId, entityId, query);
  });

  // GET /entities/:entityId/records/:id - Get single record
  fastify.get('/entities/:entityId/records/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId, id } = req.params as { entityId: string; id: string };

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canRead) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to read records' });
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, role);
    const record = await recordsService.getRecordById(tenantId, entityId, id);
    return stripHiddenFromRecord(record, resolved, hiddenFieldIds);
  });

  // PATCH /entities/:entityId/records/:id - Update record (editor+)
  fastify.patch('/entities/:entityId/records/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId, id } = req.params as { entityId: string; id: string };
    const body = (req.body as Record<string, any>) || {};

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canUpdate) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to update records' });
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, role);
    const readOnlyFieldIds = await permissionService.getReadOnlyFieldIds(tenantId, resolved.entity.id, role);
    const filteredBody = filterWriteBody(body, resolved, hiddenFieldIds, readOnlyFieldIds, reply);
    if (filteredBody === null) return;

    const record = await recordsService.updateRecord(tenantId, entityId, id, filteredBody);
    return stripHiddenFromRecord(record, resolved, hiddenFieldIds);
  });

  // DELETE /entities/:entityId/records/:id - Delete record (editor+)
  fastify.delete('/entities/:entityId/records/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { entityId, id } = req.params as { entityId: string; id: string };

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
    if (!perm.canDelete) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permission to delete records' });
    }

    return await recordsService.deleteRecord(tenantId, entityId, id);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHiddenFromRecord(
  record: Record<string, any>,
  resolved: import('./entity-cache.js').ResolvedEntity,
  hiddenFieldIds: Set<string>
): Record<string, any> {
  if (hiddenFieldIds.size === 0) return record;
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(record)) {
    const fieldDef = resolved.fieldByName.get(key);
    if (fieldDef && hiddenFieldIds.has(fieldDef.id)) continue;
    out[key] = val;
  }
  return out;
}

function rejectHiddenInQuery(
  query: Record<string, any>,
  resolved: import('./entity-cache.js').ResolvedEntity,
  hiddenFieldIds: Set<string>
): string | null {
  if (hiddenFieldIds.size === 0) return null;
  // Check filter keys
  for (const key of Object.keys(query)) {
    const filterMatch = key.match(/^filter\[([^\]]+)\]/);
    if (filterMatch) {
      const fieldName = filterMatch[1];
      const fieldDef = resolved.fieldByName.get(fieldName) || resolved.fieldById.get(fieldName);
      if (fieldDef && hiddenFieldIds.has(fieldDef.id)) {
        return `Field '${fieldName}' is not accessible`;
      }
    }
    if (key === 'sort') {
      const sortVal = String(query[key]).replace(/^-/, '');
      const fieldDef = resolved.fieldByName.get(sortVal) || resolved.fieldById.get(sortVal);
      if (fieldDef && hiddenFieldIds.has(fieldDef.id)) {
        return `Sort field '${sortVal}' is not accessible`;
      }
    }
  }
  return null;
}

function filterWriteBody(
  body: Record<string, any>,
  resolved: import('./entity-cache.js').ResolvedEntity,
  hiddenFieldIds: Set<string>,
  readOnlyFieldIds: Set<string>,
  reply: FastifyReply
): Record<string, any> | null {
  if (hiddenFieldIds.size === 0 && readOnlyFieldIds.size === 0) return body;

  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(body)) {
    const fieldDef = resolved.fieldByName.get(key) || resolved.fieldById.get(key);
    if (!fieldDef) {
      out[key] = val;
      continue;
    }
    if (hiddenFieldIds.has(fieldDef.id)) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Field '${key}' is not writable`,
      });
      return null;
    }
    if (readOnlyFieldIds.has(fieldDef.id)) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Field '${key}' is read-only`,
      });
      return null;
    }
    out[key] = val;
  }
  return out;
}
