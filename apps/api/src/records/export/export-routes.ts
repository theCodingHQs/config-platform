import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { csrfCheckHook } from '../../auth/session-middleware.js';
import { hasMinRole } from '../../auth/auth-types.js';
import { permissionService } from '../../permissions/permission-service.js';
import { entityCache } from '../entity-cache.js';
import { exportTemplateService } from './export-template-service.js';
import { exportService, ExportForbiddenError } from './export-service.js';
import { downloadTokenStore } from './download-token-store.js';
import { buildSafeContentDisposition } from './export-sanitizer.js';
import { tenantLimitsService } from '../../limits/tenant-limits.js';
import { validateGridCaps, validateGridFormulas } from '@config-platform/schema';

export async function exportRoutes(fastify: FastifyInstance) {
  // ─── Download Flow ────────────────────────────────────────────────────────

  /**
   * POST /exports
   * Creates short-lived (60s), single-use download token bound to user, tenant, and params
   */
  fastify.post(
    '/exports',
    {
      preHandler: csrfCheckHook,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId, email, role } = req.session;
      const userEmail = email;
      const body = (req.body as any) || {};
      const { templateId, entityId, format = 'xlsx', filters, parameters } = body;

      if (!entityId && !templateId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'entityId or templateId is required',
        });
      }

      let targetEntityId = entityId;
      let targetTemplate: any = null;
      if (templateId) {
        targetTemplate = await exportTemplateService.getTemplate(tenantId, templateId);
        if (!targetEntityId) {
          targetEntityId = targetTemplate.entityId;
        }
      }

      const resolved = await entityCache.resolveEntity(tenantId, targetEntityId);
      if (!resolved) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Entity '${targetEntityId}' not found`,
        });
      }

      // Check entity read permission
      const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, role);
      if (!perm.canRead) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Insufficient permission to read entity',
        });
      }

      // Check canExport permission
      if (!perm.canExport) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Role '${role}' does not have export permission on this entity`,
        });
      }

      if (!['xlsx', 'csv', 'pdf'].includes(format)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid export format '${format}'. Supported formats: xlsx, csv, pdf`,
        });
      }

      const isGrid = Boolean(
        targetTemplate &&
          (targetTemplate.draft?.kind === 'grid' || targetTemplate.published?.kind === 'grid')
      );
      if (isGrid && format !== 'xlsx') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Grid templates only support XLSX format. CSV and PDF are not supported for grid templates.',
        });
      }

      // Check required parameters on grid template
      if (targetTemplate) {
        const tplDef = targetTemplate.published || targetTemplate.draft;
        if (tplDef && Array.isArray(tplDef.parameters)) {
          for (const p of tplDef.parameters) {
            if (p.required) {
              const val = parameters?.[p.name] ?? parameters?.[p.id];
              if (val === undefined || val === null || val === '') {
                return reply.status(400).send({
                  statusCode: 400,
                  error: 'Bad Request',
                  message: `Missing required parameter '${p.label || p.name}'`,
                  missingParameter: p,
                });
              }
            }
          }
        }
      }

      const { token, expiresIn } = downloadTokenStore.createToken({
        tenantId,
        userId,
        userEmail,
        userRole: role,
        templateId,
        entityId: resolved.entity.id,
        format,
        filters,
        parameters,
        ttlSeconds: 60,
      });

      return reply.status(200).send({
        token,
        expiresIn,
        downloadUrl: `/api/exports/${token}`,
      });
    }
  );

  /**
   * GET /exports/:token
   * Single-use stream download with cookie auth
   */
  fastify.get('/exports/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const { tenantId, userId, role } = req.session;

    const payload = downloadTokenStore.consumeToken(token);
    if (!payload) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Download token is invalid, expired, or has already been used',
      });
    }

    // Cross-tenant and user binding check
    if (payload.tenantId !== tenantId || payload.userId !== userId) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Download token is not valid for this tenant/user session',
      });
    }

    try {
      await exportService.streamExport(
        {
          tenantId,
          userId,
          userEmail: payload.userEmail,
          userRole: role, // Exporter's current session role applies
          entityId: payload.params.entityId,
          format: payload.params.format,
          templateId: payload.params.templateId,
          filters: payload.params.filters,
          parameters: payload.params.parameters,
        },
        reply
      );
    } catch (err: any) {
      if (err instanceof ExportForbiddenError) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: err.message,
        });
      }
      if (err.statusCode) {
        return reply.status(err.statusCode).send({
          statusCode: err.statusCode,
          error: err.statusCode === 501 ? 'Not Implemented' : 'Error',
          message: err.message,
        });
      }
      throw err;
    }
  });

  /**
   * GET /entities/:id/import-template
   * Headers only, matching the importer's field labels
   */
  fastify.get('/entities/:id/import-template', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { id } = req.params as { id: string };
    const query = (req.query as any) || {};
    const format = query.format === 'xlsx' ? 'xlsx' : 'csv';

    await exportService.generateImportTemplate(tenantId, id, role, format, reply);
  });

  // ─── Export Templates CRUD (builder+) ────────────────────────────────────

  fastify.get('/export-templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    if (!hasMinRole(role, 'builder')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Builder role or higher required to manage export templates',
      });
    }

    const query = (req.query as any) || {};
    const templates = await exportTemplateService.listTemplates(tenantId, query.entityId);
    return reply.status(200).send(templates);
  });

  fastify.post(
    '/export-templates',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required to create export templates',
        });
      }

      const body = req.body as any;
      if (!body?.name || !body?.entityId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'name and entityId are required',
        });
      }

      const created = await exportTemplateService.createTemplate(tenantId, body);
      return reply.status(201).send(created);
    }
  );

  fastify.get('/export-templates/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    if (!hasMinRole(role, 'builder')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Builder role or higher required',
      });
    }

    const { id } = req.params as { id: string };
    const template = await exportTemplateService.getTemplate(tenantId, id);
    return reply.status(200).send(template);
  });

  fastify.put(
    '/export-templates/:id',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required',
        });
      }

      const { id } = req.params as { id: string };
      const updated = await exportTemplateService.updateTemplate(tenantId, id, req.body as any);
      return reply.status(200).send(updated);
    }
  );

  fastify.delete(
    '/export-templates/:id',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required',
        });
      }

      const { id } = req.params as { id: string };
      await exportTemplateService.deleteTemplate(tenantId, id);
      return reply.status(200).send({ success: true });
    }
  );

  fastify.post(
    '/export-templates/:id/publish',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required',
        });
      }

      const { id } = req.params as { id: string };
      const published = await exportTemplateService.publishTemplate(tenantId, id);
      return reply.status(200).send(published);
    }
  );

  fastify.post(
    '/export-templates/:id/duplicate',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required',
        });
      }

      const { id } = req.params as { id: string };
      const duplicated = await exportTemplateService.duplicateTemplate(tenantId, id);
      return reply.status(201).send(duplicated);
    }
  );

  fastify.get(
    '/export-templates/:id/preview',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      const { id } = req.params as { id: string };

      const template = await exportTemplateService.getTemplate(tenantId, id);
      const def = template.draft;
      const preview = await exportService.previewRows(tenantId, template.entityId, role, def);
      return reply.status(200).send(preview);
    }
  );

  fastify.post(
    '/export-templates/:id/preview',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      const { id } = req.params as { id: string };
      const body = (req.body as any) || {};

      const template = await exportTemplateService.getTemplate(tenantId, id);
      const def = body.draft || template.draft;
      const preview = await exportService.previewRows(tenantId, template.entityId, role, def);
      return reply.status(200).send(preview);
    }
  );

  /**
   * POST /export-templates/:id/render-preview
   * Renders the STORED draft (never body-supplied) to XLSX with static content only.
   * Builder role or above, tenant-scoped, rate-limited, behind CSRF, counted against concurrent export limit.
   */
  fastify.post(
    '/export-templates/:id/render-preview',
    {
      preHandler: csrfCheckHook,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required to render template preview',
        });
      }

      const { id } = req.params as { id: string };
      const template = await exportTemplateService.getTemplate(tenantId, id);
      const draft = template.draft;

      if (!draft || draft.kind !== 'grid') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Only grid templates can be rendered as XLSX preview',
        });
      }

      // Enforce caps and formula validation on stored draft
      const caps = validateGridCaps(draft as any);
      if (!caps.valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: caps.errors.join('; '),
        });
      }

      const formulas = validateGridFormulas(draft as any);
      if (!formulas.valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: formulas.errors.join('; '),
        });
      }

      const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
      try {
        const query = (req.query as any) || {};
        const withData = query.withData === 'true' || query.mode === 'data';
        let buffer: Buffer;

        if (withData) {
          const { gridHydrator } = await import('./grid-hydrator.js');
          buffer = await gridHydrator.renderHydratedToBuffer(draft as any, {
            tenantId,
            userRole: role,
            maxRows: 50,
          });
        } else {
          const { renderGridTemplateToXlsxBuffer } = await import('./grid-xlsx-renderer.js');
          buffer = await renderGridTemplateToXlsxBuffer(draft as any);
        }

        const filename = `${template.name || 'preview'}.xlsx`;

        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', buildSafeContentDisposition(filename));
        return reply.send(buffer);
      } finally {
        releaseSlot();
      }
    }
  );

  /**
   * POST /export-templates/:id/preview-data
   * Hydrates the STORED draft with live tenant records (first 50 rows) for the designer's "Preview with data" mode.
   * Returns JSON preview of the hydrated template definition.
   */
  fastify.post(
    '/export-templates/:id/preview-data',
    {
      preHandler: csrfCheckHook,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Builder role or higher required to preview template data',
        });
      }

      const { id } = req.params as { id: string };
      const template = await exportTemplateService.getTemplate(tenantId, id);
      const draft = template.draft;

      if (!draft || draft.kind !== 'grid') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Only grid templates support preview data',
        });
      }

      const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
      try {
        const { gridHydrator } = await import('./grid-hydrator.js');
        const hydratedDraft = await gridHydrator.hydrateGridDefinition(draft as any, {
          tenantId,
          userRole: role,
          maxRows: 50,
        });
        return reply.status(200).send({ draft: hydratedDraft });
      } finally {
        releaseSlot();
      }
    }
  );

  fastify.post(
    '/export-templates/preview',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      const body = (req.body as any) || {};
      if (!body.entityId || !body.draft) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'entityId and draft are required for preview',
        });
      }

      const preview = await exportService.previewRows(tenantId, body.entityId, role, body.draft);
      return reply.status(200).send(preview);
    }
  );

  fastify.post(
    '/export-templates/:id/dataset-preview',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      const { id } = req.params as { id: string };
      const body = (req.body as any) || {};

      const template = await exportTemplateService.getTemplate(tenantId, id);
      const draft = template.draft;
      let targetDataset = body.dataset;
      if (!targetDataset && body.datasetId && Array.isArray((draft as any)?.datasets)) {
        targetDataset = (draft as any).datasets.find((d: any) => d.id === body.datasetId);
      }

      if (!targetDataset) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Dataset definition or valid datasetId required for preview',
        });
      }

      const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
      try {
        const { datasetQueryBuilder } = await import('./dataset-query-builder.js');
        const preview = await datasetQueryBuilder.executeDataset({
          tenantId,
          dataset: targetDataset,
          userRole: role,
          parameters: body.parameters || {},
          templateParameters: (draft as any)?.parameters || [],
          maxRows: 50,
        });
        return reply.status(200).send(preview);
      } finally {
        releaseSlot();
      }
    }
  );

  fastify.post(
    '/export-templates/dataset-preview',
    { preHandler: csrfCheckHook },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      const body = (req.body as any) || {};
      const targetDataset = body.dataset;

      if (!targetDataset || !targetDataset.source?.baseEntityId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Valid dataset definition required for preview',
        });
      }

      const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
      try {
        const { datasetQueryBuilder } = await import('./dataset-query-builder.js');
        const preview = await datasetQueryBuilder.executeDataset({
          tenantId,
          dataset: targetDataset,
          userRole: role,
          parameters: body.parameters || {},
          templateParameters: body.parametersDefinitions || [],
          maxRows: 50,
        });
        return reply.status(200).send(preview);
      } finally {
        releaseSlot();
      }
    }
  );
}
