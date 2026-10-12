import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import { pool } from '../../db/pool.js';
import { defaultStorageAdapter } from '../../db/storage-adapter.js';
import { entityCache, type ResolvedEntity } from '../entity-cache.js';
import { permissionService } from '../../permissions/permission-service.js';
import { tenantLimitsService, LimitExceededError } from '../../limits/tenant-limits.js';
import { auditLogService } from '../../audit/audit-service.js';
import { queryBuilder, type QueryOptions, type SortClause, type ParsedFilter } from '../query-builder.js';
import { exportTemplateService } from './export-template-service.js';
import {
  sanitizeCsvValue,
  evaluateExportFilename,
  buildSafeContentDisposition,
} from './export-sanitizer.js';
import { getPdfConverter } from './pdf-converter.js';
import type { TenantRole } from '../../auth/auth-types.js';
import type { ExportTemplateDefinition, SimpleExportTemplateDefinition, ExportTemplateColumn } from '@config-platform/schema';

export class ExportForbiddenError extends Error {
  public statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ExportForbiddenError';
  }
}

export interface ExportRecordsParams {
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: TenantRole;
  entityId: string;
  format: 'xlsx' | 'csv' | 'pdf';
  templateId?: string;
  filters?: any;
  parameters?: any;
}

export class ExportService {
  /**
   * Preview first 20 rows of export for studio designer
   */
  async previewRows(
    tenantId: string,
    entityId: string,
    userRole: TenantRole,
    templateOrDef?: string | ExportTemplateDefinition
  ): Promise<{ columns: Array<{ fieldId: string; header: string; format: string }>; rows: Array<Record<string, any>> }> {
    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    if (!resolved) {
      const err = new Error(`Entity '${entityId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    // Exporter permissions apply
    const canExport = await permissionService.canExport(tenantId, resolved.entity.id, userRole);
    if (!canExport) {
      throw new ExportForbiddenError(`Role '${userRole}' does not have export permission for this entity`);
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, userRole);

    let def: ExportTemplateDefinition;
    if (typeof templateOrDef === 'string') {
      const tpl = await exportTemplateService.getTemplate(tenantId, templateOrDef);
      def = tpl.draft;
    } else if (templateOrDef && typeof templateOrDef === 'object') {
      def = templateOrDef as ExportTemplateDefinition;
    } else {
      def = {
        kind: 'simple',
        columns: resolved.fields
          .filter((f) => !hiddenFieldIds.has(f.id))
          .map((f) => ({ fieldId: f.id, header: f.label || f.name, format: f.type === 'date' ? 'date_iso' : 'text' })),
        defaultSort: [],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '',
        pdf: { mode: 'table' },
      };
    }

    if (def.kind === 'grid') {
      return {
        columns: [],
        rows: [],
      };
    }

    // Filter out hidden fields from columns
    const visibleColumns = (def.columns || []).filter((col) => !hiddenFieldIds.has(col.fieldId));

    const options: QueryOptions = {
      filters: this.parseFilters(resolved, def.defaultFilters || []),
      sorts: this.parseSorts(resolved, def.defaultSort || []),
      limit: 20,
      count: false,
    };

    const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
    const { sql, params } = queryBuilder.buildSelectQuery(schemaName, resolved.entity.physicalTableName, options);
    const rawRows = await defaultStorageAdapter.query(tenantId, sql, params);
    const sliceRows = rawRows.slice(0, 20);

    // Resolve reference fields
    const refResolutions = await this.resolveReferencesForChunk(tenantId, resolved, visibleColumns, sliceRows);

    // Format output rows
    const formattedRows = sliceRows.map((raw) => {
      const formatted: Record<string, any> = {};
      for (const col of visibleColumns) {
        formatted[col.fieldId] = this.formatCellValue(resolved, col, raw, refResolutions);
      }
      return formatted;
    });

    return {
      columns: visibleColumns.map((c) => ({
        fieldId: c.fieldId,
        header: c.header || this.getDefaultColumnHeader(resolved, c.fieldId),
        format: c.format || 'text',
      })),
      rows: formattedRows,
    };
  }

  /**
   * Main keyset-paginated streaming export
   */
  async streamExport(params: ExportRecordsParams, reply: FastifyReply): Promise<void> {
    const { tenantId, userId, userEmail, userRole, entityId, format, templateId } = params;

    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    if (!resolved) {
      const err = new Error(`Entity '${entityId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    // 1. Role-based permission check: user must have canRead and canExport
    const canExport = await permissionService.canExport(tenantId, resolved.entity.id, userRole);
    if (!canExport) {
      throw new ExportForbiddenError(`Role '${userRole}' does not have export permission on '${resolved.entity.name}'`);
    }

    // 2. Reject or omit hidden fields for exporting role
    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, userRole);

    let templateDef: ExportTemplateDefinition;
    let templateName: string | undefined;

    if (templateId) {
      const tpl = await exportTemplateService.getTemplate(tenantId, templateId);
      // Use published if available, otherwise draft
      templateDef = (tpl.published || tpl.draft) as ExportTemplateDefinition;
      templateName = tpl.name;
    } else {
      templateDef = {
        kind: 'simple',
        columns: resolved.fields
          .filter((f) => !hiddenFieldIds.has(f.id))
          .map((f) => ({
            fieldId: f.id,
            header: f.label || f.name,
            format: f.type === 'date' ? 'date_iso' : 'text',
          })),
        defaultSort: [],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '',
        pdf: { mode: 'table' },
      };
    }

    if (templateDef.kind === 'grid') {
      if (format !== 'xlsx') {
        const err = new Error('Grid templates only support XLSX format. CSV and PDF are not supported for grid templates.');
        (err as any).statusCode = 400;
        throw err;
      }
      const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
      try {
        const { gridHydrator } = await import('./grid-hydrator.js');
        const buffer = await gridHydrator.renderHydratedToBuffer(templateDef, {
          tenantId,
          userRole,
          userId,
          userEmail,
          filters: Array.isArray(params.filters) ? params.filters : [],
          parameters: params.parameters,
        });

        // Audit log entry for grid template export
        await auditLogService.log({
          tenantId,
          userId,
          userEmail,
          action: 'export_records',
          entityType: 'export_template',
          entityId: templateId || resolved.entity.id,
          afterState: {
            templateId: templateId || null,
            templateName: templateName || null,
            format: 'xlsx',
          },
        });

        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', buildSafeContentDisposition(`${templateName || 'grid_export'}.xlsx`));
        return reply.send(buffer);
      } finally {
        releaseSlot();
      }
    }

    // 3. Check PDF export (returns 501 for now)
    if (format === 'pdf') {
      const converter = getPdfConverter();
      await converter.convert({});
    }

    // Filter columns omitting hidden fields
    const exportColumns = (templateDef.columns || []).filter((col) => !hiddenFieldIds.has(col.fieldId));
    if (exportColumns.length === 0) {
      const err = new Error('No accessible columns found to export');
      (err as any).statusCode = 400;
      throw err;
    }

    // 4. Concurrency slot acquisition
    const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);

    try {
      // 5. Build filters and sorts
      const allFilters = [
        ...(templateDef.defaultFilters || []),
        ...(Array.isArray(params.filters) ? params.filters : []),
      ];
      const parsedFilters = this.parseFilters(resolved, allFilters);
      const parsedSorts = this.parseSorts(resolved, templateDef.defaultSort || []);

      const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
      const tableName = resolved.entity.physicalTableName;

      // 6. Check total rows against maxExportRows limit
      const countRes = queryBuilder.buildCountQuery(schemaName, tableName, parsedFilters);
      const countRows = await defaultStorageAdapter.query<{ total: number }>(
        tenantId,
        countRes.sql,
        countRes.params
      );
      const totalCount = Number(countRows[0]?.total || 0);

      // Over the cap returns clear error and exports nothing
      await tenantLimitsService.checkExportLimit(tenantId, totalCount);

      // 7. Filename evaluation & safe Content-Disposition
      const filename = evaluateExportFilename(templateDef.filenameExpression, {
        templateName,
        entityName: resolved.entity.name,
        entityLabel: resolved.entity.label,
        format,
      });
      const contentDisposition = buildSafeContentDisposition(filename);

      // Prepare headers
      const columnHeaders = exportColumns.map((col) => ({
        fieldId: col.fieldId,
        header: col.header || this.getDefaultColumnHeader(resolved, col.fieldId),
        format: col.format || 'text',
      }));

      // Statement timeout for chunk queries
      const tenantRes = await pool.query<{ statement_timeout_ms?: number }>(
        `SELECT statement_timeout_ms FROM public.tenant WHERE id = $1;`,
        [tenantId]
      );
      const timeoutMs = tenantRes.rows[0]?.statement_timeout_ms || 10000;

      // 8. Stream rendering
      reply.hijack();

      if (format === 'csv') {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': contentDisposition,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });

        const delimiter = templateDef.csv?.delimiter || ',';
        const bom = templateDef.csv?.bom ?? false;

        if (bom) {
          reply.raw.write('\uFEFF');
        }

        if (templateDef.includeHeader !== false) {
          const headerLine = columnHeaders.map((c) => sanitizeCsvValue(c.header)).join(delimiter);
          reply.raw.write(headerLine + '\n');
        }

        let cursor: { values: any[]; id: string } | undefined;
        const chunkSize = 2000;
        let exportedRows = 0;

        while (true) {
          const chunkOptions: QueryOptions = {
            filters: parsedFilters,
            sorts: parsedSorts,
            limit: chunkSize,
            cursor,
            count: false,
          };

          const client = await pool.connect();
          let rawChunkRows: any[];
          try {
            await client.query(`SET LOCAL statement_timeout = ${timeoutMs};`);
            const { sql, params: qParams } = queryBuilder.buildSelectQuery(schemaName, tableName, chunkOptions);
            const queryRes = await client.query(sql, qParams);
            rawChunkRows = queryRes.rows;
          } finally {
            client.release();
          }

          const hasMore = rawChunkRows.length > chunkSize;
          const chunkRows = hasMore ? rawChunkRows.slice(0, chunkSize) : rawChunkRows;

          if (chunkRows.length > 0) {
            const refResolutions = await this.resolveReferencesForChunk(
              tenantId,
              resolved,
              exportColumns,
              chunkRows
            );

            for (const row of chunkRows) {
              const lineValues = exportColumns.map((col) => {
                const val = this.formatCellValue(resolved, col, row, refResolutions);
                return sanitizeCsvValue(val);
              });
              reply.raw.write(lineValues.join(delimiter) + '\n');
            }

            exportedRows += chunkRows.length;

            const lastRow = chunkRows[chunkRows.length - 1];
            cursor = {
              values: parsedSorts.map((s) => lastRow[s.physicalColumn]),
              id: lastRow.id,
            };
          }

          if (!hasMore || chunkRows.length === 0) {
            break;
          }
        }

        reply.raw.end();

        // 9. Audit log entry
        await auditLogService.log({
          tenantId,
          userId,
          userEmail,
          action: 'export_records',
          entityType: 'entity_def',
          entityId: resolved.entity.id,
          afterState: {
            templateId: templateId || null,
            templateName: templateName || null,
            format: 'csv',
            rowCount: exportedRows,
            filtersSummary: parsedFilters.map((f) => `${f.fieldName} ${f.op} ${f.value}`).join(', ') || 'none',
          },
        });
      } else if (format === 'xlsx') {
        reply.raw.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': contentDisposition,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          stream: reply.raw,
          useStyles: false,
          useSharedStrings: false,
        });

        const worksheet = workbook.addWorksheet('Export');
        if (templateDef.includeHeader !== false) {
          worksheet.columns = columnHeaders.map((c) => ({
            header: c.header,
            key: c.fieldId,
            width: 20,
          }));
        }

        let cursor: { values: any[]; id: string } | undefined;
        const chunkSize = 2000;
        let exportedRows = 0;

        while (true) {
          const chunkOptions: QueryOptions = {
            filters: parsedFilters,
            sorts: parsedSorts,
            limit: chunkSize,
            cursor,
            count: false,
          };

          const client = await pool.connect();
          let rawChunkRows: any[];
          try {
            await client.query(`SET LOCAL statement_timeout = ${timeoutMs};`);
            const { sql, params: qParams } = queryBuilder.buildSelectQuery(schemaName, tableName, chunkOptions);
            const queryRes = await client.query(sql, qParams);
            rawChunkRows = queryRes.rows;
          } finally {
            client.release();
          }

          const hasMore = rawChunkRows.length > chunkSize;
          const chunkRows = hasMore ? rawChunkRows.slice(0, chunkSize) : rawChunkRows;

          if (chunkRows.length > 0) {
            const refResolutions = await this.resolveReferencesForChunk(
              tenantId,
              resolved,
              exportColumns,
              chunkRows
            );

            for (const row of chunkRows) {
              const rowValues: Record<string, any> = {};
              for (const col of exportColumns) {
                const val = this.formatCellValue(resolved, col, row, refResolutions);
                rowValues[col.fieldId] = val;
              }
              const excelRow = worksheet.addRow(rowValues);

              // Injection safety in XLSX:
              // String-typed cell for values starting with =, +, -, @
              excelRow.eachCell((cell) => {
                const strVal = cell.value !== null && cell.value !== undefined ? String(cell.value) : '';
                if (typeof cell.value === 'string' && /^\s*[=+\-@]/.test(cell.value)) {
                  (cell as any).type = ExcelJS.ValueType.String;
                  cell.numFmt = '@';
                  cell.value = strVal;
                }
              });

              // Commit each row to keep heap flat
              excelRow.commit();
            }

            exportedRows += chunkRows.length;

            const lastRow = chunkRows[chunkRows.length - 1];
            cursor = {
              values: parsedSorts.map((s) => lastRow[s.physicalColumn]),
              id: lastRow.id,
            };
          }

          if (!hasMore || chunkRows.length === 0) {
            break;
          }
        }

        worksheet.commit();
        await workbook.commit();

        // Audit log entry
        await auditLogService.log({
          tenantId,
          userId,
          userEmail,
          action: 'export_records',
          entityType: 'entity_def',
          entityId: resolved.entity.id,
          afterState: {
            templateId: templateId || null,
            templateName: templateName || null,
            format: 'xlsx',
            rowCount: exportedRows,
            filtersSummary: parsedFilters.map((f) => `${f.fieldName} ${f.op} ${f.value}`).join(', ') || 'none',
          },
        });
      }
    } finally {
      releaseSlot();
    }
  }

  /**
   * Generates blank import template file (headers only) for an entity
   */
  async generateImportTemplate(
    tenantId: string,
    entityId: string,
    userRole: TenantRole,
    format: 'csv' | 'xlsx',
    reply: FastifyReply
  ): Promise<void> {
    const resolved = await entityCache.resolveEntity(tenantId, entityId);
    if (!resolved) {
      const err = new Error(`Entity '${entityId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, userRole);
    const readOnlyFieldIds = await permissionService.getReadOnlyFieldIds(tenantId, resolved.entity.id, userRole);

    // Visible, writable fields matching importer's field labels
    const fields = resolved.fields.filter(
      (f) =>
        !resolved.systemFields.has(f.name) &&
        !hiddenFieldIds.has(f.id) &&
        !readOnlyFieldIds.has(f.id)
    );

    const headers = fields.map((f) => f.label || f.name);
    const filename = `${resolved.entity.name}_import_template.${format}`;
    const contentDisposition = buildSafeContentDisposition(filename);

    reply.hijack();

    if (format === 'csv') {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition,
      });
      reply.raw.write(headers.map(sanitizeCsvValue).join(',') + '\n');
      reply.raw.end();
    } else {
      reply.raw.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition,
      });
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: reply.raw,
        useStyles: false,
        useSharedStrings: false,
      });
      const worksheet = workbook.addWorksheet('Template');
      worksheet.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: 20 }));
      worksheet.commit();
      await workbook.commit();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private getDefaultColumnHeader(resolved: ResolvedEntity, fieldId: string): string {
    const field = resolved.fieldById.get(fieldId);
    if (field) return field.label || field.name;
    if (resolved.systemFields.has(fieldId)) return fieldId;
    return fieldId;
  }

  private parseFilters(resolved: ResolvedEntity, rawFilters: any[]): ParsedFilter[] {
    const parsed: ParsedFilter[] = [];
    for (const f of rawFilters) {
      if (!f || !f.fieldId) continue;
      const fieldDef = resolved.fieldById.get(f.fieldId) || resolved.fieldByName.get(f.fieldId);
      const isSystem = resolved.systemFields.has(f.fieldId);
      if (!fieldDef && !isSystem) continue;

      const physicalColumn = fieldDef ? fieldDef.physicalColumnName : f.fieldId;
      const type = fieldDef ? fieldDef.type : 'text';
      parsed.push({
        fieldName: fieldDef ? fieldDef.name : f.fieldId,
        physicalColumn,
        op: f.op || 'eq',
        value: f.value,
        type: type as any,
      });
    }
    return parsed;
  }

  private parseSorts(resolved: ResolvedEntity, rawSorts: any[]): SortClause[] {
    const sorts: SortClause[] = [];
    for (const s of rawSorts) {
      if (!s || !s.fieldId) continue;
      const fieldDef = resolved.fieldById.get(s.fieldId) || resolved.fieldByName.get(s.fieldId);
      const isSystem = resolved.systemFields.has(s.fieldId);
      if (!fieldDef && !isSystem) continue;

      const physicalColumn = fieldDef ? fieldDef.physicalColumnName : s.fieldId;
      const type = fieldDef ? fieldDef.type : 'text';
      sorts.push({
        fieldName: fieldDef ? fieldDef.name : s.fieldId,
        physicalColumn,
        direction: String(s.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
        type: type as any,
      });
    }

    // Always append stable 'id' sort if not already present
    if (!sorts.some((s) => s.fieldName === 'id')) {
      sorts.push({
        fieldName: 'id',
        physicalColumn: 'id',
        direction: 'ASC',
        type: 'text',
      });
    }
    return sorts;
  }

  private async resolveReferencesForChunk(
    tenantId: string,
    resolved: ResolvedEntity,
    columns: ExportTemplateColumn[],
    rows: any[]
  ): Promise<Map<string, Map<string, string>>> {
    const resolutions = new Map<string, Map<string, string>>();
    const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);

    for (const col of columns) {
      const field = resolved.fieldById.get(col.fieldId);
      if (!field || field.type !== 'reference' || !field.config?.targetEntityId) {
        continue;
      }

      const targetEntityId = field.config.targetEntityId;
      const targetResolved = await entityCache.resolveEntity(tenantId, targetEntityId);
      if (!targetResolved) continue;

      const physicalCol = field.physicalColumnName;
      const rawIds = rows
        .map((r) => r[physicalCol])
        .filter((val): val is string => Boolean(val && typeof val === 'string'));

      const uniqueIds = Array.from(new Set(rawIds));
      if (uniqueIds.length === 0) continue;

      // Determine display column on target entity
      let displayCol = 'id';
      const targetDisplayFieldId = field.config?.displayFieldId || targetResolved.entity.displayFieldId;
      if (targetDisplayFieldId) {
        const targetField =
          targetResolved.fieldById.get(targetDisplayFieldId) ||
          targetResolved.fieldByName.get(targetDisplayFieldId);
        if (targetField) {
          displayCol = targetField.physicalColumnName;
        }
      } else {
        // Fallback to first text field
        const firstTextField = targetResolved.fields.find((f) => f.type === 'text');
        if (firstTextField) {
          displayCol = firstTextField.physicalColumnName;
        }
      }

      const query = `
        SELECT id, "${displayCol}"::text AS display_val
        FROM "${schemaName}"."${targetResolved.entity.physicalTableName}"
        WHERE id = ANY($1::text[])
      `;
      const res = await defaultStorageAdapter.query<{ id: string; display_val: string }>(
        tenantId,
        query,
        [uniqueIds]
      );

      const map = new Map<string, string>();
      for (const r of res) {
        map.set(r.id, r.display_val || r.id);
      }
      resolutions.set(col.fieldId, map);
    }

    return resolutions;
  }

  private formatCellValue(
    resolved: ResolvedEntity,
    col: ExportTemplateColumn,
    rawRow: any,
    refResolutions: Map<string, Map<string, string>>
  ): any {
    const field = resolved.fieldById.get(col.fieldId);
    const physicalCol = field ? field.physicalColumnName : col.fieldId;
    const rawVal = rawRow[physicalCol];

    if (rawVal === null || rawVal === undefined) {
      return '';
    }

    // 1. Reference fields: export the target's display value
    if (field && field.type === 'reference') {
      const refMap = refResolutions.get(col.fieldId);
      if (refMap && refMap.has(String(rawVal))) {
        return refMap.get(String(rawVal))!;
      }
      return String(rawVal);
    }

    // 2. Booleans: true/false (or Yes/No if configured)
    if (field && field.type === 'boolean') {
      const boolVal = Boolean(rawVal);
      if (col.format === 'boolean_yes_no') {
        return boolVal ? 'Yes' : 'No';
      }
      return boolVal;
    }

    // 3. Dates: ISO or chosen format
    if (field && field.type === 'date') {
      if (typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawVal)) {
        return rawVal;
      }
      const d = new Date(rawVal);
      if (!isNaN(d.getTime())) {
        if (col.format === 'date_locale') {
          return d.toLocaleDateString();
        }
        if (col.format === 'datetime_iso') {
          return d.toISOString();
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return String(rawVal);
    }

    // 4. Numbers
    if (field && field.type === 'number') {
      if (typeof rawVal === 'number') {
        return rawVal;
      }
      const num = Number(rawVal);
      return isNaN(num) ? String(rawVal) : num;
    }

    return String(rawVal);
  }
}

export const exportService = new ExportService();
