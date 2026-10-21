import type { ResolvedEntity } from './entity-cache.js';
import { FILTER_OPS_BY_FIELD_TYPE, type FieldType, type FilterOp } from '@config-platform/schema';

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryError';
  }
}

export type { FilterOp };

// Shared with the page builder so it only offers operators the API accepts
const ALLOWED_OPS_BY_TYPE = FILTER_OPS_BY_FIELD_TYPE;

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
  /** Any-of group (`filter[a,b][op]=v`): matches when at least one member matches. */
  anyOf?: ParsedFilter[];
}

/** Separates the fields of an any-of filter key: `filter[machine_name,work_center][contains]`. */
export const FILTER_ANY_OF_SEPARATOR = ',';

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
    for (const [fieldKey, ops] of Object.entries(rawFilterMap)) {
      if (fieldKey.includes(FILTER_ANY_OF_SEPARATOR)) {
        // One condition over several fields, matched if any field matches
        const fieldNames = [...new Set(fieldKey.split(FILTER_ANY_OF_SEPARATOR).map((n) => n.trim()).filter(Boolean))];
        for (const [opStr, val] of Object.entries(ops)) {
          const anyOf = fieldNames.flatMap((name) =>
            this.parseFilters(resolvedEntity, { filter: { [name]: { [opStr]: val } } })
          );
          if (anyOf.length === 0) continue;
          filters.push({
            fieldName: anyOf.map((m) => m.fieldName).join(FILTER_ANY_OF_SEPARATOR),
            physicalColumn: anyOf[0].physicalColumn,
            op: opStr as FilterOp,
            value: val,
            type: anyOf[0].type,
            anyOf,
          });
        }
        continue;
      }
      const fieldName = fieldKey;
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

  /** Adds one WHERE condition per filter (an any-of group becomes one OR'ed condition). */
  private appendFilterClauses(filters: ParsedFilter[], params: any[], whereClauses: string[]): void {
    for (const f of filters) {
      const condition = f.anyOf
        ? `(${f.anyOf.map((member) => this.buildFilterCondition(member, params)).join(' OR ')})`
        : this.buildFilterCondition(f, params);
      whereClauses.push(condition);
    }
  }

  private buildFilterCondition(f: ParsedFilter, params: any[]): string {
    const col = `"${f.physicalColumn}"`;
    switch (f.op) {
      case 'eq':
        params.push(f.value);
        return `${col} = $${params.length}`;
      case 'neq':
        params.push(f.value);
        return `${col} != $${params.length}`;
      case 'gt':
        params.push(f.value);
        return `${col} > $${params.length}`;
      case 'gte':
        params.push(f.value);
        return `${col} >= $${params.length}`;
      case 'lt':
        params.push(f.value);
        return `${col} < $${params.length}`;
      case 'lte':
        params.push(f.value);
        return `${col} <= $${params.length}`;
      case 'contains': {
        // Escape wildcard chars to prevent injection
        const escaped = String(f.value).replace(/[%_]/g, '\\$&');
        params.push(`%${escaped}%`);
        return `${col}::text ILIKE $${params.length}`;
      }
      case 'in': {
        let list: any[];
        if (Array.isArray(f.value)) {
          list = f.value;
        } else if (typeof f.value === 'string') {
          list = f.value.split(',').map((s) => s.trim());
        } else {
          list = [f.value];
        }
        params.push(list);
        return `${col}::text = ANY($${params.length}::text[])`;
      }
      case 'isNull': {
        const isTrue = f.value === true || f.value === 'true' || f.value === 1 || f.value === '1';
        return isTrue ? `${col} IS NULL` : `${col} IS NOT NULL`;
      }
    }
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
    this.appendFilterClauses(options.filters, params, whereClauses);

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

    this.appendFilterClauses(filters, params, whereClauses);

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

    this.appendFilterClauses(filters, params, whereClauses);

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
      // Groups in key order (so the same groups come back every time); one extra row tells
      // the caller that more groups exist than the limit
      const sql = `SELECT ${groupCol} AS group_key, ${selectExpr} AS value FROM "${schemaName}"."${physicalTableName}" ${whereSql} GROUP BY ${groupCol} ORDER BY ${groupCol} ASC NULLS LAST LIMIT ${groupLimit + 1};`;
      return { sql, params };
    }

    const sql = `SELECT ${selectExpr} AS value FROM "${schemaName}"."${physicalTableName}" ${whereSql};`;
    return { sql, params };
  }
}

export const queryBuilder = new QueryBuilder();
