import type { Pool } from 'pg';
import { pool } from '../db/pool.js';
import type { FieldDef, EntityDef } from '@config-platform/schema';

export interface ResolvedEntity {
  entity: EntityDef;
  fields: FieldDef[];
  fieldByName: Map<string, FieldDef>;
  fieldById: Map<string, FieldDef>;
  fieldByPhysicalName: Map<string, FieldDef>;
  systemFields: Set<string>;
  displayField?: FieldDef;
}

interface CacheEntry {
  version: number;
  data: ResolvedEntity;
  cachedAt: number;
}

export class EntityCache {
  private cache: Map<string, CacheEntry> = new Map();

  private getCacheKey(tenantId: string, entityIdOrName: string): string {
    return `${tenantId}:${entityIdOrName}`;
  }

  invalidate(tenantId: string, entityId?: string, entityName?: string) {
    if (entityId) {
      this.cache.delete(this.getCacheKey(tenantId, entityId));
    }
    if (entityName) {
      this.cache.delete(this.getCacheKey(tenantId, entityName));
    }
    // Also clear any entries matching this tenant
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  async resolveEntity(tenantId: string, entityIdOrName: string, dbPool: Pool = pool): Promise<ResolvedEntity> {
    const key = this.getCacheKey(tenantId, entityIdOrName);
    const cached = this.cache.get(key);

    const client = await dbPool.connect();
    try {
      // Fetch latest entity definition to check version
      const entityRes = await client.query<EntityDef>(
        `SELECT id, tenant_id AS "tenantId", name, label, physical_table_name AS "physicalTableName", display_field_id AS "displayFieldId", icon, version, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM public.entity_def
         WHERE tenant_id = $1 AND (id = $2 OR name = $2)`,
        [tenantId, entityIdOrName]
      );

      if (entityRes.rows.length === 0) {
        throw new Error(`Entity '${entityIdOrName}' not found in tenant '${tenantId}'`);
      }

      const entity = entityRes.rows[0];

      // If cached and version matches, return cached
      if (cached && cached.version === entity.version) {
        return cached.data;
      }

      // Fetch all fields for this entity
      const fieldsRes = await client.query<FieldDef>(
        `SELECT id, tenant_id AS "tenantId", entity_id AS "entityId", name, label, physical_column_name AS "physicalColumnName", type, required, is_unique AS "unique", is_primary AS "isPrimary", position, config, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM public.field_def
         WHERE tenant_id = $1 AND entity_id = $2
         ORDER BY position ASC, created_at ASC`,
        [tenantId, entity.id]
      );

      const fieldByName = new Map<string, FieldDef>();
      const fieldById = new Map<string, FieldDef>();
      const fieldByPhysicalName = new Map<string, FieldDef>();

      for (const f of fieldsRes.rows) {
        fieldByName.set(f.name, f);
        fieldById.set(f.id, f);
        fieldByPhysicalName.set(f.physicalColumnName, f);
      }

      const systemFields = new Set(['id', 'created_at', 'updated_at']);
      const displayField = entity.displayFieldId ? fieldById.get(entity.displayFieldId) : undefined;

      const resolved: ResolvedEntity = {
        entity,
        fields: fieldsRes.rows,
        fieldByName,
        fieldById,
        fieldByPhysicalName,
        systemFields,
        displayField,
      };

      // Cache by both ID and Name
      const entry: CacheEntry = {
        version: entity.version,
        data: resolved,
        cachedAt: Date.now(),
      };

      this.cache.set(this.getCacheKey(tenantId, entity.id), entry);
      this.cache.set(this.getCacheKey(tenantId, entity.name), entry);

      return resolved;
    } finally {
      client.release();
    }
  }
}

export const entityCache = new EntityCache();
