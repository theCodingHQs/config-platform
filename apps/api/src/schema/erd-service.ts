import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { ErdModel, ErdTable, ErdColumn, ErdRelationship } from '@config-platform/schema';
import { defaultStorageAdapter, type StorageAdapter } from '../db/storage-adapter.js';
import { mapFieldTypeToPostgres } from '../migrations/ddl-generator.js';

export class ErdService {
  constructor(
    private dbPool: Pool = pool,
    private storage: StorageAdapter = defaultStorageAdapter
  ) {}

  /**
   * Derives live ERD graph directly from metadata catalog
   */
  async getLiveErd(tenantId: string, externalClient?: PoolClient): Promise<ErdModel> {
    const client = externalClient || (await this.dbPool.connect());
    try {
      // 1. Fetch all entities for this tenant
      const entitiesRes = await client.query<{
        id: string;
        name: string;
        label: string;
        physical_table_name: string;
        version: number;
        display_field_id?: string | null;
        icon?: string | null;
      }>(
        `SELECT id, name, label, physical_table_name, version, display_field_id, icon
         FROM public.entity_def
         WHERE tenant_id = $1
         ORDER BY name ASC`,
        [tenantId]
      );

      // 2. Fetch all fields for this tenant
      const fieldsRes = await client.query<{
        id: string;
        entity_id: string;
        name: string;
        label: string;
        physical_column_name: string;
        type: any;
        required: boolean;
        is_unique: boolean;
        is_primary: boolean;
        position: number;
        config: any;
      }>(
        `SELECT id, entity_id, name, label, physical_column_name, type, required, is_unique, is_primary, position, config
         FROM public.field_def
         WHERE tenant_id = $1
         ORDER BY position ASC, created_at ASC`,
        [tenantId]
      );

      // 3. Fetch all relations for this tenant
      const relationsRes = await client.query<{
        id: string;
        name: string;
        source_entity_id: string;
        source_field_id: string;
        target_entity_id: string;
        target_field_id: string | null;
        relation_type: string;
      }>(
        `SELECT id, name, source_entity_id, source_field_id, target_entity_id, target_field_id, relation_type
         FROM public.relation_def
         WHERE tenant_id = $1`,
        [tenantId]
      );

      const relationMap = new Map<string, typeof relationsRes.rows[0]>();
      for (const rel of relationsRes.rows) {
        relationMap.set(rel.source_field_id, rel);
      }

      // Group fields by entity
      const fieldsByEntity = new Map<string, ErdColumn[]>();
      for (const f of fieldsRes.rows) {
        const rel = relationMap.get(f.id);
        const col: ErdColumn = {
          id: f.id,
          name: f.name,
          label: f.label,
          physicalColumnName: f.physical_column_name,
          type: f.type,
          required: f.required,
          unique: f.is_unique,
          isPrimary: f.is_primary,
          position: f.position ?? 0,
          isForeignKey: Boolean(rel),
          config: f.config || {},
          references: rel
            ? {
                entityId: rel.target_entity_id,
                fieldId: rel.target_field_id || 'id',
                tableName:
                  entitiesRes.rows.find((e) => e.id === rel.target_entity_id)?.physical_table_name ||
                  rel.target_entity_id,
              }
            : undefined,
        };

        if (!fieldsByEntity.has(f.entity_id)) {
          fieldsByEntity.set(f.entity_id, []);
        }
        fieldsByEntity.get(f.entity_id)!.push(col);
      }

      // Build tables
      const tables: ErdTable[] = entitiesRes.rows.map((e) => {
        const customCols = fieldsByEntity.get(e.id) || [];
        const systemCols: ErdColumn[] = [
          {
            id: 'id',
            name: 'id',
            label: 'ID',
            physicalColumnName: 'id',
            type: 'text',
            required: true,
            unique: true,
            isPrimary: true,
            position: 0,
            isForeignKey: false,
            config: {},
          },
          {
            id: 'created_at',
            name: 'created_at',
            label: 'Created At',
            physicalColumnName: 'created_at',
            type: 'date',
            required: true,
            unique: false,
            isPrimary: false,
            position: 998,
            isForeignKey: false,
            config: {},
          },
          {
            id: 'updated_at',
            name: 'updated_at',
            label: 'Updated At',
            physicalColumnName: 'updated_at',
            type: 'date',
            required: true,
            unique: false,
            isPrimary: false,
            position: 999,
            isForeignKey: false,
            config: {},
          },
        ];

        return {
          id: e.id,
          name: e.name,
          label: e.label,
          physicalTableName: e.physical_table_name,
          version: e.version,
          displayFieldId: e.display_field_id || null,
          icon: e.icon || null,
          columns: [...systemCols, ...customCols],
          fields: customCols,
        };
      });

      // Build relationships
      const relationships: ErdRelationship[] = relationsRes.rows.map((r) => {
        const sourceTable = entitiesRes.rows.find((e) => e.id === r.source_entity_id);
        const sourceField = fieldsRes.rows.find((f) => f.id === r.source_field_id);
        const targetTable = entitiesRes.rows.find((e) => e.id === r.target_entity_id);

        return {
          id: r.id,
          name: r.name,
          fromTable: sourceTable?.physical_table_name || r.source_entity_id,
          fromColumn: sourceField?.physical_column_name || r.source_field_id,
          toTable: targetTable?.physical_table_name || r.target_entity_id,
          toColumn: r.target_field_id || 'id',
          relationType: r.relation_type,
        };
      });

      return {
        tenantId,
        tables,
        relationships,
      };
    } finally {
      if (!externalClient) {
        client.release();
      }
    }
  }

  /**
   * Derives live SQL DDL representing the current schema projection directly from metadata
   */
  async getLiveDDL(tenantId: string): Promise<string> {
    const erd = await this.getLiveErd(tenantId);
    const schemaName = this.storage.getTenantSchemaName(tenantId);

    const ddlLines: string[] = [
      `-- ==============================================================================`,
      `-- Live Projected DDL for Tenant: ${tenantId}`,
      `-- Derived from Metadata Catalog at: ${new Date().toISOString()}`,
      `-- Physical Postgres Schema: "${schemaName}"`,
      `-- Tables & columns use stable generated IDs. Logical labels shown in comments.`,
      `-- ==============================================================================`,
      ``,
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
      ``,
    ];

    for (const table of erd.tables) {
      ddlLines.push(
        `-- Logical Entity: ${table.label} (slug: '${table.name}', version: ${table.version})`
      );
      ddlLines.push(`CREATE TABLE IF NOT EXISTS "${schemaName}"."${table.physicalTableName}" (`);

      const colDefs: string[] = [];
      const indexes: string[] = [];

      for (const col of table.columns) {
        if (col.id === 'id') {
          colDefs.push(`  "id" VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text`);
        } else if (col.id === 'created_at') {
          colDefs.push(`  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        } else if (col.id === 'updated_at') {
          colDefs.push(`  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        } else {
          const pgType = mapFieldTypeToPostgres(col.type);
          const notNull = col.required ? ' NOT NULL' : '';
          colDefs.push(
            `  "${col.physicalColumnName}" ${pgType}${notNull} -- ${col.label} (type: ${col.type})`
          );

          if (col.unique) {
            indexes.push(
              `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${table.physicalTableName}_${col.physicalColumnName}" ON "${schemaName}"."${table.physicalTableName}" ("${col.physicalColumnName}");`
            );
          }
        }
      }

      ddlLines.push(colDefs.join(',\n'));
      ddlLines.push(`);`);
      if (indexes.length > 0) {
        ddlLines.push(indexes.join('\n'));
      }
      ddlLines.push(``);
    }

    if (erd.relationships.length > 0) {
      ddlLines.push(`-- Relationships and Foreign Keys`);
      for (const rel of erd.relationships) {
        ddlLines.push(
          `-- Relation '${rel.name}': ${rel.fromTable}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn}`
        );
        ddlLines.push(
          `ALTER TABLE "${schemaName}"."${rel.fromTable}" ADD CONSTRAINT "fk_${rel.id}" FOREIGN KEY ("${rel.fromColumn}") REFERENCES "${schemaName}"."${rel.toTable}" ("${rel.toColumn}") ON DELETE RESTRICT;`
        );
      }
      ddlLines.push(``);
    }

    return ddlLines.join('\n');
  }
}

export const erdService = new ErdService();
