import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { csrfCheckHook } from '../../auth/session-middleware.js';
import { importService } from './import-service.js';
import { ImportOptionsSchema, ColumnMappingSchema } from '@config-platform/schema';

export async function importRoutes(fastify: FastifyInstance) {
  // Common multipart extraction helper
  async function extractMultipartPayload(req: FastifyRequest) {
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mappingRaw = '';
    let optionsRaw = '';
    let sheetName = '';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileName = part.filename;
        fileBuffer = await part.toBuffer();
      } else {
        if (part.fieldname === 'mapping') {
          mappingRaw = String(part.value || '');
        } else if (part.fieldname === 'options') {
          optionsRaw = String(part.value || '');
        } else if (part.fieldname === 'sheetName') {
          sheetName = String(part.value || '');
        }
      }
    }

    if (!fileBuffer) {
      throw new Error('No file uploaded for import');
    }

    return { fileBuffer, fileName, mappingRaw, optionsRaw, sheetName };
  }

  // POST /entities/:entityId/import/preview
  fastify.post(
    '/entities/:entityId/import/preview',
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
      const { entityId } = req.params as { entityId: string };

      const { fileBuffer, fileName, sheetName } = await extractMultipartPayload(req);
      const previewRes = await importService.preview(
        tenantId,
        entityId,
        role,
        fileBuffer,
        fileName,
        sheetName || undefined
      );

      return reply.status(200).send(previewRes);
    }
  );

  // POST /entities/:entityId/import/dry-run
  fastify.post(
    '/entities/:entityId/import/dry-run',
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
      const { entityId } = req.params as { entityId: string };

      const { fileBuffer, fileName, mappingRaw, optionsRaw, sheetName } =
        await extractMultipartPayload(req);

      let mapping: Record<string, string | null> = {};
      if (mappingRaw) {
        try {
          mapping = JSON.parse(mappingRaw);
        } catch {
          return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid mapping JSON' });
        }
      }
      ColumnMappingSchema.parse(mapping);

      let optionsObj: any = {};
      if (optionsRaw) {
        try {
          optionsObj = JSON.parse(optionsRaw);
        } catch {
          return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid options JSON' });
        }
      }
      if (sheetName && !optionsObj.sheetName) {
        optionsObj.sheetName = sheetName;
      }
      const options = ImportOptionsSchema.parse(optionsObj);

      const dryRunRes = await importService.dryRun(
        tenantId,
        entityId,
        role,
        fileBuffer,
        mapping,
        options,
        fileName
      );

      return reply.status(200).send(dryRunRes);
    }
  );

  // POST /entities/:entityId/import/commit
  fastify.post(
    '/entities/:entityId/import/commit',
    {
      preHandler: csrfCheckHook,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role, userId, email } = req.session;
      const { entityId } = req.params as { entityId: string };

      const { fileBuffer, fileName, mappingRaw, optionsRaw, sheetName } =
        await extractMultipartPayload(req);

      let mapping: Record<string, string | null> = {};
      if (mappingRaw) {
        try {
          mapping = JSON.parse(mappingRaw);
        } catch {
          return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid mapping JSON' });
        }
      }
      ColumnMappingSchema.parse(mapping);

      let optionsObj: any = {};
      if (optionsRaw) {
        try {
          optionsObj = JSON.parse(optionsRaw);
        } catch {
          return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid options JSON' });
        }
      }
      if (sheetName && !optionsObj.sheetName) {
        optionsObj.sheetName = sheetName;
      }
      const options = ImportOptionsSchema.parse(optionsObj);

      const commitRes = await importService.commit(
        tenantId,
        entityId,
        role,
        userId,
        email || '',
        fileBuffer,
        mapping,
        options,
        fileName
      );

      return reply.status(200).send(commitRes);
    }
  );
}
