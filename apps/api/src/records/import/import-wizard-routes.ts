import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  analyzeImportColumns,
  entityNameFromTitle,
  wizardFieldSpec,
  WizardPlanSchema,
  WIZARD_FALSE_WORDS,
  WIZARD_TRUE_WORDS,
} from '@config-platform/schema';
import { csrfCheckHook } from '../../auth/session-middleware.js';
import { hasMinRole } from '../../auth/auth-types.js';
import { auditLogService } from '../../audit/audit-service.js';
import { tenantLimitsService } from '../../limits/tenant-limits.js';
import { migrationService } from '../../migrations/migration-service.js';
import { parseImportFile } from './file-parser.js';
import { importService } from './import-service.js';

/**
 * "Start from an Excel sheet": analyze a spreadsheet to suggest a data entity, then create that
 * entity and import the sheet's rows in one step (builder+).
 */
export async function importWizardRoutes(fastify: FastifyInstance) {
  async function readUpload(req: FastifyRequest) {
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileName = part.filename;
        fileBuffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
    if (!fileBuffer) throw Object.assign(new Error('No file uploaded'), { statusCode: 400 });
    return { fileBuffer, fileName, fields };
  }

  const builderOnly = (req: FastifyRequest, reply: FastifyReply) => {
    if (hasMinRole(req.session.role, 'builder')) return true;
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    return false;
  };

  // POST /import-wizard/analyze - Sheets, row count and a suggested field per column
  fastify.post('/import-wizard/analyze', {
    preHandler: csrfCheckHook,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!builderOnly(req, reply)) return;
    const { fileBuffer, fileName, fields } = await readUpload(req);
    const parsed = await parseImportFile(fileBuffer, fileName, fields.sheetName || undefined);
    const analysis = analyzeImportColumns(parsed.columns, parsed.rows);
    // A single-sheet workbook or a CSV is named after the file, otherwise after the sheet
    const title = parsed.sheets.length > 1 ? parsed.selectedSheet : fileName.replace(/\.(xlsx|xlsm|xls|csv)$/i, '');
    return {
      sheets: parsed.sheets,
      selectedSheet: parsed.selectedSheet,
      rowCount: parsed.rows.length,
      suggestedLabel: title.trim() || 'Imported data',
      suggestedName: entityNameFromTitle(title || 'imported_data'),
      ...analysis,
    };
  });

  // POST /import-wizard/create - Create the entity and import every row (all or nothing)
  fastify.post('/import-wizard/create', {
    preHandler: csrfCheckHook,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!builderOnly(req, reply)) return;
    const { tenantId, role, userId, email } = req.session;
    const { fileBuffer, fileName, fields } = await readUpload(req);

    let planInput: unknown;
    try {
      planInput = JSON.parse(fields.plan || '');
    } catch {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid plan' });
    }
    const parsedPlan = WizardPlanSchema.safeParse(planInput);
    if (!parsedPlan.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: parsedPlan.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    const plan = parsedPlan.data;
    const included = plan.columns.filter((c) => c.include);
    if (included.length === 0) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Choose at least one column to import' });
    }
    const names = new Set<string>();
    for (const column of included) {
      if (names.has(column.name)) {
        return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `Two columns would both be named '${column.name}'` });
      }
      names.add(column.name);
    }

    await tenantLimitsService.checkEntityLimit(tenantId);
    const created = await migrationService.createEntity(tenantId, {
      name: plan.entityName,
      label: plan.entityLabel,
      ...(plan.icon ? { icon: plan.icon } : {}),
      fields: included.map((column) => ({ ...wizardFieldSpec(column), required: false, unique: false })),
    } as any);

    const fieldIdByName = new Map(created.fields.map((f) => [f.name, f.id]));
    const mapping = Object.fromEntries(plan.columns.map((c) => [c.header, c.include ? fieldIdByName.get(c.name) ?? null : null]));
    let insertedCount = 0;
    try {
      const result = await importService.commit(
        tenantId,
        created.entity.id,
        role,
        userId,
        email,
        fileBuffer,
        mapping,
        {
          sheetName: plan.sheetName,
          dateFormat: plan.dateFormat,
          decimalSeparator: '.',
          trueWords: WIZARD_TRUE_WORDS,
          falseWords: WIZARD_FALSE_WORDS,
        } as any,
        fileName
      );
      insertedCount = result.insertedCount;
    } catch (err) {
      // Nothing half-done: remove the new entity, then report what was wrong with the rows
      await migrationService.dropEntity(tenantId, { entityId: created.entity.id, expectedVersion: created.entity.version });
      throw err;
    }

    await auditLogService.log({
      tenantId,
      userId,
      userEmail: email,
      action: 'entity.create_from_sheet',
      entityType: 'entity',
      entityId: created.entity.id,
      afterState: { name: plan.entityName, fieldCount: included.length, insertedCount, fileName },
    });

    return reply.status(201).send({ entity: created.entity, fields: created.fields, insertedCount });
  });
}
