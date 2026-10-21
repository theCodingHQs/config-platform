import type { StorageAdapter } from '../db/storage-adapter.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { entityCache, type ResolvedEntity } from './entity-cache.js';
import { recordValidator } from './record-validator.js';
import { queryBuilder, type QueryOptions } from './query-builder.js';
import crypto from 'node:crypto';

export class RecordNotFoundError extends Error {
  constructor(entityName: string, id: string) {
    super(`Record '${id}' not found in entity '${entityName}'`);
    this.name = 'RecordNotFoundError';
  }
}

export class RecordConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordConflictError';
  }
}

export class RecordsService {
  constructor(private storage: StorageAdapter = defaultStorageAdapter) {}

  private mapRowToRecord(resolvedEntity: ResolvedEntity, row: Record<string, any>): Record<string, any> {
    const record: Record<string, any> = {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    for (const [colName, val] of Object.entries(row)) {
      if (colName === 'id' || colName === 'created_at' || colName === 'updated_at') continue;
      const fieldDef = resolvedEntity.fieldByPhysicalName.get(colName);
      if (fieldDef) {
        record[fieldDef.name] = val;
      }
    }

    return record;
  }

  /**
   * POST /entities/:entityId/records
   */
  async createRecord(
    tenantId: string,
    entityIdOrName: string,
    body: Record<string, any>
  ): Promise<Record<string, any>> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const { mappedPhysicalData } = await recordValidator.validate(tenantId, resolved, body, false);

    // Silently ignore client-provided system id key; always generate a new UUID
    const recordId = crypto.randomUUID();
    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const cols: string[] = ['"id"', '"created_at"', '"updated_at"'];
    const placeholders: string[] = ['$1', 'NOW()', 'NOW()'];
    const params: any[] = [recordId];

    for (const [colName, val] of Object.entries(mappedPhysicalData)) {
      params.push(val);
      cols.push(`"${colName}"`);
      placeholders.push(`$${params.length}`);
    }

    const sql = `
      INSERT INTO "${schemaName}"."${tableName}" (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *;
    `;

    const rows = await this.storage.query(tenantId, sql, params);
    return this.mapRowToRecord(resolved, rows[0]);
  }

  /**
   * GET /entities/:entityId/records
   */
  async getRecords(
    tenantId: string,
    entityIdOrName: string,
    rawQuery: Record<string, any>
  ): Promise<{ data: Record<string, any>[]; nextCursor: string | null; total?: number; limit: number }> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const options: QueryOptions = queryBuilder.parseQueryParams(resolved, rawQuery);

    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const { sql, params } = queryBuilder.buildSelectQuery(schemaName, tableName, options);
    const rows = await this.storage.query(tenantId, sql, params);

    const hasMore = rows.length > options.limit;
    const resultRows = hasMore ? rows.slice(0, options.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      const sortValues = options.sorts.map((s) => lastRow[s.physicalColumn]);
      nextCursor = Buffer.from(
        JSON.stringify({ values: sortValues, id: lastRow.id }),
        'utf8'
      ).toString('base64url');
    }

    let total: number | undefined;
    if (options.count) {
      const countRes = queryBuilder.buildCountQuery(schemaName, tableName, options.filters);
      const countRows = await this.storage.query<{ total: number }>(
        tenantId,
        countRes.sql,
        countRes.params
      );
      total = Number(countRows[0]?.total || 0);
    }

    const records = resultRows.map((r) => this.mapRowToRecord(resolved, r));
    return { data: records, nextCursor, total, limit: options.limit };
  }

  /**
   * GET /entities/:entityId/records/:id
   */
  async getRecordById(
    tenantId: string,
    entityIdOrName: string,
    id: string
  ): Promise<Record<string, any>> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const sql = `SELECT * FROM "${schemaName}"."${tableName}" WHERE id = $1;`;
    const rows = await this.storage.query(tenantId, sql, [id]);

    if (rows.length === 0) {
      throw new RecordNotFoundError(resolved.entity.name, id);
    }

    return this.mapRowToRecord(resolved, rows[0]);
  }

  /**
   * PATCH /entities/:entityId/records/:id
   */
  async updateRecord(
    tenantId: string,
    entityIdOrName: string,
    id: string,
    body: Record<string, any>
  ): Promise<Record<string, any>> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const { mappedPhysicalData } = await recordValidator.validate(tenantId, resolved, body, true);

    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const setClauses: string[] = ['"updated_at" = NOW()'];
    const params: any[] = [];

    for (const [colName, val] of Object.entries(mappedPhysicalData)) {
      params.push(val);
      setClauses.push(`"${colName}" = $${params.length}`);
    }

    params.push(id);
    const sql = `
      UPDATE "${schemaName}"."${tableName}"
      SET ${setClauses.join(', ')}
      WHERE id = $${params.length}
      RETURNING *;
    `;

    const rows = await this.storage.query(tenantId, sql, params);
    if (rows.length === 0) {
      throw new RecordNotFoundError(resolved.entity.name, id);
    }

    return this.mapRowToRecord(resolved, rows[0]);
  }

  /**
   * DELETE /entities/:entityId/records/:id
   */
  async deleteRecord(
    tenantId: string,
    entityIdOrName: string,
    id: string
  ): Promise<{ success: boolean; id: string }> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const sql = `DELETE FROM "${schemaName}"."${tableName}" WHERE id = $1 RETURNING id;`;
    try {
      const rows = await this.storage.query(tenantId, sql, [id]);
      if (rows.length === 0) {
        throw new RecordNotFoundError(resolved.entity.name, id);
      }
      return { success: true, id };
    } catch (err: any) {
      // Postgres error 23503 is foreign_key_violation
      if (
        err.code === '23503' ||
        (err.message && err.message.toLowerCase().includes('foreign key'))
      ) {
        throw new RecordConflictError(
          `Cannot delete record '${id}' because it is referenced by another record.`
        );
      }
      throw err;
    }
  }

  /**
   * GET /entities/:entityId/aggregate
   */
  async getAggregate(
    tenantId: string,
    entityIdOrName: string,
    rawQuery: Record<string, any>
  ): Promise<{
    value?: number | null;
    groups?: Array<{ key: any; value: number | null }>;
    /** True when more groups exist than `groupLimit` (only the first ones, in key order, are returned). */
    groupsTruncated?: boolean;
    op: string;
    field: string;
  }> {
    const resolved = await entityCache.resolveEntity(tenantId, entityIdOrName);
    const { op, physicalColumn, canonicalFieldName, filters, groupByField, groupLimit } =
      queryBuilder.parseAggregateParams(resolved, rawQuery);

    const schemaName = this.storage.getTenantSchemaName(tenantId);
    const tableName = resolved.entity.physicalTableName;

    const { sql, params } = queryBuilder.buildAggregateQuery(
      schemaName,
      tableName,
      op,
      physicalColumn,
      filters,
      groupByField,
      groupLimit
    );

    const rows = await this.storage.query<{ value: any; group_key?: any }>(tenantId, sql, params);

    if (groupByField) {
      const limit = groupLimit ?? 50;
      return {
        groupsTruncated: rows.length > limit,
        groups: rows.slice(0, limit).map((r) => ({
          key: r.group_key,
          value: r.value === null || r.value === undefined ? null : Number(r.value),
        })),
        op,
        field: canonicalFieldName,
      };
    }

    const rawVal = rows[0]?.value;
    const value = rawVal === null || rawVal === undefined ? null : Number(rawVal);

    return {
      value,
      op,
      field: canonicalFieldName,
    };
  }
}

export const recordsService = new RecordsService();
