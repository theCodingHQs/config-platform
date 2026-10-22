import type {
  CreateEntityInput,
  UpdateEntityInput,
  AddFieldInput,
  UpdateFieldInput,
  DropFieldInput,
  SetUniqueRulesInput,
  UniqueRule,
  DropEntityInput,
  AddRelationInput,
  MigrationResult,
  FieldDef,
  EntityDef,
  RelationDef,
} from '@config-platform/schema';
import {
  generateTableId,
  generateColumnId,
  generateRelationId,
} from '../utils/id-gen.js';
import {
  type StorageAdapter,
  defaultStorageAdapter,
  type TenantTransaction,
} from '../db/storage-adapter.js';
import {
  ddlGenerator,
  UnsafeConversionError,
  type PhysicalColumnDef,
} from './ddl-generator.js';
import { tenantMigrationQueue } from './queue.js';
import { entityCache } from '../records/entity-cache.js';
import { calculatedFieldsService, CalculatedFieldError } from '../records/calculated-fields-service.js';
import { pool } from '../db/pool.js';
import crypto from 'node:crypto';

/** A unique-combination change that can't be applied (409, with a readable reason). */
export class UniqueRuleError extends Error {
  public statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'Conflict';
  }
}

function formatKeyValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value === null || value === undefined ? '(empty)' : String(value);
}

export class OptimisticLockError extends Error {
  constructor(entityId: string, expectedVersion: number, currentVersion: number) {
    super(
      `Optimistic lock failure for entity ${entityId}: expected version ${expectedVersion}, but found ${currentVersion}`
    );
    this.name = 'OptimisticLockError';
  }
}

export class MigrationService {
  constructor(private storage: StorageAdapter = defaultStorageAdapter) {}

  /**
   * Initialize a new tenant in catalog and storage
   */
  async provisionTenant(tenantId: string, name: string): Promise<void> {
    await this.storage.initTenant(tenantId);

    const client = await (this.storage as any).dbPool.connect();
    try {
      await client.query(
        `INSERT INTO public.tenant (id, name, schema_version, timezone)
         VALUES ($1, $2, 1, 'UTC')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [tenantId, name]
      );
    } finally {
      client.release();
    }
  }

  async getTenantTimezone(tenantId: string): Promise<string> {
    const res = await pool.query<{ timezone?: string }>(
      `SELECT timezone FROM public.tenant WHERE id = $1`,
      [tenantId]
    );
    return res.rows[0]?.timezone || 'UTC';
  }

  async setTenantTimezone(tenantId: string, timezone: string): Promise<void> {
    await pool.query(
      `UPDATE public.tenant SET timezone = $1 WHERE id = $2`,
      [timezone, tenantId]
    );
  }

  /**
   * Helper to record migration and bump schema version inside transaction
   */
  private async recordMigration(
    tx: TenantTransaction,
    ddl: string,
    status: 'applied' | 'failed' = 'applied'
  ): Promise<{ migrationId: string; version: number }> {
    const resVer = await tx.client.query<{ max_ver: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS max_ver FROM public.schema_migration WHERE tenant_id = $1`,
      [tx.tenantId]
    );
    const nextVersion = Number(resVer.rows[0]?.max_ver || 1);
    const migrationId = `m_${crypto.randomBytes(4).toString('hex')}`;

    await tx.client.query(
      `INSERT INTO public.schema_migration (id, tenant_id, version, ddl, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [migrationId, tx.tenantId, nextVersion, ddl, status]
    );

    await tx.client.query(
      `UPDATE public.tenant SET schema_version = $1 WHERE id = $2`,
      [nextVersion, tx.tenantId]
    );

    entityCache.invalidate(tx.tenantId);

    return { migrationId, version: nextVersion };
  }

  /**
   * 1. Create Entity with stable table ID (t_xxxx)
   */
  async createEntity(
    tenantId: string,
    input: CreateEntityInput
  ): Promise<MigrationResult & { entity: EntityDef; fields: FieldDef[] }> {
    // Formulas in a new entity are checked before anything is created
    if (input.fields?.some((f: any) => f.config?.formula)) {
      await calculatedFieldsService.plan(tenantId, input.fields as any);
    }
    const result = await tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        // Check uniqueness of entity name in tenant
        const existing = await tx.client.query(
          `SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`,
          [tenantId, input.name]
        );
        if (existing.rows.length > 0) {
          throw new Error(`Entity with name '${input.name}' already exists in tenant`);
        }

        const tableId = generateTableId();
        const schemaName = tx.schemaName;

        // Prepare fields
        const physicalColumns: PhysicalColumnDef[] = [];
        const createdFields: FieldDef[] = [];

        // Insert entity definition in catalog
        const entityRes = await tx.client.query<EntityDef>(
          `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version, display_field_id, icon, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 1, $6, $7, NOW(), NOW())
           RETURNING id, tenant_id AS "tenantId", name, label, physical_table_name AS "physicalTableName", version, display_field_id AS "displayFieldId", icon, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [tableId, tenantId, input.name, input.label, tableId, input.displayFieldId || null, input.icon || null]
        );
        const entity = entityRes.rows[0];

        let pos = 0;
        for (const f of input.fields) {
          pos++;
          const colId = generateColumnId();
          const fieldRes = await tx.client.query<FieldDef>(
            `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, physical_column_name, type, required, is_unique, is_primary, position, config, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
             RETURNING id, tenant_id AS "tenantId", entity_id AS "entityId", name, label, physical_column_name AS "physicalColumnName", type, required, is_unique AS "unique", is_primary AS "isPrimary", position, config, created_at AS "createdAt", updated_at AS "updatedAt"`,
            [
              colId,
              tenantId,
              tableId,
              f.name,
              f.label,
              colId,
              f.type,
              f.required || false,
              f.unique || false,
              false,
              pos,
              JSON.stringify(f.config || {}),
            ]
          );
          createdFields.push(fieldRes.rows[0]);
          physicalColumns.push({
            columnId: colId,
            type: f.type,
            required: f.required,
            unique: f.unique,
            config: f.config,
          });
        }

        // Generate and execute physical DDL
        const ddl = ddlGenerator.generateCreateTableDDL(
          schemaName,
          tableId,
          physicalColumns
        );
        await tx.execute(ddl);

        // Record migration
        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: tableId,
          entity,
          fields: createdFields,
        };
      });
    });
    return result;
  }

  /**
   * 2. Update Entity (rename name/label) with optimistic locking
   */
  async updateEntity(
    tenantId: string,
    input: UpdateEntityInput
  ): Promise<MigrationResult & { entity: EntityDef }> {
    return tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        // Lock entity row and verify expected version
        const entityRes = await tx.client.query<{
          id: string;
          version: number;
          name: string;
          label: string;
          physical_table_name: string;
          display_field_id?: string | null;
          icon?: string | null;
        }>(
          `SELECT id, version, name, label, physical_table_name, display_field_id, icon FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );

        if (entityRes.rows.length === 0) {
          throw new Error(`Entity not found: ${input.entityId}`);
        }

        const current = entityRes.rows[0];
        if (current.version !== input.expectedVersion) {
          throw new OptimisticLockError(
            input.entityId,
            input.expectedVersion,
            current.version
          );
        }

        const newName = input.name || current.name;
        const newLabel = input.label || current.label;
        const newDisplayFieldId = input.displayFieldId !== undefined ? input.displayFieldId : (current as any).display_field_id;
        const newIcon = input.icon !== undefined ? input.icon : (current as any).icon;

        // Update metadata catalog (physical table name remains stable!)
        const updateRes = await tx.client.query<EntityDef>(
          `UPDATE public.entity_def
           SET name = $1, label = $2, display_field_id = $3, icon = $4, version = version + 1, updated_at = NOW()
           WHERE id = $5
           RETURNING id, tenant_id AS "tenantId", name, label, physical_table_name AS "physicalTableName", version, display_field_id AS "displayFieldId", icon, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [newName, newLabel, newDisplayFieldId, newIcon, input.entityId]
        );

        const ddl = `-- Metadata only rename: Entity ${input.entityId} ('${current.label}' -> '${newLabel}', slug='${newName}')`;
        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
          entity: updateRes.rows[0],
        };
      });
    });
  }

  /**
   * 3. Drop Entity with optimistic locking
   */
  async dropEntity(
    tenantId: string,
    input: DropEntityInput
  ): Promise<MigrationResult> {
    return tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        const entityRes = await tx.client.query<{
          id: string;
          version: number;
          physical_table_name: string;
        }>(
          `SELECT id, version, physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );

        if (entityRes.rows.length === 0) {
          throw new Error(`Entity not found: ${input.entityId}`);
        }

        const current = entityRes.rows[0];
        if (current.version !== input.expectedVersion) {
          throw new OptimisticLockError(
            input.entityId,
            input.expectedVersion,
            current.version
          );
        }

        const ddl = ddlGenerator.generateDropTableDDL(
          tx.schemaName,
          current.physical_table_name
        );
        await tx.execute(ddl);

        // Delete from metadata catalog (cascades to field_def & relation_def)
        await tx.client.query(
          `DELETE FROM public.entity_def WHERE id = $1 AND tenant_id = $2`,
          [input.entityId, tenantId]
        );

        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
        };
      });
    });
  }

  /**
   * 4. Add Field to an Entity with optimistic locking
   */
  async addField(
    tenantId: string,
    input: AddFieldInput
  ): Promise<MigrationResult & { field: FieldDef }> {
    // A calculated field must have a valid formula before its column is created
    const addsFormula = Boolean((input.config as any)?.formula);
    if (addsFormula) {
      const current = await entityCache.resolveEntity(tenantId, input.entityId);
      await calculatedFieldsService.plan(tenantId, [...current.fields, { name: input.name, type: input.type, config: input.config } as any]);
    }
    const result = await tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        const entityRes = await tx.client.query<{
          id: string;
          version: number;
          physical_table_name: string;
        }>(
          `SELECT id, version, physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );

        if (entityRes.rows.length === 0) {
          throw new Error(`Entity not found: ${input.entityId}`);
        }

        const entity = entityRes.rows[0];
        if (entity.version !== input.expectedVersion) {
          throw new OptimisticLockError(
            input.entityId,
            input.expectedVersion,
            entity.version
          );
        }

        // Check if field name already exists in entity
        const existingField = await tx.client.query(
          `SELECT id FROM public.field_def WHERE entity_id = $1 AND name = $2`,
          [input.entityId, input.name]
        );
        if (existingField.rows.length > 0) {
          throw new Error(`Field with name '${input.name}' already exists in entity`);
        }

        const colId = generateColumnId();
        const physicalCol: PhysicalColumnDef = {
          columnId: colId,
          type: input.type,
          required: input.required,
          unique: input.unique,
          config: input.config,
        };

        const maxPosRes = await tx.client.query(
          `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM public.field_def WHERE entity_id = $1`,
          [input.entityId]
        );
        const nextPos = Number(maxPosRes.rows[0].next_pos);

        // Insert field definition into catalog
        const fieldRes = await tx.client.query<FieldDef>(
          `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, physical_column_name, type, required, is_unique, is_primary, position, config, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
           RETURNING id, tenant_id AS "tenantId", entity_id AS "entityId", name, label, physical_column_name AS "physicalColumnName", type, required, is_unique AS "unique", is_primary AS "isPrimary", position, config, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [
            colId,
            tenantId,
            input.entityId,
            input.name,
            input.label,
            colId,
            input.type,
            input.required || false,
            input.unique || false,
            false,
            nextPos,
            JSON.stringify(input.config || {}),
          ]
        );

        // Generate and execute physical DDL
        const ddl = ddlGenerator.generateAddColumnDDL(
          tx.schemaName,
          entity.physical_table_name,
          physicalCol
        );
        await tx.execute(ddl);

        // Increment entity version for optimistic locking
        await tx.client.query(
          `UPDATE public.entity_def SET version = version + 1, updated_at = NOW() WHERE id = $1`,
          [input.entityId]
        );

        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
          field: fieldRes.rows[0],
        };
      });
    });
    // Existing records get the new field's value
    if (addsFormula) await calculatedFieldsService.recalculate(tenantId, input.entityId);
    return result;
  }

  /**
   * 5. Update Field (label, config, or type change with expand/contract)
   */
  async updateField(
    tenantId: string,
    input: UpdateFieldInput
  ): Promise<MigrationResult & { field: FieldDef }> {
    // Formulas are checked against the field as it will be; renaming a field other formulas use
    // would break them, so it's refused with the list of formulas
    const before = await entityCache.resolveEntity(tenantId, input.entityId);
    const currentField = before.fieldById.get(input.fieldId);
    let formulaChanged = false;
    if (currentField) {
      const nextName = input.name ?? currentField.name;
      if (nextName !== currentField.name) {
        const usages = await calculatedFieldsService.usagesOf(tenantId, before, currentField.name);
        if (usages.length) {
          throw new CalculatedFieldError(`Can't rename '${currentField.name}': it's used by ${usages.join(', ')}. Update those formulas first.`);
        }
      }
      const nextField = {
        ...currentField,
        name: nextName,
        type: input.type ?? currentField.type,
        config: input.config !== undefined ? input.config : currentField.config,
      };
      const prospective = before.fields.map((f) => (f.id === currentField.id ? nextField : f));
      if (prospective.some((f) => (f.config as any)?.formula)) await calculatedFieldsService.plan(tenantId, prospective as any);
      formulaChanged = (currentField.config as any)?.formula !== (nextField.config as any)?.formula;
    }
    const result = await tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        // Lock entity and check optimistic locking
        const entityRes = await tx.client.query<{
          id: string;
          version: number;
          physical_table_name: string;
        }>(
          `SELECT id, version, physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );

        if (entityRes.rows.length === 0) {
          throw new Error(`Entity not found: ${input.entityId}`);
        }

        const entity = entityRes.rows[0];
        if (entity.version !== input.expectedVersion) {
          throw new OptimisticLockError(
            input.entityId,
            input.expectedVersion,
            entity.version
          );
        }

        // Lock field
        const fieldRes = await tx.client.query<{
          id: string;
          name: string;
          label: string;
          physical_column_name: string;
          type: any;
          required: boolean;
          is_unique: boolean;
          config: any;
        }>(
          `SELECT id, name, label, physical_column_name, type, required, is_unique, config
           FROM public.field_def
           WHERE id = $1 AND entity_id = $2 AND tenant_id = $3
           FOR UPDATE`,
          [input.fieldId, input.entityId, tenantId]
        );

        if (fieldRes.rows.length === 0) {
          throw new Error(`Field not found: ${input.fieldId}`);
        }

        const currentField = fieldRes.rows[0];
        const newType = input.type || currentField.type;
        const newName = input.name || currentField.name;
        const newLabel = input.label || currentField.label;
        const newConfig = input.config !== undefined ? input.config : currentField.config;
        const newRequired = input.required !== undefined ? input.required : currentField.required;
        const newUnique = input.unique !== undefined ? input.unique : currentField.is_unique;

        let ddl = `-- Update field ${input.fieldId} metadata (${currentField.label} -> ${newLabel})`;

        // Check if type conversion is required
        if (input.type && input.type !== currentField.type) {
          // Safety check
          const safetyCheck = ddlGenerator.getSafetyCheckQuery(
            tx.schemaName,
            entity.physical_table_name,
            currentField.physical_column_name,
            currentField.type,
            input.type,
            newConfig
          );

          if (safetyCheck && !safetyCheck.isSafeWithoutCheck) {
            const checkRes = await tx.client.query<{ invalid_count: number }>(
              safetyCheck.query,
              safetyCheck.params
            );
            const invalidCount = Number(checkRes.rows[0]?.invalid_count || 0);
            if (invalidCount > 0) {
              throw new UnsafeConversionError(
                `Cannot convert field '${currentField.name}' from '${currentField.type}' to '${input.type}': found ${invalidCount} existing row(s) that cannot be safely converted.`
              );
            }
          }

          // Expand / contract DDL
          ddl = ddlGenerator.generateExpandContractDDL(
            tx.schemaName,
            entity.physical_table_name,
            currentField.physical_column_name,
            currentField.type,
            input.type,
            newConfig
          );
          await tx.execute(ddl);
        }

        // Date fields: a calendar date (DATE column) and a date & time (TIMESTAMPTZ) are different
        // column types, so that switch isn't a settings change. Switching a calendar date to month
        // granularity moves stored values to the 1st, so month filters and grouping match them.
        if (newType === 'date' && currentField.type === 'date') {
          const before = (currentField.config || {}) as { includeTime?: boolean; granularity?: string };
          const after = (newConfig || {}) as { includeTime?: boolean; granularity?: string };
          if (Boolean(before.includeTime) !== Boolean(after.includeTime)) {
            throw new UnsafeConversionError(
              `Field '${currentField.name}' can't switch between a date and a date & time; add a new field instead.`
            );
          }
          if (!after.includeTime && after.granularity === 'month' && before.granularity !== 'month') {
            ddl = `UPDATE "${tx.schemaName}"."${entity.physical_table_name}" SET "${currentField.physical_column_name}" = date_trunc('month', "${currentField.physical_column_name}")::date WHERE "${currentField.physical_column_name}" IS NOT NULL;`;
            await tx.execute(ddl);
          }
        }

        // Update metadata catalog
        const updatedFieldRes = await tx.client.query<FieldDef>(
          `UPDATE public.field_def
           SET name = $1, label = $2, type = $3, required = $4, is_unique = $5, config = $6, updated_at = NOW()
           WHERE id = $7
           RETURNING id, tenant_id AS "tenantId", entity_id AS "entityId", name, label, physical_column_name AS "physicalColumnName", type, required, is_unique AS "unique", is_primary AS "isPrimary", config, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [
            newName,
            newLabel,
            newType,
            newRequired,
            newUnique,
            JSON.stringify(newConfig),
            input.fieldId,
          ]
        );

        // Increment entity version
        await tx.client.query(
          `UPDATE public.entity_def SET version = version + 1, updated_at = NOW() WHERE id = $1`,
          [input.entityId]
        );

        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
          field: updatedFieldRes.rows[0],
        };
      });
    });
    // New or changed formula: recalculate every record
    if (formulaChanged) await calculatedFieldsService.recalculate(tenantId, input.entityId);
    return result;
  }

  /**
   * Field combinations no two records may share (e.g. Machine + Month). Replaces the entity's
   * whole list: new rules get a unique index (refused, with examples, when existing records
   * already break them); removed rules drop theirs.
   */
  async setUniqueRules(
    tenantId: string,
    input: SetUniqueRulesInput
  ): Promise<MigrationResult & { uniqueRules: UniqueRule[] }> {
    return tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        const entityRes = await tx.client.query<{ id: string; version: number; label: string; physical_table_name: string; unique_rules: UniqueRule[] }>(
          `SELECT id, version, label, physical_table_name, unique_rules FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );
        if (entityRes.rows.length === 0) throw new Error(`Entity not found: ${input.entityId}`);
        const entity = entityRes.rows[0];
        if (entity.version !== input.expectedVersion) {
          throw new OptimisticLockError(input.entityId, input.expectedVersion, entity.version);
        }

        const fieldsRes = await tx.client.query<{ id: string; label: string; physical_column_name: string }>(
          `SELECT id, label, physical_column_name FROM public.field_def WHERE entity_id = $1`,
          [input.entityId]
        );
        const fieldById = new Map(fieldsRes.rows.map((f) => [f.id, f]));
        const table = `"${tx.schemaName}"."${entity.physical_table_name}"`;
        const indexName = (rule: UniqueRule) => `uq_${entity.physical_table_name}_${rule.id}`.slice(0, 63);

        // Normalise: known fields, no repeats within a rule, no two identical rules
        const seen = new Set<string>();
        const next: UniqueRule[] = [];
        for (const rule of input.rules) {
          const fields = [...new Set(rule.fields)];
          for (const fieldId of fields) {
            if (!fieldById.has(fieldId)) throw new UniqueRuleError(`Unknown field '${fieldId}' in a unique combination`);
          }
          const key = [...fields].sort().join('+');
          if (seen.has(key)) continue;
          seen.add(key);
          const existing = (entity.unique_rules || []).find((r) => r.id === rule.id);
          next.push({ id: existing?.id ?? crypto.randomBytes(5).toString('hex'), fields });
        }

        const ddl: string[] = [];
        // Removed (or changed) rules lose their index
        for (const old of entity.unique_rules || []) {
          const kept = next.find((r) => r.id === old.id);
          if (!kept || kept.fields.join() !== old.fields.join()) {
            const sql = `DROP INDEX IF EXISTS "${tx.schemaName}"."${indexName(old)}";`;
            await tx.execute(sql);
            ddl.push(sql);
          }
        }
        // New (or changed) rules: refuse if records already share the combination
        for (const rule of next) {
          const old = (entity.unique_rules || []).find((r) => r.id === rule.id);
          if (old && old.fields.join() === rule.fields.join()) continue;
          const cols = rule.fields.map((id) => `"${fieldById.get(id)!.physical_column_name}"`);
          const dupes = await tx.client.query(
            `SELECT ${cols.map((c, i) => `${c} AS v${i}`).join(', ')}, COUNT(*)::int AS n
               FROM ${table} WHERE ${cols.map((c) => `${c} IS NOT NULL`).join(' AND ')}
              GROUP BY ${cols.join(', ')} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT 3`
          );
          if (dupes.rows.length > 0) {
            const labels = rule.fields.map((id) => fieldById.get(id)!.label).join(' + ');
            const examples = dupes.rows
              .map((row: any) => `${rule.fields.map((_, i) => formatKeyValue(row[`v${i}`])).join(' / ')} (${row.n} records)`)
              .join('; ');
            throw new UniqueRuleError(
              `${entity.label} already has records sharing the same ${labels}: ${examples}. Fix or remove those duplicates first.`
            );
          }
          const sql = `CREATE UNIQUE INDEX "${indexName(rule)}" ON ${table} (${cols.join(', ')});`;
          await tx.execute(sql);
          ddl.push(sql);
        }

        await tx.client.query(
          `UPDATE public.entity_def SET unique_rules = $1, version = version + 1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(next), input.entityId]
        );
        const ddlText = ddl.length ? ddl.join('\n') : `-- Unique combinations unchanged for ${input.entityId}`;
        const { migrationId, version } = await this.recordMigration(tx, ddlText);
        return {
          success: true,
          migrationId,
          version,
          ddl: ddlText,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
          uniqueRules: next,
        };
      });
    });
  }

  /**
   * 6. Drop Field from Entity
   */
  async dropField(
    tenantId: string,
    input: DropFieldInput
  ): Promise<MigrationResult> {
    // A field other formulas use can't be deleted (their values would silently break)
    const owner = await entityCache.resolveEntity(tenantId, input.entityId);
    const dropping = owner.fieldById.get(input.fieldId);
    if (dropping) {
      const usages = await calculatedFieldsService.usagesOf(tenantId, owner, dropping.name);
      if (usages.length) {
        throw new CalculatedFieldError(`Can't delete '${dropping.name}': it's used by ${usages.join(', ')}. Update those formulas first.`);
      }
      const inRule = ((owner.entity as any).uniqueRules || []).find((rule: UniqueRule) => rule.fields.includes(dropping.id));
      if (inRule) {
        const labels = inRule.fields.map((id: string) => owner.fieldById.get(id)?.label ?? id).join(' + ');
        throw new UniqueRuleError(`Can't delete '${dropping.name}': it's part of the unique combination ${labels}. Remove that rule first.`);
      }
    }
    const result = await tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        const entityRes = await tx.client.query<{
          id: string;
          version: number;
          physical_table_name: string;
        }>(
          `SELECT id, version, physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [input.entityId, tenantId]
        );

        if (entityRes.rows.length === 0) {
          throw new Error(`Entity not found: ${input.entityId}`);
        }

        const entity = entityRes.rows[0];
        if (entity.version !== input.expectedVersion) {
          throw new OptimisticLockError(
            input.entityId,
            input.expectedVersion,
            entity.version
          );
        }

        const fieldRes = await tx.client.query<{
          id: string;
          physical_column_name: string;
        }>(
          `SELECT id, physical_column_name FROM public.field_def WHERE id = $1 AND entity_id = $2 AND tenant_id = $3`,
          [input.fieldId, input.entityId, tenantId]
        );

        if (fieldRes.rows.length === 0) {
          throw new Error(`Field not found: ${input.fieldId}`);
        }

        const field = fieldRes.rows[0];
        const ddl = ddlGenerator.generateDropColumnDDL(
          tx.schemaName,
          entity.physical_table_name,
          field.physical_column_name
        );
        await tx.execute(ddl);

        // Delete from catalog
        await tx.client.query(
          `DELETE FROM public.field_def WHERE id = $1`,
          [input.fieldId]
        );

        // Increment entity version
        await tx.client.query(
          `UPDATE public.entity_def SET version = version + 1, updated_at = NOW() WHERE id = $1`,
          [input.entityId]
        );

        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          entityId: input.entityId,
        };
      });
    });
    return result;
  }

  /**
   * 7. Add Relation (FK)
   */
  async addRelation(
    tenantId: string,
    input: AddRelationInput
  ): Promise<MigrationResult & { relation: RelationDef }> {
    return tenantMigrationQueue.enqueue(tenantId, async () => {
      return this.storage.transaction(tenantId, async (tx) => {
        // Validate source and target entities
        const sourceRes = await tx.client.query<{ physical_table_name: string }>(
          `SELECT physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2`,
          [input.sourceEntityId, tenantId]
        );
        const targetRes = await tx.client.query<{ physical_table_name: string }>(
          `SELECT physical_table_name FROM public.entity_def WHERE id = $1 AND tenant_id = $2`,
          [input.targetEntityId, tenantId]
        );

        if (sourceRes.rows.length === 0 || targetRes.rows.length === 0) {
          throw new Error('Source or target entity not found in tenant');
        }

        const sourceFieldRes = await tx.client.query<{ physical_column_name: string; type: string }>(
          `SELECT physical_column_name, type FROM public.field_def WHERE id = $1 AND entity_id = $2 AND tenant_id = $3`,
          [input.sourceFieldId, input.sourceEntityId, tenantId]
        );

        if (sourceFieldRes.rows.length === 0) {
          throw new Error('Source reference field not found');
        }

        const relId = generateRelationId();
        const ddl = ddlGenerator.generateAddForeignKeyDDL(
          tx.schemaName,
          relId,
          sourceRes.rows[0].physical_table_name,
          sourceFieldRes.rows[0].physical_column_name,
          targetRes.rows[0].physical_table_name,
          'id',
          input.onDelete || 'RESTRICT'
        );

        await tx.execute(ddl);

        const relRes = await tx.client.query<RelationDef>(
          `INSERT INTO public.relation_def (id, tenant_id, name, source_entity_id, source_field_id, target_entity_id, target_field_id, relation_type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           RETURNING id, tenant_id AS "tenantId", name, source_entity_id AS "sourceEntityId", source_field_id AS "sourceFieldId", target_entity_id AS "targetEntityId", target_field_id AS "targetFieldId", relation_type AS "relationType", created_at AS "createdAt"`,
          [
            relId,
            tenantId,
            input.name,
            input.sourceEntityId,
            input.sourceFieldId,
            input.targetEntityId,
            input.targetFieldId || null,
            input.relationType || 'many_to_one',
          ]
        );

        const { migrationId, version } = await this.recordMigration(tx, ddl);

        return {
          success: true,
          migrationId,
          version,
          ddl,
          appliedAt: new Date().toISOString(),
          relation: relRes.rows[0],
        };
      });
    });
  }

  /**
   * Helper to retrieve all applied migrations for a tenant
   */
  async getMigrations(tenantId: string) {
    const client = await (this.storage as any).dbPool.connect();
    try {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", version, ddl, status, created_at AS "createdAt"
         FROM public.schema_migration
         WHERE tenant_id = $1
         ORDER BY version ASC`,
        [tenantId]
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Reorder fields for an entity
   */
  async reorderFields(
    tenantId: string,
    entityId: string,
    fieldIds: string[]
  ): Promise<void> {
    const entRes = await pool.query(
      `SELECT id FROM public.entity_def WHERE id = $1 AND tenant_id = $2`,
      [entityId, tenantId]
    );
    if (entRes.rows.length === 0) {
      const err = new Error(`Entity '${entityId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    await this.storage.transaction(tenantId, async (tx) => {
      for (let i = 0; i < fieldIds.length; i++) {
        await tx.client.query(
          `UPDATE public.field_def
           SET position = $1, updated_at = NOW()
           WHERE id = $2 AND entity_id = $3 AND tenant_id = $4`,
          [i + 1, fieldIds[i], entityId, tenantId]
        );
      }
    });
    entityCache.invalidate(tenantId, entityId);
  }
}

export const migrationService = new MigrationService();
