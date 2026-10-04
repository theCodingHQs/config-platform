import type {
  CreateEntityInput,
  UpdateEntityInput,
  AddFieldInput,
  UpdateFieldInput,
  DropFieldInput,
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
import { pool } from '../db/pool.js';
import crypto from 'node:crypto';

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
        `INSERT INTO public.tenant (id, name, schema_version)
         VALUES ($1, $2, 1)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [tenantId, name]
      );
    } finally {
      client.release();
    }
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
    return tenantMigrationQueue.enqueue(tenantId, async () => {
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
          `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
           RETURNING id, tenant_id AS "tenantId", name, label, physical_table_name AS "physicalTableName", version, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [tableId, tenantId, input.name, input.label, tableId]
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
        }>(
          `SELECT id, version, name, label, physical_table_name, display_field_id FROM public.entity_def WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
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

        // Update metadata catalog (physical table name remains stable!)
        const updateRes = await tx.client.query<EntityDef>(
          `UPDATE public.entity_def
           SET name = $1, label = $2, display_field_id = $3, version = version + 1, updated_at = NOW()
           WHERE id = $4
           RETURNING id, tenant_id AS "tenantId", name, label, physical_table_name AS "physicalTableName", version, display_field_id AS "displayFieldId", created_at AS "createdAt", updated_at AS "updatedAt"`,
          [newName, newLabel, newDisplayFieldId, input.entityId]
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
  }

  /**
   * 5. Update Field (label, config, or type change with expand/contract)
   */
  async updateField(
    tenantId: string,
    input: UpdateFieldInput
  ): Promise<MigrationResult & { field: FieldDef }> {
    return tenantMigrationQueue.enqueue(tenantId, async () => {
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
  }

  /**
   * 6. Drop Field from Entity
   */
  async dropField(
    tenantId: string,
    input: DropFieldInput
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
