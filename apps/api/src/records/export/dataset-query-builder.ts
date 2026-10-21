import type {
  GridDatasetDefinition,
  GridDatasetJoin,
  GridDatasetField,
  GridDatasetFilter,
  GridDatasetSort,
  GridDatasetGroupBy,
  GridDatasetAggregate,
  GridDatasetHaving,
  GridParameterDefinition,
} from '@config-platform/schema';
import { GRID_LIMITS, evaluateExpression } from '@config-platform/schema';
import { entityCache, type ResolvedEntity } from '../entity-cache.js';
import { permissionService } from '../../permissions/permission-service.js';
import { defaultStorageAdapter } from '../../db/storage-adapter.js';
import { pool } from '../../db/pool.js';
import type { TenantRole } from '../../auth/auth-types.js';

/** Postgres type OIDs node-postgres returns as strings: INT8 (bigint, COUNT) and NUMERIC. */
const PG_STRING_NUMBER_TYPES = new Set([20, 1700]);

export class GridHydrationForbiddenError extends Error {
  public statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'GridHydrationForbiddenError';
  }
}

export class GridHydrationLimitError extends Error {
  public statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'GridHydrationLimitError';
  }
}

export interface BuildDatasetQueryOptions {
  tenantId: string;
  dataset: GridDatasetDefinition;
  userRole: TenantRole;
  parameters?: Record<string, any>;
  templateParameters?: GridParameterDefinition[];
  workspaceTimezone?: string;
  exportTimezoneOverride?: string;
  maxRows?: number;
  hiddenFieldIds?: Set<string>;
  entityPermissions?: Map<string, { canExport: boolean }>;
}

export interface ResolvedPathResult {
  tableAlias: string;
  resolvedEntity: ResolvedEntity;
  fieldDef: any;
  physicalColumn: string;
  isSystem: boolean;
}

export interface ResolvedJoinMeta {
  join: GridDatasetJoin;
  alias: string;
  parentAlias: string;
  parentEntity: ResolvedEntity;
  targetEntity: ResolvedEntity;
  referenceFieldDef: any;
}

export class DatasetQueryBuilder {
  /**
   * Resolves base entity and all joins (max 4), verifying existence and export permissions.
   */
  async resolveEntitiesAndJoins(
    tenantId: string,
    dataset: GridDatasetDefinition,
    userRole: TenantRole,
    overrideOptions?: {
      entityPermissions?: Map<string, { canExport: boolean }>;
      hiddenFieldIds?: Set<string>;
    }
  ): Promise<{
    baseEntity: ResolvedEntity;
    joinsMeta: Map<string, ResolvedJoinMeta>;
    aliasToEntity: Map<string, ResolvedEntity>;
    aliasToJoinMeta: Map<string, ResolvedJoinMeta>;
  }> {
    const baseEntityId = dataset.source.baseEntityId;
    const baseEntity = await entityCache.resolveEntity(tenantId, baseEntityId);
    if (!baseEntity) {
      throw new Error(`Dataset base entity '${baseEntityId}' not found`);
    }

    // Permission check for base entity
    let canExportBase = true;
    if (overrideOptions?.entityPermissions && overrideOptions.entityPermissions.has(baseEntity.entity.id)) {
      canExportBase = overrideOptions.entityPermissions.get(baseEntity.entity.id)!.canExport;
    } else {
      canExportBase = await permissionService.canExport(tenantId, baseEntity.entity.id, userRole);
    }
    if (!canExportBase) {
      throw new GridHydrationForbiddenError(
        `Role '${userRole}' does not have export permission for base entity '${baseEntity.entity.name}'`
      );
    }

    const rawJoins = dataset.source.joins || [];
    if (rawJoins.length > GRID_LIMITS.MAX_JOINS) {
      throw new Error(`Dataset exceeds maximum allowed joins (${GRID_LIMITS.MAX_JOINS})`);
    }

    const joinsMeta = new Map<string, ResolvedJoinMeta>();
    const aliasToEntity = new Map<string, ResolvedEntity>();
    const aliasToJoinMeta = new Map<string, ResolvedJoinMeta>();

    aliasToEntity.set('t0', baseEntity);
    aliasToEntity.set(baseEntity.entity.name.toLowerCase(), baseEntity);
    aliasToEntity.set(baseEntity.entity.id, baseEntity);

    for (let i = 0; i < rawJoins.length; i++) {
      const join = rawJoins[i];
      const joinAlias = `j${i + 1}`;
      const parentAlias = join.parentJoinId && joinsMeta.has(join.parentJoinId)
        ? joinsMeta.get(join.parentJoinId)!.alias
        : 't0';

      const parentEntity = aliasToEntity.get(parentAlias) || baseEntity;
      const refFieldDef =
        parentEntity.fieldById.get(join.referenceFieldId) ||
        parentEntity.fieldByName.get(join.referenceFieldId);

      if (!refFieldDef) {
        throw new Error(
          `Join reference field '${join.referenceFieldId}' not found on entity '${parentEntity.entity.name}'`
        );
      }

      if (refFieldDef.type !== 'reference') {
        throw new Error(
          `Field '${refFieldDef.name}' on entity '${parentEntity.entity.name}' is not a reference field (type: ${refFieldDef.type})`
        );
      }

      const targetEntityId = join.targetEntityId || refFieldDef.config?.targetEntityId;
      if (!targetEntityId) {
        throw new Error(`Reference field '${refFieldDef.name}' has no targetEntityId`);
      }

      const targetEntity = await entityCache.resolveEntity(tenantId, targetEntityId);
      if (!targetEntity) {
        throw new Error(`Joined target entity '${targetEntityId}' not found`);
      }

      // Security check: join path through hidden reference field is rejected!
      const parentHiddenFields = await permissionService.getHiddenFieldIds(
        tenantId,
        parentEntity.entity.id,
        userRole
      );
      if (overrideOptions?.hiddenFieldIds) {
        for (const hid of overrideOptions.hiddenFieldIds) parentHiddenFields.add(hid);
      }
      if (
        parentHiddenFields.has(refFieldDef.id) ||
        parentHiddenFields.has(refFieldDef.name) ||
        (overrideOptions?.hiddenFieldIds && (overrideOptions.hiddenFieldIds.has(refFieldDef.id) || overrideOptions.hiddenFieldIds.has(refFieldDef.name)))
      ) {
        throw new GridHydrationForbiddenError(
          `Join path traverses hidden reference field '${refFieldDef.name}' (${refFieldDef.id})`
        );
      }

      // Security check: canExport is required on EVERY entity touched
      let canExportTarget = true;
      if (overrideOptions?.entityPermissions && overrideOptions.entityPermissions.has(targetEntity.entity.id)) {
        canExportTarget = overrideOptions.entityPermissions.get(targetEntity.entity.id)!.canExport;
      } else {
        canExportTarget = await permissionService.canExport(tenantId, targetEntity.entity.id, userRole);
      }
      if (!canExportTarget) {
        throw new GridHydrationForbiddenError(
          `Role '${userRole}' does not have export permission for joined entity '${targetEntity.entity.name}'`
        );
      }

      const meta: ResolvedJoinMeta = {
        join,
        alias: joinAlias,
        parentAlias,
        parentEntity,
        targetEntity,
        referenceFieldDef: refFieldDef,
      };

      joinsMeta.set(join.id, meta);
      aliasToJoinMeta.set(joinAlias, meta);
      aliasToEntity.set(joinAlias, targetEntity);
      if (join.name) {
        aliasToEntity.set(join.name.toLowerCase(), targetEntity);
        aliasToJoinMeta.set(join.name.toLowerCase(), meta);
      }
      aliasToEntity.set(targetEntity.entity.name.toLowerCase(), targetEntity);
      aliasToEntity.set(targetEntity.entity.id, targetEntity);
    }

    return { baseEntity, joinsMeta, aliasToEntity, aliasToJoinMeta };
  }

  /**
   * Resolves field path (e.g. "machineLog.machine.line.name" or "line.name" or "col_name" or field ID)
   */
  resolveFieldPath(
    fieldPath: string,
    baseEntity: ResolvedEntity,
    joinsMeta: Map<string, ResolvedJoinMeta>,
    aliasToEntity: Map<string, ResolvedEntity>
  ): ResolvedPathResult {
    const rawTokens = fieldPath.split('.').map((t) => t.trim());
    let tokens = [...rawTokens];

    // Strip leading base entity name or id if present
    if (
      tokens.length > 1 &&
      (tokens[0].toLowerCase() === baseEntity.entity.name.toLowerCase() || tokens[0] === baseEntity.entity.id)
    ) {
      tokens.shift();
    }

    let targetEntity = baseEntity;
    let tableAlias = 't0';

    if (tokens.length === 1) {
      // Field directly on base entity or direct reference
      const fieldIdentifier = tokens[0];
      const fieldDef =
        baseEntity.fieldByName.get(fieldIdentifier) || baseEntity.fieldById.get(fieldIdentifier);
      const isSystem = baseEntity.systemFields.has(fieldIdentifier);

      if (!fieldDef && !isSystem) {
        throw new Error(
          `Unknown field '${fieldIdentifier}' on base entity '${baseEntity.entity.name}'`
        );
      }

      return {
        tableAlias,
        resolvedEntity: baseEntity,
        fieldDef,
        physicalColumn: fieldDef ? fieldDef.physicalColumnName : fieldIdentifier,
        isSystem,
      };
    }

    // Multi-token path: e.g. "machine.line.name"
    // Walk through joins
    let currentAlias = 't0';
    let currentEntity = baseEntity;

    for (let i = 0; i < tokens.length - 1; i++) {
      const step = tokens[i].toLowerCase();
      // Match step against join alias, join name, reference field name, or target entity name
      let foundMeta: ResolvedJoinMeta | undefined;
      for (const meta of joinsMeta.values()) {
        if (
          meta.parentAlias === currentAlias &&
          (meta.join.id === step ||
            meta.alias.toLowerCase() === step ||
            meta.join.name?.toLowerCase() === step ||
            meta.referenceFieldDef.name.toLowerCase() === step ||
            meta.referenceFieldDef.id === step ||
            meta.targetEntity.entity.name.toLowerCase() === step ||
            meta.targetEntity.entity.id === step)
        ) {
          foundMeta = meta;
          break;
        }
      }

      if (!foundMeta) {
        // Fallback: check if any join matches step regardless of parent
        for (const meta of joinsMeta.values()) {
          if (
            meta.alias.toLowerCase() === step ||
            meta.join.name?.toLowerCase() === step ||
            meta.referenceFieldDef.name.toLowerCase() === step ||
            meta.targetEntity.entity.name.toLowerCase() === step ||
            meta.targetEntity.entity.id === step
          ) {
            foundMeta = meta;
            break;
          }
        }
      }

      if (!foundMeta) {
        throw new Error(`Unable to resolve join step '${tokens[i]}' in path '${fieldPath}'`);
      }

      currentAlias = foundMeta.alias;
      currentEntity = foundMeta.targetEntity;
    }

    const finalFieldToken = tokens[tokens.length - 1];
    const finalFieldDef =
      currentEntity.fieldByName.get(finalFieldToken) || currentEntity.fieldById.get(finalFieldToken);
    const isSystem = currentEntity.systemFields.has(finalFieldToken);

    if (!finalFieldDef && !isSystem) {
      throw new Error(
        `Field '${finalFieldToken}' not found on entity '${currentEntity.entity.name}' along path '${fieldPath}'`
      );
    }

    return {
      tableAlias: currentAlias,
      resolvedEntity: currentEntity,
      fieldDef: finalFieldDef,
      physicalColumn: finalFieldDef ? finalFieldDef.physicalColumnName : finalFieldToken,
      isSystem,
    };
  }

  /**
   * Validates parameters against parameter definitions, enforces required flags and types.
   */
  validateAndBindParameters(
    parameters: Record<string, any> = {},
    definitions: GridParameterDefinition[] = []
  ): Record<string, any> {
    const bound: Record<string, any> = {};

    for (const def of definitions) {
      const rawVal = parameters[def.name] ?? parameters[def.id] ?? def.defaultValue;

      if (def.required && (rawVal === undefined || rawVal === null || rawVal === '')) {
        throw new Error(`Missing required parameter '${def.label || def.name}'`);
      }

      if (rawVal === undefined || rawVal === null) {
        bound[def.id] = null;
        bound[def.name] = null;
        continue;
      }

      let parsed = rawVal;
      switch (def.type) {
        case 'number': {
          parsed = Number(rawVal);
          if (isNaN(parsed)) {
            throw new Error(`Parameter '${def.name}' must be a valid number`);
          }
          break;
        }
        case 'boolean': {
          parsed = Boolean(rawVal === true || rawVal === 'true' || rawVal === 1);
          break;
        }
        case 'date': {
          if (typeof rawVal !== 'string' && !(rawVal instanceof Date)) {
            throw new Error(`Parameter '${def.name}' must be a valid date string`);
          }
          parsed = String(rawVal);
          break;
        }
        case 'date_range': {
          if (typeof rawVal !== 'object' || !rawVal.start || !rawVal.end) {
            throw new Error(`Parameter '${def.name}' must be an object with start and end dates`);
          }
          break;
        }
        default:
          parsed = String(rawVal);
      }

      bound[def.id] = parsed;
      bound[def.name] = parsed;
    }

    // Include any other caller supplied parameters
    for (const [k, v] of Object.entries(parameters)) {
      if (bound[k] === undefined) {
        bound[k] = v;
      }
    }

    return bound;
  }

  /**
   * Builds parameterized count and data queries with security permissions,
   * hidden field rejection, time bucketing, grouping, and aggregates.
   */
  async buildQueries(options: BuildDatasetQueryOptions): Promise<{
    countSql: string;
    countParams: any[];
    dataSql: string;
    dataParams: any[];
    effectiveTimezone: string;
    selectCols: Array<{
      id: string;
      name: string;
      alias: string;
      isComputed: boolean;
      expression?: string;
      fieldPath?: string;
    }>;
  }> {
    const {
      tenantId,
      dataset,
      userRole,
      parameters: rawParameters = {},
      templateParameters = [],
      exportTimezoneOverride,
      maxRows,
    } = options;

    const boundParameters = this.validateAndBindParameters(rawParameters, templateParameters);
    let tz =
      exportTimezoneOverride ||
      boundParameters['timezone'] ||
      boundParameters['timeZone'] ||
      options.workspaceTimezone;
    if (!tz) {
      try {
        const tenantRes = await pool.query<{ timezone: string }>(
          `SELECT timezone FROM public.tenant WHERE id = $1`,
          [tenantId]
        );
        tz = tenantRes.rows[0]?.timezone;
      } catch {}
    }
    const effectiveTimezone = tz || 'UTC';

    const { baseEntity, joinsMeta, aliasToEntity } = await this.resolveEntitiesAndJoins(
      tenantId,
      dataset,
      userRole,
      options
    );

    // Collect hidden field IDs for every entity touched
    const entityHiddenFields = new Map<string, Set<string>>();
    const baseHidden = await permissionService.getHiddenFieldIds(tenantId, baseEntity.entity.id, userRole);
    if (options.hiddenFieldIds) {
      for (const hid of options.hiddenFieldIds) baseHidden.add(hid);
    }
    entityHiddenFields.set(baseEntity.entity.id, baseHidden);

    for (const meta of joinsMeta.values()) {
      if (!entityHiddenFields.has(meta.targetEntity.entity.id)) {
        const jHidden = await permissionService.getHiddenFieldIds(
          tenantId,
          meta.targetEntity.entity.id,
          userRole
        );
        if (options.hiddenFieldIds) {
          for (const hid of options.hiddenFieldIds) jHidden.add(hid);
        }
        entityHiddenFields.set(meta.targetEntity.entity.id, jHidden);
      }
    }

    const checkFieldForbidden = (res: ResolvedPathResult, context = 'Field') => {
      if (res.fieldDef) {
        const hidden = entityHiddenFields.get(res.resolvedEntity.entity.id);
        if (hidden && (hidden.has(res.fieldDef.id) || hidden.has(res.fieldDef.name))) {
          throw new GridHydrationForbiddenError(
            `${context} '${res.fieldDef.name}' (${res.fieldDef.id}) references hidden field (hidden for role '${userRole}')`
          );
        }
      }
      if (
        options.hiddenFieldIds &&
        (options.hiddenFieldIds.has(res.physicalColumn) ||
          options.hiddenFieldIds.has(res.fieldDef?.id) ||
          options.hiddenFieldIds.has(res.fieldDef?.name))
      ) {
        throw new GridHydrationForbiddenError(
          `${context} '${res.fieldDef?.name || res.physicalColumn}' references hidden field`
        );
      }
    };

    const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
    const baseTable = `"${schemaName}"."${baseEntity.entity.physicalTableName}"`;

    // Construct FROM and JOIN clauses
    let fromSql = `${baseTable} AS t0`;
    for (const meta of joinsMeta.values()) {
      const joinType = meta.join.joinType === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
      const targetTable = `"${schemaName}"."${meta.targetEntity.entity.physicalTableName}"`;
      fromSql += `\n  ${joinType} ${targetTable} AS ${meta.alias} ON ${meta.alias}.id = ${meta.parentAlias}."${meta.referenceFieldDef.physicalColumnName}"`;
    }

    // Build WHERE clause
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const filter of dataset.filters || []) {
      const res = this.resolveFieldPath(filter.fieldPath, baseEntity, joinsMeta, aliasToEntity);
      checkFieldForbidden(res);

      let val = filter.value;
      if (filter.parameterId) {
        val = boundParameters[filter.parameterId];
      }

      const colExpr = `${res.tableAlias}."${res.physicalColumn}"`;

      switch (filter.operator) {
        case 'eq':
          whereConditions.push(`${colExpr} = $${paramIndex++}`);
          params.push(val);
          break;
        case 'neq':
          whereConditions.push(`${colExpr} != $${paramIndex++}`);
          params.push(val);
          break;
        case 'gt':
          whereConditions.push(`${colExpr} > $${paramIndex++}`);
          params.push(val);
          break;
        case 'gte':
          whereConditions.push(`${colExpr} >= $${paramIndex++}`);
          params.push(val);
          break;
        case 'lt':
          whereConditions.push(`${colExpr} < $${paramIndex++}`);
          params.push(val);
          break;
        case 'lte':
          whereConditions.push(`${colExpr} <= $${paramIndex++}`);
          params.push(val);
          break;
        case 'contains':
          whereConditions.push(`${colExpr}::text ILIKE $${paramIndex++}`);
          params.push(`%${val}%`);
          break;
        case 'in':
          whereConditions.push(`${colExpr} = ANY($${paramIndex++})`);
          params.push(Array.isArray(val) ? val : [val]);
          break;
        case 'is_null':
          whereConditions.push(`${colExpr} IS NULL`);
          break;
        case 'not_null':
          whereConditions.push(`${colExpr} IS NOT NULL`);
          break;
        case 'between':
          if (Array.isArray(val) && val.length >= 2) {
            whereConditions.push(`${colExpr} BETWEEN $${paramIndex++} AND $${paramIndex++}`);
            params.push(val[0]);
            params.push(val[1]);
          } else if (val && typeof val === 'object' && val.start && val.end) {
            whereConditions.push(`${colExpr} BETWEEN $${paramIndex++} AND $${paramIndex++}`);
            params.push(val.start);
            params.push(val.end);
          }
          break;
        default:
          whereConditions.push(`${colExpr} = $${paramIndex++}`);
          params.push(val);
      }
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Check if query is grouped or aggregate
    const hasGroupBy = (dataset.groupBy || []).length > 0;
    const hasAggregates = (dataset.aggregates || []).length > 0;
    const hasDetailFields = (dataset.fields || []).some((f) => !f.expression);
    const isAggregateQuery = hasGroupBy || (hasAggregates && !hasDetailFields);
    const isDetailWithWindowAggregates = !hasGroupBy && hasAggregates && hasDetailFields;

    const selectCols: Array<{
      id: string;
      name: string;
      alias: string;
      isComputed: boolean;
      expression?: string;
      fieldPath?: string;
    }> = [];

    let selectItemsSql: string[] = [];
    const groupBySqlItems: string[] = [];
    const aggregateAliasMap = new Map<string, string>(); // agg.id -> SQL aggregate expression

    if (isAggregateQuery) {
      // 1. Group By fields
      for (let gIdx = 0; gIdx < (dataset.groupBy || []).length; gIdx++) {
        const gb = dataset.groupBy[gIdx];
        const res = this.resolveFieldPath(gb.fieldPath, baseEntity, joinsMeta, aliasToEntity);
        checkFieldForbidden(res);

        const colExpr = `${res.tableAlias}."${res.physicalColumn}"`;
        const alias = `g_${gIdx}_${res.physicalColumn}`;

        if (gb.dateBucket) {
          // Time bucketing with timezone
          const allowedBuckets = ['hour', 'day', 'week', 'month', 'year'];
          const bucket = allowedBuckets.includes(gb.dateBucket) ? gb.dateBucket : 'day';
          const tzPlaceholder = `$${paramIndex++}`;
          params.push(effectiveTimezone);

          const dateTruncExpr = `(date_trunc('${bucket}', (${colExpr} AT TIME ZONE ${tzPlaceholder})) AT TIME ZONE ${tzPlaceholder})::text`;
          selectItemsSql.push(`${dateTruncExpr} AS "${alias}"`);
          groupBySqlItems.push(dateTruncExpr);
        } else {
          selectItemsSql.push(`${colExpr} AS "${alias}"`);
          groupBySqlItems.push(colExpr);
        }

        selectCols.push({
          id: gb.fieldPath,
          name: gb.fieldPath,
          alias,
          isComputed: false,
          fieldPath: gb.fieldPath,
        });
      }

      // 2. Aggregates
      for (const agg of dataset.aggregates || []) {
        let aggColExpr = '*';
        if (agg.fieldPath) {
          const res = this.resolveFieldPath(agg.fieldPath, baseEntity, joinsMeta, aliasToEntity);
          checkFieldForbidden(res);
          aggColExpr = `${res.tableAlias}."${res.physicalColumn}"`;
        }

        let aggSql = '';
        const aggFn = agg.fn || (agg as any).op;
        switch (aggFn) {
          case 'sum':
            aggSql = `COALESCE(SUM(${aggColExpr}), 0)`;
            break;
          case 'avg':
            aggSql = `AVG(${aggColExpr})`;
            break;
          case 'min':
            aggSql = `MIN(${aggColExpr})`;
            break;
          case 'max':
            aggSql = `MAX(${aggColExpr})`;
            break;
          case 'count':
            aggSql = `COUNT(${aggColExpr})`;
            break;
          case 'count_distinct':
            aggSql = `COUNT(DISTINCT ${aggColExpr})`;
            break;
          default:
            aggSql = `COUNT(*)`;
        }

        const alias = agg.id;
        aggregateAliasMap.set(agg.id, aggSql);
        selectItemsSql.push(`${aggSql} AS "${alias}"`);
        selectCols.push({
          id: agg.id,
          name: agg.name || agg.id,
          alias,
          isComputed: false,
          fieldPath: agg.fieldPath,
        });
      }

      // 3. Computed columns over group results
      for (const f of dataset.fields || []) {
        if (f.expression) {
          this.validateComputedColumnTokens(
            f.expression,
            entityHiddenFields,
            baseEntity,
            joinsMeta
          );
          selectCols.push({
            id: f.id,
            name: f.name,
            alias: f.id,
            isComputed: true,
            expression: f.expression,
            fieldPath: f.fieldPath || f.name,
          });
        }
      }
    } else {
      // Regular non-grouped SELECT query
      for (const f of dataset.fields || []) {
        if (f.expression) {
          this.validateComputedColumnTokens(
            f.expression,
            entityHiddenFields,
            baseEntity,
            joinsMeta
          );
          selectCols.push({
            id: f.id,
            name: f.name,
            alias: f.id,
            isComputed: true,
            expression: f.expression,
            fieldPath: f.fieldPath || f.name,
          });
        } else {
          const res = this.resolveFieldPath(f.fieldPath, baseEntity, joinsMeta, aliasToEntity);

          if (dataset.isImplicit) {
            const isHidden =
              (res.fieldDef &&
                entityHiddenFields.get(res.resolvedEntity.entity.id)?.has(res.fieldDef.id)) ||
              (res.fieldDef &&
                entityHiddenFields.get(res.resolvedEntity.entity.id)?.has(res.fieldDef.name)) ||
              (options.hiddenFieldIds &&
                (options.hiddenFieldIds.has(res.physicalColumn) ||
                  options.hiddenFieldIds.has(res.fieldDef?.id) ||
                  options.hiddenFieldIds.has(res.fieldDef?.name)));

            if (isHidden) {
              const alias = f.id;
              selectItemsSql.push(`NULL::text AS "${alias}"`);
              selectCols.push({
                id: f.id,
                name: f.name,
                alias,
                isComputed: false,
                fieldPath: f.fieldPath,
              });
              continue;
            }
          }

          checkFieldForbidden(res);

          const alias = f.id;
          selectItemsSql.push(`${res.tableAlias}."${res.physicalColumn}" AS "${alias}"`);
          selectCols.push({
            id: f.id,
            name: f.name,
            alias,
            isComputed: false,
            fieldPath: f.fieldPath,
          });
        }
      }

      // If dataset defines detail fields AND aggregates without groupBy, compute aggregates over the window
      if (isDetailWithWindowAggregates) {
        for (const agg of dataset.aggregates || []) {
          let aggColExpr = '*';
          if (agg.fieldPath) {
            const res = this.resolveFieldPath(agg.fieldPath, baseEntity, joinsMeta, aliasToEntity);
            checkFieldForbidden(res);
            aggColExpr = `${res.tableAlias}."${res.physicalColumn}"`;
          }

          let aggSql = '';
          const aggFn = agg.fn || (agg as any).op;
          switch (aggFn) {
            case 'sum':
              aggSql = `COALESCE(SUM(${aggColExpr}) OVER (), 0)`;
              break;
            case 'avg':
              aggSql = `AVG(${aggColExpr}) OVER ()`;
              break;
            case 'min':
              aggSql = `MIN(${aggColExpr}) OVER ()`;
              break;
            case 'max':
              aggSql = `MAX(${aggColExpr}) OVER ()`;
              break;
            case 'count':
              aggSql = `COUNT(${aggColExpr}) OVER ()`;
              break;
            case 'count_distinct':
              aggSql = `COUNT(${aggColExpr}) OVER ()`;
              break;
            default:
              aggSql = `COUNT(*) OVER ()`;
          }

          const alias = agg.id;
          aggregateAliasMap.set(agg.id, aggSql);
          selectItemsSql.push(`${aggSql} AS "${alias}"`);
          selectCols.push({
            id: agg.id,
            name: agg.name || agg.id,
            alias,
            isComputed: false,
            fieldPath: agg.fieldPath,
          });
        }
      }

      // If no fields specified, select all columns from base entity
      if (selectItemsSql.length === 0) {
        selectItemsSql.push('t0.*');
      }
    }

    // Build GROUP BY and HAVING clauses
    let groupByClause = '';
    if (groupBySqlItems.length > 0) {
      groupByClause = `GROUP BY ${groupBySqlItems.join(', ')}`;
    }

    let havingClause = '';
    if ((dataset.having || []).length > 0 && isAggregateQuery) {
      const havingConditions: string[] = [];
      for (const h of dataset.having || []) {
        const aggSql = aggregateAliasMap.get(h.aggregateId);
        if (!aggSql) {
          throw new Error(`HAVING references unknown aggregate '${h.aggregateId}'`);
        }

        let val = h.value;
        if (h.parameterId) {
          val = boundParameters[h.parameterId];
        }

        const opMap: Record<string, string> = {
          eq: '=',
          neq: '!=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
        };
        const op = opMap[h.operator] || '>';
        havingConditions.push(`${aggSql} ${op} $${paramIndex++}`);
        params.push(val);
      }
      havingClause = `HAVING ${havingConditions.join(' AND ')}`;
    }

    // Build ORDER BY clause
    const sortItems: string[] = [];
    for (const s of dataset.sort || []) {
      const dir = s.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      // Sort could be an aggregate ID, a grouped column (sorted by its output alias so date
      // buckets order correctly), or a field
      const groupedCol = isAggregateQuery
        ? selectCols.find((col) => col.alias.startsWith('g_') && col.fieldPath === s.fieldPath)
        : undefined;
      if (aggregateAliasMap.has(s.fieldPath)) {
        sortItems.push(`"${s.fieldPath}" ${dir}`);
      } else if (groupedCol) {
        sortItems.push(`"${groupedCol.alias}" ${dir}`);
      } else {
        const res = this.resolveFieldPath(s.fieldPath, baseEntity, joinsMeta, aliasToEntity);
        checkFieldForbidden(res);
        sortItems.push(`${res.tableAlias}."${res.physicalColumn}" ${dir}`);
      }
    }
    const orderClause = sortItems.length > 0 ? `ORDER BY ${sortItems.join(', ')}` : '';

    // Cap limit
    const rowLimit = Math.min(
      maxRows || GRID_LIMITS.MAX_RENDERED_DATA_ROWS,
      dataset.limit || GRID_LIMITS.MAX_RENDERED_DATA_ROWS,
      GRID_LIMITS.MAX_RENDERED_DATA_ROWS
    );

    // Build COUNT SQL (before loading rows)
    let countSql = '';
    const countParams = [...params];

    if (isAggregateQuery) {
      // Group count cap query
      countSql = `SELECT COUNT(*) AS total FROM (\n  SELECT 1 FROM ${fromSql} ${whereSql} ${groupByClause} ${havingClause}\n) AS grp_count`;
    } else {
      countSql = `SELECT COUNT(*) AS total FROM ${fromSql} ${whereSql}`;
    }

    // Build DATA SQL
    const dataSql = `SELECT ${selectItemsSql.join(', ')}\nFROM ${fromSql}\n${whereSql}\n${groupByClause}\n${havingClause}\n${orderClause}\nLIMIT ${rowLimit}`;
    const dataParams = [...params];

    return {
      countSql,
      countParams,
      dataSql,
      dataParams,
      effectiveTimezone,
      selectCols,
    };
  }

  /**
   * Evaluates computed column tokens to ensure no hidden field is accessed.
   */
  private validateComputedColumnTokens(
    expression: string,
    entityHiddenFields: Map<string, Set<string>>,
    baseEntity: ResolvedEntity,
    joinsMeta: Map<string, ResolvedJoinMeta>
  ): void {
    if (!expression) return;
    const allHidden = new Set<string>();
    for (const hSet of entityHiddenFields.values()) {
      for (const id of hSet) allHidden.add(id);
    }
    const allEntities = [baseEntity, ...Array.from(joinsMeta.values()).map((j) => j.targetEntity)];
    for (const ent of allEntities) {
      for (const field of ent.fields) {
        if (allHidden.has(field.id) || allHidden.has(field.name)) {
          allHidden.add(field.id);
          allHidden.add(field.name);
        }
      }
    }

    // Extract identifiers from expression
    const tokens = expression.match(/[a-zA-Z_][a-zA-Z0-9_\.]*/g) || [];
    for (const token of tokens) {
      const lastToken = token.split('.').pop() || token;
      if (allHidden.has(token) || allHidden.has(lastToken)) {
        throw new GridHydrationForbiddenError(
          `Computed column expression '${expression}' accesses hidden field '${token}'`
        );
      }
    }
  }

  /**
   * Executes the dataset query against PostgreSQL with statement timeout,
   * enforces count-before-load cap and group cap, and computes computed columns.
   */
  async executeDataset(
    options: BuildDatasetQueryOptions
  ): Promise<{ rows: any[]; totalCount: number; isGrouped: boolean }> {
    const { tenantId } = options;
    const { countSql, countParams, dataSql, dataParams, selectCols } = await this.buildQueries(options);

    const hasGroupBy = (options.dataset.groupBy || []).length > 0;
    const hasAggregates = (options.dataset.aggregates || []).length > 0;
    const isGrouped = hasGroupBy || hasAggregates;

    // 1. Check count before loading rows
    const countRes = await pool.query<{ total: number | string }>(countSql, countParams);
    const totalCount = Number(countRes.rows[0]?.total || 0);

    if (isGrouped && totalCount > GRID_LIMITS.MAX_GROUPS) {
      throw new GridHydrationLimitError(
        `Export exceeds maximum group cap of ${GRID_LIMITS.MAX_GROUPS.toLocaleString()} (found ${totalCount.toLocaleString()} groups)`
      );
    }

    if (totalCount > GRID_LIMITS.MAX_RENDERED_DATA_ROWS) {
      throw new GridHydrationLimitError(
        `Export exceeds maximum rendered data rows cap of ${GRID_LIMITS.MAX_RENDERED_DATA_ROWS.toLocaleString()} (found ${totalCount.toLocaleString()} rows)`
      );
    }

    // 2. Fetch data rows inside tenant transaction with statement timeout
    const rows = await defaultStorageAdapter.transaction(tenantId, async (tx) => {
      // Set query statement timeout per requirement
      await tx.client.query(`SET LOCAL statement_timeout = '15000ms'`);

      const dataRes = await tx.client.query(dataSql, dataParams);
      const rawRows = dataRes.rows;

      // node-postgres returns NUMERIC and BIGINT (incl. COUNT/SUM results) as strings. Exports
      // must write numbers, otherwise Excel stores "26" as text and SUM/IF formulas skip it.
      const numericColumns = (dataRes.fields || [])
        .filter((f: { dataTypeID: number }) => PG_STRING_NUMBER_TYPES.has(f.dataTypeID))
        .map((f: { name: string }) => f.name);
      if (numericColumns.length > 0) {
        for (const row of rawRows) {
          for (const name of numericColumns) {
            const v = row[name];
            if (typeof v === 'string' && v.trim() !== '') {
              const n = Number(v);
              if (Number.isFinite(n)) row[name] = n;
            }
          }
        }
      }

      // 3. Process rows: map friendly identifiers onto rowObj and evaluate computed expressions
      const processedRows = rawRows.map((row) => {
        const rowObj: Record<string, any> = { ...row };

        for (const col of selectCols) {
          const val = row[col.alias];
          if (val !== undefined) {
            rowObj[col.alias] = val;
            if (col.id) rowObj[col.id] = val;
            if (col.name) rowObj[col.name] = val;
            if (col.fieldPath) rowObj[col.fieldPath] = val;
          }
        }

        for (const col of selectCols) {
          if (col.isComputed && col.expression) {
            try {
              const computedVal = evaluateExpression(col.expression, rowObj);
              rowObj[col.alias] = computedVal;
              if (col.id) rowObj[col.id] = computedVal;
              if (col.name) rowObj[col.name] = computedVal;
              if (col.fieldPath) rowObj[col.fieldPath] = computedVal;
            } catch {
              rowObj[col.alias] = null;
              if (col.id) rowObj[col.id] = null;
              if (col.name) rowObj[col.name] = null;
              if (col.fieldPath) rowObj[col.fieldPath] = null;
            }
          }
        }
        return rowObj;
      });

      return { rows: processedRows, totalCount };
    });

    return { ...rows, isGrouped };
  }

  executeDatasetQuery(
    dataset: GridDatasetDefinition,
    options: {
      tenantId: string;
      userRole?: TenantRole;
      exportParams?: Record<string, any>;
      parameters?: Record<string, any>;
      templateParameters?: GridParameterDefinition[];
      workspaceTimezone?: string;
      exportTimezoneOverride?: string;
      maxRows?: number;
      hiddenFieldIds?: Set<string>;
      entityPermissions?: Map<string, { canExport: boolean }>;
    }
  ) {
    return this.executeDataset({
      tenantId: options.tenantId,
      dataset,
      userRole: (options.userRole || 'admin') as TenantRole,
      parameters: options.parameters || options.exportParams || {},
      templateParameters: options.templateParameters || [],
      workspaceTimezone: options.workspaceTimezone,
      exportTimezoneOverride: options.exportTimezoneOverride || options.exportParams?.timezone,
      maxRows: options.maxRows,
      hiddenFieldIds: options.hiddenFieldIds,
      entityPermissions: options.entityPermissions,
    });
  }
}

export const datasetQueryBuilder = new DatasetQueryBuilder();
