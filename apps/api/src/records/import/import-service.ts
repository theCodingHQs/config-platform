import crypto from 'node:crypto';
import type { StorageAdapter } from '../../db/storage-adapter.js';
import { defaultStorageAdapter } from '../../db/storage-adapter.js';
import { entityCache, type ResolvedEntity } from '../entity-cache.js';
import { recordValidator, RecordValidationError } from '../record-validator.js';
import { permissionService } from '../../permissions/permission-service.js';
import { tenantLimitsService, LimitExceededError } from '../../limits/tenant-limits.js';
import { auditLogService } from '../../audit/audit-service.js';
import {
  parseImportFile,
  type ParsedTableData,
  InvalidFileContentError,
} from './file-parser.js';
import type {
  ImportOptions,
  ColumnMapping,
  ImportPreviewResult,
  ImportDryRunResult,
  ImportCommitResult,
  ImportRowError,
} from '@config-platform/schema';
import type { TenantRole } from '../../auth/auth-types.js';

export class ImportSecurityError extends Error {
  public statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ImportSecurityError';
  }
}

export class ImportService {
  constructor(private storage: StorageAdapter = defaultStorageAdapter) {}

  /**
   * Preview endpoint: returns detected sheets, columns, sample rows, suggested mapping
   */
  async preview(
    tenantId: string,
    entityIdOrName: string,
    role: TenantRole | string,
    fileBuffer: Buffer,
    fileName?: string,
    requestedSheetName?: string
  ): Promise<ImportPreviewResult> {
    const roleName = role as TenantRole;
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, roleName);
    if (!perm.canCreate) {
      throw new ImportSecurityError('Insufficient permission to import records into entity');
    }

    const parsed = await parseImportFile(fileBuffer, fileName, requestedSheetName);
    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, roleName);
    const readOnlyFieldIds = await permissionService.getReadOnlyFieldIds(tenantId, resolved.entity.id, roleName);

    // Auto-match columns to entity fields
    const suggestedMapping: Record<string, string | null> = {};
    const mappedFieldIds = new Set<string>();

    for (const col of parsed.columns) {
      const colNorm = col.toLowerCase().replace(/[^a-z0-9]/g, '');
      let matchedFieldId: string | null = null;

      for (const field of resolved.fields) {
        if (hiddenFieldIds.has(field.id) || readOnlyFieldIds.has(field.id)) {
          continue;
        }

        const nameNorm = field.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const labelNorm = (field.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        if (colNorm === nameNorm || colNorm === labelNorm) {
          matchedFieldId = field.id;
          break;
        }
      }

      suggestedMapping[col] = matchedFieldId;
      if (matchedFieldId) {
        mappedFieldIds.add(matchedFieldId);
      }
    }

    // Identify unmapped required fields
    const unmappedRequiredFieldIds: string[] = [];
    for (const field of resolved.fields) {
      if (
        field.required &&
        !resolved.systemFields.has(field.name) &&
        !hiddenFieldIds.has(field.id) &&
        !readOnlyFieldIds.has(field.id) &&
        !mappedFieldIds.has(field.id)
      ) {
        unmappedRequiredFieldIds.push(field.id);
      }
    }

    return {
      sheets: parsed.sheets,
      selectedSheet: parsed.selectedSheet,
      detectedColumns: parsed.columns,
      sampleRows: parsed.rows.slice(0, 5),
      totalRowsEstimated: parsed.rows.length,
      suggestedMapping,
      unmappedRequiredFieldIds,
    };
  }

  /**
   * Internal validation runner across all rows
   */
  private async validateDataRows(
    tenantId: string,
    resolved: ResolvedEntity,
    role: TenantRole | string,
    parsed: ParsedTableData,
    mapping: ColumnMapping,
    options: ImportOptions
  ): Promise<{
    errors: ImportRowError[];
    totalRows: number;
    validRows: number;
    errorRowsCount: number;
    validatedPhysicalRows: Record<string, any>[];
  }> {
    const roleName = role as TenantRole;
    // 1. Authorization check
    const perm = await permissionService.getEntityPermission(tenantId, resolved.entity.id, roleName);
    if (!perm.canCreate) {
      throw new ImportSecurityError('Insufficient permission to import records into entity');
    }

    const hiddenFieldIds = await permissionService.getHiddenFieldIds(tenantId, resolved.entity.id, roleName);
    const readOnlyFieldIds = await permissionService.getReadOnlyFieldIds(tenantId, resolved.entity.id, roleName);

    // 2. Reject mapping hidden or read-only fields
    for (const [colName, fieldId] of Object.entries(mapping)) {
      if (!fieldId || fieldId === '__ignore__') continue;
      const fieldDef = resolved.fieldById.get(fieldId);
      if (!fieldDef) {
        throw new InvalidFileContentError(`Mapping references unknown field ID '${fieldId}'`);
      }
      if (hiddenFieldIds.has(fieldId) || readOnlyFieldIds.has(fieldId)) {
        throw new ImportSecurityError(
          `Field '${fieldDef.name}' (${fieldDef.label}) cannot be mapped because it is read-only or hidden for role '${role}'`
        );
      }
    }

    // 3. Blocking check: Unmapped required fields
    const mappedFieldIds = new Set(
      Object.values(mapping).filter((fid): fid is string => Boolean(fid && fid !== '__ignore__'))
    );
    for (const field of resolved.fields) {
      if (
        field.required &&
        !resolved.systemFields.has(field.name) &&
        !hiddenFieldIds.has(field.id) &&
        !readOnlyFieldIds.has(field.id) &&
        !mappedFieldIds.has(field.id)
      ) {
        throw new InvalidFileContentError(
          `Required field '${field.label || field.name}' (${field.name}) is not mapped`
        );
      }
    }

    // 4. Preload reference resolution caches
    // 4. Preload reference resolution caches
    // fieldId -> { exact: Map<trimmedDisplayValue, id[]>, caseInsensitive: Map<lowerDisplayValue, id[]> }
    const referenceCaches = new Map<
      string,
      { exact: Map<string, string[]>; caseInsensitive: Map<string, string[]> }
    >();
    for (const fieldId of mappedFieldIds) {
      const field = resolved.fieldById.get(fieldId);
      if (field && field.type === 'reference') {
        const targetEntityId = (field.config as any)?.targetEntityId;
        if (targetEntityId) {
          const targetEntity = await entityCache.resolveEntity(tenantId, targetEntityId);
          const targetTable = this.storage.getPhysicalTableName(
            tenantId,
            targetEntity.entity.physicalTableName
          );

          // Determine display column in target table
          let displayCol = 'name';
          if (targetEntity.displayField) {
            displayCol = targetEntity.displayField.physicalColumnName;
          } else if (targetEntity.fieldByName.has('name')) {
            displayCol = targetEntity.fieldByName.get('name')!.physicalColumnName;
          } else if (targetEntity.fieldByName.has('title')) {
            displayCol = targetEntity.fieldByName.get('title')!.physicalColumnName;
          } else {
            displayCol = 'id';
          }

          // Extract distinct non-empty trimmed values from file for this reference field
          const fileColNames = Object.entries(mapping)
            .filter(([_, fId]) => fId === fieldId)
            .map(([cName]) => cName);

          const distinctRefValues = Array.from(
            new Set(
              parsed.rows
                .flatMap((r) => fileColNames.map((c) => r[c]))
                .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
                .map((v) => String(v).trim())
            )
          );

          const exactLookup = new Map<string, string[]>();
          const caseInsensitiveLookup = new Map<string, string[]>();

          if (distinctRefValues.length > 0) {
            const CHUNK_SIZE = 1000;
            // Pass 1: Exact match query (enables index usage)
            for (let i = 0; i < distinctRefValues.length; i += CHUNK_SIZE) {
              const chunk = distinctRefValues.slice(i, i + CHUNK_SIZE);
              const targetRows = await this.storage.query<{ id: string; disp: any }>(
                tenantId,
                `SELECT id, "${displayCol}"::text AS disp FROM ${targetTable}
                 WHERE "${displayCol}"::text = ANY($1::text[])
                    OR id::text = ANY($1::text[])`,
                [chunk]
              );

              for (const row of targetRows) {
                const dispKey = (row.disp || '').trim();
                if (dispKey) {
                  const arr = exactLookup.get(dispKey) || [];
                  arr.push(row.id);
                  exactLookup.set(dispKey, arr);
                }

                // Also map by ID directly if user provided ID
                const idKey = (row.id || '').trim();
                if (idKey && !exactLookup.has(idKey)) {
                  exactLookup.set(idKey, [row.id]);
                }
              }
            }

            // Pass 2: Optional second pass with LOWER() only for values with no exact match
            const unmatchedValues = distinctRefValues.filter((v) => !exactLookup.has(v));
            if (unmatchedValues.length > 0) {
              const lowerUnmatched = Array.from(
                new Set(unmatchedValues.map((v) => v.toLowerCase()))
              );
              for (let i = 0; i < lowerUnmatched.length; i += CHUNK_SIZE) {
                const chunk = lowerUnmatched.slice(i, i + CHUNK_SIZE);
                const targetRows = await this.storage.query<{ id: string; disp: any }>(
                  tenantId,
                  `SELECT id, "${displayCol}"::text AS disp FROM ${targetTable}
                   WHERE LOWER("${displayCol}"::text) = ANY($1::text[])
                      OR LOWER(id::text) = ANY($1::text[])`,
                  [chunk]
                );

                for (const row of targetRows) {
                  const dispKey = (row.disp || '').trim().toLowerCase();
                  if (dispKey) {
                    const arr = caseInsensitiveLookup.get(dispKey) || [];
                    arr.push(row.id);
                    caseInsensitiveLookup.set(dispKey, arr);
                  }

                  const idKey = (row.id || '').trim().toLowerCase();
                  if (idKey && !caseInsensitiveLookup.has(idKey)) {
                    caseInsensitiveLookup.set(idKey, [row.id]);
                  }
                }
              }
            }
          }

          referenceCaches.set(fieldId, { exact: exactLookup, caseInsensitive: caseInsensitiveLookup });
        }
      }
    }

    // 5. Unique field tracking (exact comparison so indexes can be used, case-sensitive)
    const uniqueFields = resolved.fields.filter(
      (f) => (f as any).unique === true || (f.config as any)?.unique === true
    );
    const fileSeenValues = new Map<string, Map<string, number>>(); // fieldId -> Map<val, firstRowNumber>
    const existingDbValues = new Map<string, Set<string>>(); // fieldId -> Set<val>

    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    for (const uf of uniqueFields) {
      fileSeenValues.set(uf.id, new Map());
      const existingValuesSet = new Set<string>();

      // Extract distinct non-empty values from file for this unique field
      const fileColNames = Object.entries(mapping)
        .filter(([_, fId]) => fId === uf.id)
        .map(([cName]) => cName);

      const distinctUniqueValues = Array.from(
        new Set(
          parsed.rows
            .flatMap((r) =>
              fileColNames.map((c) => {
                let v = r[c];
                if (v === null || v === undefined) return null;
                if (typeof v === 'string') v = v.trim();
                if (v === '') return null;
                if (uf.type === 'number') {
                  let numStr = String(v);
                  if (options.decimalSeparator === ',') {
                    numStr = numStr.replace(/\./g, '').replace(',', '.');
                  }
                  const n = Number(numStr);
                  if (!isNaN(n)) return String(n);
                }
                return String(v).trim();
              })
            )
            .filter((v): v is string => Boolean(v))
        )
      );

      if (distinctUniqueValues.length > 0) {
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < distinctUniqueValues.length; i += CHUNK_SIZE) {
          const chunk = distinctUniqueValues.slice(i, i + CHUNK_SIZE);
          const dbRows = await this.storage.query<{ val: string }>(
            tenantId,
            `SELECT "${uf.physicalColumnName}"::text AS val
             FROM "${schemaName}"."${tableName}"
             WHERE "${uf.physicalColumnName}" IS NOT NULL
               AND "${uf.physicalColumnName}"::text = ANY($1::text[])`,
            [chunk]
          );

          for (const r of dbRows) {
            if (r.val !== null && r.val !== undefined) {
              existingValuesSet.add(r.val);
            }
          }
        }
      }

      existingDbValues.set(uf.id, existingValuesSet);
    }

    // 6. Iterate every row
    const errors: ImportRowError[] = [];
    let errorRowsCount = 0;
    const validatedPhysicalRows: Record<string, any>[] = [];

    const trueWords = (options.trueWords || ['true', 'yes', 'y', '1', 'on']).map((w) =>
      w.toLowerCase().trim()
    );
    const falseWords = (options.falseWords || ['false', 'no', 'n', '0', 'off']).map((w) =>
      w.toLowerCase().trim()
    );

    for (let rIdx = 0; rIdx < parsed.rows.length; rIdx++) {
      const rawRow = parsed.rows[rIdx];
      const rowNumber = rIdx + 2; // Row 1 is header, so row index starts at 2
      const rowData: Record<string, any> = {};
      const rowErrors: ImportRowError[] = [];

      for (const [colName, fieldId] of Object.entries(mapping)) {
        if (!fieldId || fieldId === '__ignore__') continue;
        const field = resolved.fieldById.get(fieldId)!;
        let rawVal = rawRow[colName];

        // Format transformations
        if (typeof rawVal === 'string') {
          rawVal = rawVal.trim();
        }

        if (rawVal === '' || rawVal === null || rawVal === undefined) {
          rawVal = null;
        }

        if (rawVal !== null) {
          // Date formatting
          if (field.type === 'date') {
            if (rawVal instanceof Date) {
              rawVal = rawVal.toISOString();
            } else if (typeof rawVal === 'string') {
              if (options.dateFormat === 'DD/MM/YYYY') {
                const parts = rawVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                if (parts) {
                  const d = parts[1].padStart(2, '0');
                  const m = parts[2].padStart(2, '0');
                  const y = parts[3];
                  rawVal = `${y}-${m}-${d}`;
                }
              } else if (options.dateFormat === 'MM/DD/YYYY') {
                const parts = rawVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                if (parts) {
                  const m = parts[1].padStart(2, '0');
                  const d = parts[2].padStart(2, '0');
                  const y = parts[3];
                  rawVal = `${y}-${m}-${d}`;
                }
              }
            }
          }

          // Number decimal separator
          if (field.type === 'number') {
            if (typeof rawVal === 'string') {
              let numStr = rawVal;
              if (options.decimalSeparator === ',') {
                // If comma decimal separator, replace comma with dot (and optional dot thousands separator)
                numStr = numStr.replace(/\./g, '').replace(',', '.');
              }
              const parsedNum = Number(numStr);
              if (isNaN(parsedNum)) {
                rowErrors.push({
                  row: rowNumber,
                  column: field.label || field.name,
                  message: `${field.label || field.name} must be a valid number (got '${rawVal}')`,
                });
              } else {
                rawVal = parsedNum;
              }
            }
          }

          // Boolean words
          if (field.type === 'boolean') {
            if (typeof rawVal === 'string') {
              const lower = rawVal.toLowerCase().trim();
              if (trueWords.includes(lower)) {
                rawVal = true;
              } else if (falseWords.includes(lower)) {
                rawVal = false;
              } else {
                rowErrors.push({
                  row: rowNumber,
                  column: field.label || field.name,
                  message: `${field.label || field.name} must be a boolean ('${rawVal}' does not match true/false words)`,
                });
              }
            }
          }

          // Reference resolution by display field value (exact match first, then case-insensitive fallback)
          if (field.type === 'reference') {
            const cache = referenceCaches.get(field.id);
            const strVal = String(rawVal).trim();
            let matches = cache?.exact.get(strVal) || [];
            if (matches.length === 0) {
              matches = cache?.caseInsensitive.get(strVal.toLowerCase()) || [];
            }

            if (matches.length === 0) {
              rowErrors.push({
                row: rowNumber,
                column: field.label || field.name,
                message: `Referenced record '${rawVal}' not found in target entity`,
              });
            } else if (matches.length > 1) {
              rowErrors.push({
                row: rowNumber,
                column: field.label || field.name,
                message: `Ambiguous reference: multiple records match '${rawVal}'`,
              });
            } else {
              rawVal = matches[0];
            }
          }

          // Unique checks (exact case-sensitive comparison)
          if (uniqueFields.some((u) => u.id === field.id)) {
            const strVal = String(rawVal).trim();
            const seenMap = fileSeenValues.get(field.id)!;
            const dbSet = existingDbValues.get(field.id)!;

            if (seenMap.has(strVal)) {
              rowErrors.push({
                row: rowNumber,
                column: field.label || field.name,
                message: `Duplicate value '${rawVal}' in file for unique field (already appears at row ${seenMap.get(strVal)})`,
              });
            } else {
              seenMap.set(strVal, rowNumber);
            }

            if (dbSet.has(strVal)) {
              rowErrors.push({
                row: rowNumber,
                column: field.label || field.name,
                message: `Value '${rawVal}' already exists in database for unique field`,
              });
            }
          }
        }

        rowData[field.name] = rawVal;
      }

      // Delegate to recordValidator for types, required, select options, min/max, maxLength
      try {
        const { mappedPhysicalData } = await recordValidator.validate(
          tenantId,
          resolved,
          rowData,
          false,
          { skipReferenceDbCheck: true }
        );

        if (rowErrors.length > 0) {
          errorRowsCount++;
          if (errors.length < 100) {
            errors.push(...rowErrors.slice(0, 100 - errors.length));
          }
        } else {
          validatedPhysicalRows.push(mappedPhysicalData);
        }
      } catch (err: any) {
        errorRowsCount++;
        if (err instanceof RecordValidationError) {
          for (const [fName, errMsg] of Object.entries(err.errors)) {
            const fDef = resolved.fieldByName.get(fName);
            if (errors.length < 100) {
              errors.push({
                row: rowNumber,
                column: fDef?.label || fName,
                message: errMsg,
              });
            }
          }
        } else {
          if (errors.length < 100) {
            errors.push({
              row: rowNumber,
              message: err.message || 'Row validation failed',
            });
          }
        }
        if (rowErrors.length > 0 && errors.length < 100) {
          errors.push(...rowErrors.slice(0, 100 - errors.length));
        }
      }
    }

    return {
      errors,
      totalRows: parsed.rows.length,
      validRows: parsed.rows.length - errorRowsCount,
      errorRowsCount,
      validatedPhysicalRows,
    };
  }

  /**
   * Dry Run endpoint: validates all rows without writing anything
   */
  async dryRun(
    tenantId: string,
    entityIdOrName: string,
    role: TenantRole | string,
    fileBuffer: Buffer,
    mapping: ColumnMapping,
    options: ImportOptions,
    fileName?: string
  ): Promise<ImportDryRunResult> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const parsed = await parseImportFile(fileBuffer, fileName, options.sheetName);

    const result = await this.validateDataRows(
      tenantId,
      resolved,
      role,
      parsed,
      mapping,
      options
    );

    const hasErrors = result.errorRowsCount > 0;
    const summary = hasErrors
      ? `Validation failed: ${result.errorRowsCount} of ${result.totalRows} rows have errors.`
      : `Validation successful: all ${result.totalRows} rows are valid and ready to import.`;

    return {
      success: !hasErrors,
      totalRows: result.totalRows,
      validRows: result.validRows,
      errorRows: result.errorRowsCount,
      errors: result.errors,
      summary,
    };
  }

  /**
   * Commit endpoint: all-or-nothing transactional import
   */
  async commit(
    tenantId: string,
    entityIdOrName: string,
    role: TenantRole | string,
    userId: string,
    userEmail: string,
    fileBuffer: Buffer,
    mapping: ColumnMapping,
    options: ImportOptions,
    fileName?: string
  ): Promise<ImportCommitResult> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const parsed = await parseImportFile(fileBuffer, fileName, options.sheetName);

    // Check row count limit (default cap 10,000)
    const MAX_ROW_CAP = 10000;
    if (parsed.rows.length > MAX_ROW_CAP) {
      throw new LimitExceededError(
        `Import row cap exceeded: maximum allowed is ${MAX_ROW_CAP} rows (got ${parsed.rows.length})`
      );
    }

    // Check plan limits (maxRecordsPerEntity)
    const { plan, limits } = await tenantLimitsService.getTenantPlan(tenantId);
    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const countRes = await this.storage.query<{ count: string }>(
      tenantId,
      `SELECT COUNT(*)::text AS count FROM "${schemaName}"."${tableName}"`
    );
    const currentCount = parseInt(countRes[0]?.count || '0', 10);
    const prospectiveCount = currentCount + parsed.rows.length;

    if (prospectiveCount > limits.maxRecordsPerEntity) {
      throw new LimitExceededError(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxRecordsPerEntity} records per entity (current: ${currentCount}, attempting to import: ${parsed.rows.length}). Upgrade plan to import more records.`
      );
    }

    // Run validation across all rows
    const validation = await this.validateDataRows(
      tenantId,
      resolved,
      role,
      parsed,
      mapping,
      options
    );

    if (validation.errorRowsCount > 0) {
      const err = new Error(
        `Import validation failed with ${validation.errorRowsCount} error(s). No records were imported.`
      ) as any;
      err.statusCode = 422;
      err.errors = validation.errors;
      throw err;
    }

    if (validation.validatedPhysicalRows.length === 0) {
      return { success: true, insertedCount: 0 };
    }

    // All-or-nothing execution in a single database transaction with 30s statement timeout
    const insertedCount = await this.storage.transaction(
      tenantId,
      async (tx) => {
        let totalInserted = 0;
        const allPhysicalCols = Array.from(
          new Set(validation.validatedPhysicalRows.flatMap((r) => Object.keys(r)))
        );
        // Parameter limit: floor(60000 / number of columns) rows per statement
        const numColumns = Math.max(1, allPhysicalCols.length + 3);
        const effectiveBatchSize = Math.max(1, Math.floor(60000 / numColumns));

        for (let i = 0; i < validation.validatedPhysicalRows.length; i += effectiveBatchSize) {
          const batch = validation.validatedPhysicalRows.slice(i, i + effectiveBatchSize);
          const valueClauses: string[] = [];
          const params: any[] = [];

          for (const rowData of batch) {
            const recordId = crypto.randomUUID();
            params.push(recordId);
            const rowPlaceholders: string[] = [`$${params.length}`, 'NOW()', 'NOW()'];

            for (const colName of allPhysicalCols) {
              const val = rowData[colName] !== undefined ? rowData[colName] : null;
              params.push(val);
              rowPlaceholders.push(`$${params.length}`);
            }

            valueClauses.push(`(${rowPlaceholders.join(', ')})`);
          }

          const colsSql = [
            '"id"',
            '"created_at"',
            '"updated_at"',
            ...allPhysicalCols.map((c) => `"${c}"`),
          ].join(', ');

          const sql = `
            INSERT INTO "${schemaName}"."${tableName}" (${colsSql})
            VALUES ${valueClauses.join(', ')}
          `;
          await tx.query(sql, params);
          totalInserted += batch.length;
        }

        return totalInserted;
      },
      30000
    );

    // Audit log entry (strictly no row contents)
    await auditLogService.log({
      tenantId,
      userId,
      userEmail,
      action: 'import_records',
      entityType: 'entity',
      entityId: resolved.entity.id,
      afterState: {
        rowCount: insertedCount,
        fileName: fileName || 'unknown.file',
        mappingSummary: {
          mappedFieldsCount: Object.values(mapping).filter((v) => Boolean(v && v !== '__ignore__'))
            .length,
          mapping,
        },
      },
    });

    return {
      success: true,
      insertedCount,
    };
  }
}

export const importService = new ImportService();
