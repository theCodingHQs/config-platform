import type { ResolvedEntity } from './entity-cache.js';
import type { FieldType } from '@config-platform/schema';

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryError';
  }
}

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in'
  | 'isNull';

const ALLOWED_OPS_BY_TYPE: Record<string, FilterOp[]> = {
  text: ['eq', 'neq', 'contains', 'in', 'isNull'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  boolean: ['eq', 'neq', 'isNull'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull'],
  select: ['eq', 'neq', 'in', 'isNull'],
  reference: ['eq', 'neq', 'in', 'isNull'],
  // System fields
  id: ['eq', 'neq', 'in'],
  created_at: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  updated_at: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};

export interface SortClause {
  fieldName: string;
  physicalColumn: string;
  direction: 'ASC' | 'DESC';
  type: FieldType | 'text' | 'date';
}

export interface ParsedFilter {
  fieldName: string;
  physicalColumn: string;
  op: FilterOp;
  value: any;
  type: FieldType | 'text' | 'date';
}

export interface QueryOptions {
  filters: ParsedFilter[];
  sorts: SortClause[];
  limit: number;
  cursor?: { values: any[]; id: string };
  count: boolean;
}

export class QueryBuilder {
  /**
  /**
   * Parse filters from query
   */
  parseFilters(
    resolvedEntity: ResolvedEntity,
    rawQuery: Record<string, any>
  ): ParsedFilter[] {
    const filters: ParsedFilter[] = [];

    // Parse filters: filter[field][op]=val or parsed nested filter object
    const rawFilterMap: Record<string, Record<string, any>> = {};

    for (const [key, val] of Object.entries(rawQuery)) {
      const match = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/);
      if (match) {
        const fieldName = match[1];
        const op = match[2] || 'eq';
        if (!rawFilterMap[fieldName]) rawFilterMap[fieldName] = {};
        rawFilterMap[fieldName][op] = val;
      }
    }

    if (rawQuery.filter && typeof rawQuery.filter === 'object') {
      for (const [fieldName, opObj] of Object.entries(rawQuery.filter)) {
        if (typeof opObj === 'object' && opObj !== null) {
          if (!rawFilterMap[fieldName]) rawFilterMap[fieldName] = {};
          Object.assign(rawFilterMap[fieldName], opObj);
        } else {
          if (!rawFilterMap[fieldName]) rawFilterMap[fieldName] = {};
          rawFilterMap[fieldName]['eq'] = opObj;
        }
      }
    }

    // Validate and build filter clauses
    for (const [fieldName, ops] of Object.entries(rawFilterMap)) {
      const fieldDef = resolvedEntity.fieldByName.get(fieldName) || resolvedEntity.fieldById.get(fieldName);
      const isSystem = resolvedEntity.systemFields.has(fieldName);

      if (!fieldDef && !isSystem) {
        throw new QueryError(`Cannot filter by unknown field: '${fieldName}'`);
      }

      const fieldType = isSystem
        ? fieldName === 'id'
          ? 'text'
          : 'date'
        : fieldDef!.type;
      const physicalCol = isSystem ? fieldName : fieldDef!.physicalColumnName;
      const canonicalName = isSystem ? fieldName : fieldDef!.name;
      const allowedOps = ALLOWED_OPS_BY_TYPE[canonicalName] || ALLOWED_OPS_BY_TYPE[fieldType] || [];

      for (const [opStr, val] of Object.entries(ops)) {
        const op = opStr as FilterOp;
        if (!allowedOps.includes(op)) {
          throw new QueryError(
            `Filter operator '${op}' is not supported for field '${canonicalName}' of type '${fieldType}'`
          );
        }

        filters.push({
          fieldName: canonicalName,
          physicalColumn: physicalCol,
          op,
          value: val,
          type: fieldType,
        });
      }
    }

    return filters;
  }

  /**
   * Parses query parameters into structured, catalog-validated query options
   */
  parseQueryParams(
    resolvedEntity: ResolvedEntity,
    rawQuery: Record<string, any>
  ): QueryOptions {
    // Count requested filter conditions across single and array parameters
    let rawFilterCount = 0;
    for (const [key, val] of Object.entries(rawQuery)) {
      if (key.startsWith('filter[') || key.startsWith('filter.')) {
        rawFilterCount += Array.isArray(val) ? val.length : 1;
      }
    }
    if (rawQuery.filter && typeof rawQuery.filter === 'object') {
      for (const ops of Object.values(rawQuery.filter)) {
        if (typeof ops === 'object' && ops !== null) {
          rawFilterCount += Object.keys(ops).length;
        } else {
          rawFilterCount += 1;
        }
      }
    }
    if (rawFilterCount > 10) {
      throw new QueryError('Filter limit exceeded: maximum 10 filters allowed per query');
    }

    const filters = this.parseFilters(resolvedEntity, rawQuery);
    if (filters.length > 10) {
      throw new QueryError('Filter limit exceeded: maximum 10 filters allowed per query');
    }

    // Parse sorting: sort=field,-field2
    const sorts: SortClause[] = [];
    const rawSort = rawQuery.sort;
    if (typeof rawSort === 'string' && rawSort.trim().length > 0) {
      const parts = rawSort.split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        let direction: 'ASC' | 'DESC' = 'ASC';
        let fieldName = part;
        if (part.startsWith('-')) {
          direction = 'DESC';
          fieldName = part.substring(1);
        } else if (part.startsWith('+')) {
          fieldName = part.substring(1);
        }

        const fieldDef = resolvedEntity.fieldByName.get(fieldName) || resolvedEntity.fieldById.get(fieldName);
        const isSystem = resolvedEntity.systemFields.has(fieldName);

        if (!fieldDef && !isSystem) {
          throw new QueryError(`Cannot sort by unknown field: '${fieldName}'`);
        }

        const fieldType = isSystem
          ? fieldName === 'id'
            ? 'text'
            : 'date'
          : fieldDef!.type;
        const physicalCol = isSystem ? fieldName : fieldDef!.physicalColumnName;
        const canonicalName = isSystem ? fieldName : fieldDef!.name;

        sorts.push({
          fieldName: canonicalName,
          physicalColumn: physicalCol,
          direction,
          type: fieldType,
        });
      }
    }

    // Always append stable 'id' sort if not already explicitly present
    if (!sorts.some((s) => s.fieldName === 'id')) {
      sorts.push({
        fieldName: 'id',
        physicalColumn: 'id',
        direction: 'ASC',
        type: 'text',
      });
    }

    // Parse limit (default 50, max 100)
    let limit = 50;
    if (rawQuery.limit) {
      const parsedLimit = parseInt(String(rawQuery.limit), 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        throw new QueryError('Limit must be a positive integer');
      }
      limit = Math.min(parsedLimit, 100);
    }

    // Parse cursor
    let cursor: { values: any[]; id: string } | undefined;
    if (rawQuery.cursor) {
      try {
        const decoded = Buffer.from(String(rawQuery.cursor), 'base64url').toString('utf8');
        cursor = JSON.parse(decoded);
      } catch {
        throw new QueryError('Invalid pagination cursor');
      }
    }

    const count = rawQuery.count === true || rawQuery.count === 'true';

    return {
      filters,
      sorts,
      limit,
      cursor,
      count,
    };
  }

  /**
   * Builds SQL for filters and keyset pagination
   */
  buildSelectQuery(
    schemaName: string,
    physicalTableName: string,
    options: QueryOptions
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    const whereClauses: string[] = [];

    // 1. Build filter WHERE clauses
    for (const f of options.filters) {
      const col = `"${f.physicalColumn}"`;
      switch (f.op) {
        case 'eq':
          params.push(f.value);
          whereClauses.push(`${col} = $${params.length}`);
          break;
        case 'neq':
          params.push(f.value);
          whereClauses.push(`${col} != $${params.length}`);
          break;
        case 'gt':
          params.push(f.value);
          whereClauses.push(`${col} > $${params.length}`);
          break;
        case 'gte':
          params.push(f.value);
          whereClauses.push(`${col} >= $${params.length}`);
          break;
        case 'lt':
          params.push(f.value);
          whereClauses.push(`${col} < $${params.length}`);
          break;
        case 'lte':
          params.push(f.value);
          whereClauses.push(`${col} <= $${params.length}`);
          break;
        case 'contains': {
          // Escape wildcard chars to prevent injection
          const escaped = String(f.value).replace(/[%_]/g, '\\$&');
          params.push(`%${escaped}%`);
          whereClauses.push(`${col}::text ILIKE $${params.length}`);
          break;
        }
        case 'in': {
          let list: any[] = [];
          if (Array.isArray(f.value)) {
            list = f.value;
          } else if (typeof f.value === 'string') {
            list = f.value.split(',').map((s) => s.trim());
          } else {
            list = [f.value];
          }
          params.push(list);
          whereClauses.push(`${col}::text = ANY($${params.length}::text[])`);
          break;
        }
        case 'isNull': {
          const isTrue = f.value === true || f.value === 'true' || f.value === 1 || f.value === '1';
          whereClauses.push(isTrue ? `${col} IS NULL` : `${col} IS NOT NULL`);
          break;
        }
      }
    }

    // 2. Keyset pagination clause
    if (options.cursor && Array.isArray(options.cursor.values)) {
      const cursorConditions: string[] = [];
      const sorts = options.sorts;

      for (let i = 0; i < sorts.length; i++) {
        const subConditions: string[] = [];
        // All previous sort keys equal
        for (let j = 0; j < i; j++) {
          params.push(options.cursor.values[j]);
          subConditions.push(`"${sorts[j].physicalColumn}" IS NOT DISTINCT FROM $${params.length}`);
        }
        // Current sort key compared
        const currentOp = sorts[i].direction === 'ASC' ? '>' : '<';
        params.push(options.cursor.values[i]);
        subConditions.push(`"${sorts[i].physicalColumn}" ${currentOp} $${params.length}`);
        cursorConditions.push(`(${subConditions.join(' AND ')})`);
      }

      if (cursorConditions.length > 0) {
        whereClauses.push(`(${cursorConditions.join(' OR ')})`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Order By
    const orderClauses = options.sorts.map(
      (s) => `"${s.physicalColumn}" ${s.direction} NULLS LAST`
    );
    const orderSql = orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : '';

    // Fetch limit + 1 to calculate nextCursor
    params.push(options.limit + 1);
    const limitSql = `LIMIT $${params.length}`;

    const sql = `
      SELECT *
      FROM "${schemaName}"."${physicalTableName}"
      ${whereSql}
      ${orderSql}
      ${limitSql}
    `;

    return { sql, params };
  }

  /**
   * Builds count query for total count when requested (?count=true)
   */
  buildCountQuery(
    schemaName: string,
    physicalTableName: string,
    filters: ParsedFilter[]
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    const whereClauses: string[] = [];

    for (const f of filters) {
      const col = `"${f.physicalColumn}"`;
      switch (f.op) {
        case 'eq':
          params.push(f.value);
          whereClauses.push(`${col} = $${params.length}`);
          break;
        case 'neq':
          params.push(f.value);
          whereClauses.push(`${col} != $${params.length}`);
          break;
        case 'gt':
          params.push(f.value);
          whereClauses.push(`${col} > $${params.length}`);
          break;
        case 'gte':
          params.push(f.value);
          whereClauses.push(`${col} >= $${params.length}`);
          break;
        case 'lt':
          params.push(f.value);
          whereClauses.push(`${col} < $${params.length}`);
          break;
        case 'lte':
          params.push(f.value);
          whereClauses.push(`${col} <= $${params.length}`);
          break;
        case 'contains': {
          const escaped = String(f.value).replace(/[%_]/g, '\\$&');
          params.push(`%${escaped}%`);
          whereClauses.push(`${col}::text ILIKE $${params.length}`);
          break;
        }
        case 'in': {
          let list: any[] = [];
          if (Array.isArray(f.value)) {
            list = f.value;
          } else if (typeof f.value === 'string') {
            list = f.value.split(',').map((s) => s.trim());
          } else {
            list = [f.value];
          }
          params.push(list);
          whereClauses.push(`${col}::text = ANY($${params.length}::text[])`);
          break;
        }
        case 'isNull': {
          const isTrue = f.value === true || f.value === 'true' || f.value === 1 || f.value === '1';
          whereClauses.push(isTrue ? `${col} IS NULL` : `${col} IS NOT NULL`);
          break;
        }
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*)::int AS total FROM "${schemaName}"."${physicalTableName}" ${whereSql}`;

    return { sql, params };
  }

  /**
   * Parse and validate aggregate parameters
   */
  parseAggregateParams(
    resolved: ResolvedEntity,
    rawQuery: Record<string, any>
  ): {
    op: 'count' | 'sum' | 'avg' | 'min' | 'max';
    physicalColumn: string;
    canonicalFieldName: string;
    filters: ParsedFilter[];
    groupByField?: { canonicalFieldName: string; physicalColumn: string };
    groupLimit?: number;
  } {
    const rawOp = String(rawQuery.op || '').toLowerCase().trim();
    const WHITELISTED_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;
    if (!WHITELISTED_OPS.includes(rawOp as any)) {
      throw new QueryError(
        `Invalid aggregate operation '${rawOp || '(empty)'}'. Whitelisted operations: count, sum, avg, min, max`
      );
    }
    const op = rawOp as 'count' | 'sum' | 'avg' | 'min' | 'max';

    const rawField = rawQuery.field ? String(rawQuery.field).trim() : '';
    let physicalColumn: string;
    let canonicalFieldName: string;

    if (op === 'count' && (!rawField || rawField === '*')) {
      physicalColumn = '*';
      canonicalFieldName = 'count';
    } else {
      if (!rawField) {
        throw new QueryError(`Aggregate operation '${op}' requires a 'field' parameter`);
      }

      // Check system fields or custom fields
      if (rawField === 'id' || rawField === 'created_at' || rawField === 'updated_at') {
        canonicalFieldName = rawField;
        physicalColumn = rawField;
        if (op === 'sum' || op === 'avg') {
          throw new QueryError(`Aggregate operation '${op}' is not supported on field '${rawField}'`);
        }
      } else {
        const fieldDef =
          resolved.fieldByName.get(rawField) || resolved.fieldById.get(rawField);
        if (!fieldDef) {
          throw new QueryError(
            `Field '${rawField}' not found in entity '${resolved.entity.name}'`
          );
        }

        canonicalFieldName = fieldDef.name;
        physicalColumn = fieldDef.physicalColumnName;

        if (op === 'sum' || op === 'avg') {
          if (fieldDef.type !== 'number') {
            throw new QueryError(
              `Aggregate operation '${op}' requires a numeric field, but '${fieldDef.name}' is of type '${fieldDef.type}'`
            );
          }
        } else if (op === 'min' || op === 'max') {
          if (fieldDef.type !== 'number' && fieldDef.type !== 'date') {
            throw new QueryError(
              `Aggregate operation '${op}' requires a numeric or date field, but '${fieldDef.name}' is of type '${fieldDef.type}'`
            );
          }
        }
      }
    }

    const filters = this.parseFilters(resolved, rawQuery);

    let groupByField: { canonicalFieldName: string; physicalColumn: string } | undefined;
    if (rawQuery.groupBy) {
      const rawGroupBy = String(rawQuery.groupBy).trim();
      const fieldDef = resolved.fieldByName.get(rawGroupBy) || resolved.fieldById.get(rawGroupBy);
      if (!fieldDef) {
        throw new QueryError(`Group by field '${rawGroupBy}' not found in entity '${resolved.entity.name}'`);
      }
      groupByField = { canonicalFieldName: fieldDef.name, physicalColumn: fieldDef.physicalColumnName };
    }

    let groupLimit = 50;
    if (rawQuery.groupLimit) {
      const parsedGroupLimit = parseInt(String(rawQuery.groupLimit), 10);
      if (isNaN(parsedGroupLimit) || parsedGroupLimit < 1) {
        throw new QueryError('groupLimit must be a positive integer');
      }
      if (parsedGroupLimit > 50) {
        throw new QueryError('Group limit exceeded: maximum 50 aggregate groups allowed');
      }
      groupLimit = parsedGroupLimit;
    }

    return { op, physicalColumn, canonicalFieldName, filters, groupByField, groupLimit };
  }

  buildAggregateQuery(
    schemaName: string,
    physicalTableName: string,
    op: 'count' | 'sum' | 'avg' | 'min' | 'max',
    physicalColumn: string,
    filters: ParsedFilter[],
    groupByField?: { canonicalFieldName: string; physicalColumn: string },
    groupLimit = 50
  ): { sql: string; params: any[] } {
    const whereClauses: string[] = [];
    const params: any[] = [];

    for (const f of filters) {
      const col = `"${f.physicalColumn}"`;
      switch (f.op) {
        case 'eq':
          params.push(f.value);
          whereClauses.push(`${col} = $${params.length}`);
          break;
        case 'neq':
          params.push(f.value);
          whereClauses.push(`${col} != $${params.length}`);
          break;
        case 'gt':
          params.push(f.value);
          whereClauses.push(`${col} > $${params.length}`);
          break;
        case 'gte':
          params.push(f.value);
          whereClauses.push(`${col} >= $${params.length}`);
          break;
        case 'lt':
          params.push(f.value);
          whereClauses.push(`${col} < $${params.length}`);
          break;
        case 'lte':
          params.push(f.value);
          whereClauses.push(`${col} <= $${params.length}`);
          break;
        case 'contains': {
          const escaped = String(f.value).replace(/[%_]/g, '\\$&');
          params.push(`%${escaped}%`);
          whereClauses.push(`${col}::text ILIKE $${params.length}`);
          break;
        }
        case 'in': {
          let list: any[] = [];
          if (Array.isArray(f.value)) {
            list = f.value;
          } else if (typeof f.value === 'string') {
            list = f.value.split(',').map((s) => s.trim());
          } else {
            list = [f.value];
          }
          params.push(list);
          whereClauses.push(`${col}::text = ANY($${params.length}::text[])`);
          break;
        }
        case 'isNull': {
          const isTrue = f.value === true || f.value === 'true' || f.value === 1 || f.value === '1';
          whereClauses.push(isTrue ? `${col} IS NULL` : `${col} IS NOT NULL`);
          break;
        }
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const colExpr = physicalColumn === '*' ? '*' : `"${physicalColumn}"`;

    let selectExpr: string;
    if (op === 'count') {
      selectExpr = `COUNT(${colExpr})::int`;
    } else if (op === 'avg' || op === 'sum') {
      selectExpr = `${op.toUpperCase()}(${colExpr})::numeric`;
    } else {
      selectExpr = `${op.toUpperCase()}(${colExpr})`;
    }

    if (groupByField) {
      const groupCol = `"${groupByField.physicalColumn}"`;
      const sql = `SELECT ${groupCol} AS group_key, ${selectExpr} AS value FROM "${schemaName}"."${physicalTableName}" ${whereSql} GROUP BY ${groupCol} LIMIT ${groupLimit};`;
      return { sql, params };
    }

    const sql = `SELECT ${selectExpr} AS value FROM "${schemaName}"."${physicalTableName}" ${whereSql};`;
    return { sql, params };
  }
}

export const queryBuilder = new QueryBuilder();
