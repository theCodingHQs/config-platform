import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { auditLogService } from '../audit/audit-service.js';
import type { SessionPayload, TenantRole } from '../auth/auth-types.js';
import { ROLES } from '../auth/auth-types.js';
import {
  generateTableId,
  generateColumnId,
  generatePageId,
  generateRelationId,
  generateExportTemplateId,
  isValidStableId,
} from '../utils/id-gen.js';
import { pagesService } from '../pages/pages-service.js';
import {
  WorkspaceThemeConfigSchema,
  AllowedIconNameSchema,
  ExportTemplateDefinitionSchema,
} from '@config-platform/schema';
import { exportTemplateService } from '../records/export/export-template-service.js';

export interface EntityPermissionExport {
  entityId: string;
  role: TenantRole | string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export interface FieldPermissionExport {
  entityId: string;
  fieldId: string;
  role: TenantRole | string;
  hidden: boolean;
  readOnly: boolean;
}

export interface WorkspacePermissionsBundle {
  entities: EntityPermissionExport[];
  fields: FieldPermissionExport[];
}

export const EntityPermissionBundleSchema = z.object({
  entityId: z.string().min(1, 'entityId is required'),
  role: z.enum(ROLES, {
    errorMap: () => ({
      message: `Role must be one of: ${ROLES.join(', ')}`,
    }),
  }),
  canRead: z.boolean(),
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
  canExport: z.boolean().optional().default(false),
});

export const ExportTemplateBundleSchema = z.object({
  id: z.string().min(1, 'id is required'),
  name: z.string().min(1, 'name is required'),
  entityId: z.string().min(1, 'entityId is required'),
  draft: ExportTemplateDefinitionSchema,
  published: ExportTemplateDefinitionSchema.nullable().optional(),
  version: z.number().int().default(1),
});

export const FieldPermissionBundleSchema = z.object({
  entityId: z.string().min(1, 'entityId is required'),
  fieldId: z.string().min(1, 'fieldId is required'),
  role: z.enum(ROLES, {
    errorMap: () => ({
      message: `Role must be one of: ${ROLES.join(', ')}`,
    }),
  }),
  hidden: z.boolean(),
  readOnly: z.boolean(),
});

export const WorkspacePermissionsBundleSchema = z.object({
  entities: z.array(EntityPermissionBundleSchema).default([]),
  fields: z.array(FieldPermissionBundleSchema).default([]),
});

export interface WorkspaceBundle {
  bundleVersion: number;
  exportedAt: string;
  themeConfig?: {
    presetId: string;
    overrides?: {
      accent?: string;
      radius?: string;
      density?: string;
    };
  };
  entities: Array<{
    id: string;
    name: string;
    label: string;
    displayFieldId?: string | null;
    icon?: string | null;
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
      isUnique: boolean;
      position: number;
      config: any;
    }>;
  }>;
  relations: Array<{
    name: string;
    sourceEntityId: string;
    sourceFieldId: string;
    targetEntityId: string;
    targetFieldId?: string;
    relationType: string;
  }>;
  pages: Array<{
    id: string;
    name: string;
    route: string;
    draft: any;
    published?: any;
    allowedRoles?: string[];
  }>;
  exportTemplates?: Array<{
    id: string;
    name: string;
    entityId: string;
    draft: any;
    published?: any;
    version: number;
  }>;
  permissions?: WorkspacePermissionsBundle;
}

export interface ImportResult {
  success: boolean;
  dryRun: boolean;
  conflicts: string[];
  entitiesCount: number;
  pagesCount: number;
  exportTemplatesCount?: number;
  permissions?: {
    entityPermissionsCount: number;
    fieldPermissionsCount: number;
    entities: EntityPermissionExport[];
    fields: FieldPermissionExport[];
  };
}

/**
 * Value-based deep walk over JSON objects, arrays, and primitive values:
 * - Exact string match against idMap replaces the ID
 * - Embedded IDs in expression strings are replaced by regex on /[ct]_[0-9a-f]{8}/g
 * - Object keys matching an ID are also replaced
 */
export function deepWalkRemap<T>(value: T, idMap: Map<string, string>): T {
  if (typeof value === 'string') {
    if (idMap.has(value)) {
      return idMap.get(value) as unknown as T;
    }
    let res = value.replace(/[ct]_[0-9a-f]{8}/g, (match) => idMap.get(match) || match);
    for (const [oldId, newId] of idMap.entries()) {
      if (oldId && res.includes(oldId)) {
        res = res.split(oldId).join(newId);
      }
    }
    return res as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepWalkRemap(item, idMap)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      let remappedKey = idMap.has(key)
        ? idMap.get(key)!
        : key.replace(/[ct]_[0-9a-f]{8}/g, (match) => idMap.get(match) || match);
      for (const [oldId, newId] of idMap.entries()) {
        if (oldId && remappedKey.includes(oldId)) {
          remappedKey = remappedKey.split(oldId).join(newId);
        }
      }
      result[remappedKey] = deepWalkRemap(val, idMap);
    }
    return result as unknown as T;
  }
  return value;
}

export class ExportImportService {
  async exportBundle(tenantId: string): Promise<WorkspaceBundle> {
    // 0. Fetch theme configuration
    const tenantRes = await pool.query<{ theme_config?: any }>(
      `SELECT theme_config FROM public.tenant WHERE id = $1`,
      [tenantId]
    );
    const themeConfig = tenantRes.rows[0]?.theme_config || {
      presetId: process.env.DEFAULT_THEME_PRESET || 'neutral',
      overrides: {},
    };

    // 1. Fetch entities
    const entitiesRes = await pool.query<{
      id: string;
      name: string;
      label: string;
      display_field_id?: string | null;
      icon?: string | null;
    }>(
      `SELECT id, name, label, display_field_id, icon FROM public.entity_def WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId]
    );

    const entities: WorkspaceBundle['entities'] = [];
    for (const ent of entitiesRes.rows) {
      const fieldsRes = await pool.query<{
        id: string;
        name: string;
        label: string;
        type: string;
        required: boolean;
        is_unique: boolean;
        position: number;
        config: any;
      }>(
        `SELECT id, name, label, type, required, is_unique, position, config
         FROM public.field_def
         WHERE tenant_id = $1 AND entity_id = $2
         ORDER BY position ASC`,
        [tenantId, ent.id]
      );

      entities.push({
        id: ent.id,
        name: ent.name,
        label: ent.label,
        displayFieldId: ent.display_field_id || null,
        icon: ent.icon || null,
        fields: fieldsRes.rows.map((f) => ({
          id: f.id,
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required,
          isUnique: f.is_unique,
          position: f.position,
          config: f.config || {},
        })),
      });
    }

    // 2. Fetch relations
    const relRes = await pool.query<{
      name: string;
      source_entity_id: string;
      source_field_id: string;
      target_entity_id: string;
      target_field_id: string;
      relation_type: string;
    }>(
      `SELECT name, source_entity_id, source_field_id, target_entity_id, target_field_id, relation_type
       FROM public.relation_def
       WHERE tenant_id = $1`,
      [tenantId]
    );

    const relations = relRes.rows.map((r) => ({
      name: r.name,
      sourceEntityId: r.source_entity_id,
      sourceFieldId: r.source_field_id,
      targetEntityId: r.target_entity_id,
      targetFieldId: r.target_field_id,
      relationType: r.relation_type,
    }));

    // 3. Fetch pages
    const pagesRes = await pool.query<{
      id: string;
      name: string;
      route: string;
      draft: any;
      published: any;
      allowed_roles: string[];
    }>(
      `SELECT id, name, route, draft, published, allowed_roles
       FROM public.page_def
       WHERE tenant_id = $1
       ORDER BY route ASC`,
      [tenantId]
    );

    const pages = pagesRes.rows.map((p) => ({
      id: p.id,
      name: p.name,
      route: p.route,
      draft: p.draft,
      published: p.published,
      allowedRoles: p.allowed_roles,
    }));

    // 4. Fetch entity permissions
    const entityPermsRes = await pool.query<{
      entity_id: string;
      role: string;
      can_read: boolean;
      can_create: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_export: boolean;
    }>(
      `SELECT ep.entity_id, ep.role, ep.can_read, ep.can_create, ep.can_update, ep.can_delete, ep.can_export
       FROM public.entity_permission ep
       JOIN public.entity_def ed ON ed.id = ep.entity_id AND ed.tenant_id = ep.tenant_id
       WHERE ep.tenant_id = $1
       ORDER BY ed.name ASC, ep.role ASC`,
      [tenantId]
    );

    const entityPermissions: EntityPermissionExport[] = entityPermsRes.rows.map((r) => ({
      entityId: r.entity_id,
      role: r.role,
      canRead: r.can_read,
      canCreate: r.can_create,
      canUpdate: r.can_update,
      canDelete: r.can_delete,
      canExport: r.can_export ?? (r.role !== 'viewer'),
    }));

    // 5. Fetch field permissions
    const fieldPermsRes = await pool.query<{
      entity_id: string;
      field_id: string;
      role: string;
      hidden: boolean;
      read_only: boolean;
    }>(
      `SELECT fp.entity_id, fp.field_id, fp.role, fp.hidden, fp.read_only
       FROM public.field_permission fp
       JOIN public.entity_def ed ON ed.id = fp.entity_id AND ed.tenant_id = fp.tenant_id
       JOIN public.field_def fd ON fd.id = fp.field_id AND fd.tenant_id = fp.tenant_id
       WHERE fp.tenant_id = $1
       ORDER BY ed.name ASC, fd.position ASC, fd.name ASC, fp.role ASC`,
      [tenantId]
    );

    const fieldPermissions: FieldPermissionExport[] = fieldPermsRes.rows.map((r) => ({
      entityId: r.entity_id,
      fieldId: r.field_id,
      role: r.role,
      hidden: r.hidden,
      readOnly: r.read_only,
    }));

    // 6. Fetch export templates
    const exportTemplatesRes = await pool.query<{
      id: string;
      name: string;
      entity_id: string;
      draft: any;
      published: any;
      version: number;
    }>(
      `SELECT id, name, entity_id, draft, published, version
       FROM public.export_template
       WHERE tenant_id = $1
       ORDER BY name ASC`,
      [tenantId]
    );

    const exportTemplates = exportTemplatesRes.rows.map((t) => ({
      id: t.id,
      name: t.name,
      entityId: t.entity_id,
      draft: t.draft,
      published: t.published,
      version: t.version,
    }));

    return {
      bundleVersion: 2,
      exportedAt: new Date().toISOString(),
      themeConfig,
      entities,
      relations,
      pages,
      exportTemplates,
      permissions: {
        entities: entityPermissions,
        fields: fieldPermissions,
      },
    };
  }

  async importBundle(
    tenantId: string,
    bundle: WorkspaceBundle,
    dryRun = false,
    session?: SessionPayload
  ): Promise<ImportResult> {
    if (!bundle || (bundle.bundleVersion !== 1 && bundle.bundleVersion !== 2)) {
      throw new Error('Unsupported bundle version or invalid bundle structure. Supported versions: 1, 2.');
    }

    // Check plan limits
    const { plan, limits } = await tenantLimitsService.getTenantPlan(tenantId);
    const conflicts: string[] = [];

    // Validate theme configuration upfront if present in bundle
    let validatedThemeConfig: any = null;
    if (bundle.themeConfig !== undefined) {
      const parsedTheme = WorkspaceThemeConfigSchema.safeParse(bundle.themeConfig);
      if (!parsedTheme.success) {
        conflicts.push(
          `Invalid theme configuration in bundle: ${parsedTheme.error.issues
            .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
            .join(', ')}`
        );
      } else {
        validatedThemeConfig = parsedTheme.data;
      }
    }

    // Validate permissions upfront if present in bundle
    let validatedPermissions: WorkspacePermissionsBundle | null = null;
    if (bundle.permissions !== undefined && bundle.permissions !== null) {
      const parsedPermissions = WorkspacePermissionsBundleSchema.safeParse(bundle.permissions);
      if (!parsedPermissions.success) {
        for (const issue of parsedPermissions.error.issues) {
          conflicts.push(
            `Invalid permissions in bundle: ${issue.path.join('.') || 'root'}: ${issue.message}`
          );
        }
      } else {
        validatedPermissions = parsedPermissions.data;
      }
    }

    // Validate entity and field IDs referenced in permissions against bundle.entities
    const bundleEntityMap = new Map<string, Set<string>>();
    for (const ent of bundle.entities) {
      const fSet = new Set<string>(ent.fields.map((f) => f.id));
      bundleEntityMap.set(ent.id, fSet);
    }

    if (validatedPermissions) {
      for (const ep of validatedPermissions.entities) {
        if (!bundleEntityMap.has(ep.entityId)) {
          conflicts.push(
            `Unknown entity ID '${ep.entityId}' in entity permissions. Entity does not exist in workspace bundle.`
          );
        }
      }
      for (const fp of validatedPermissions.fields) {
        const fSet = bundleEntityMap.get(fp.entityId);
        if (!fSet) {
          conflicts.push(
            `Unknown entity ID '${fp.entityId}' in field permissions. Entity does not exist in workspace bundle.`
          );
        } else if (!fSet.has(fp.fieldId)) {
          conflicts.push(
            `Unknown field ID '${fp.fieldId}' in field permissions for entity '${fp.entityId}'. Field does not exist in workspace bundle.`
          );
        }
      }
    }

    // Validate export templates upfront if present in bundle
    let validatedExportTemplates: any[] = [];
    if (bundle.exportTemplates !== undefined && bundle.exportTemplates !== null) {
      for (let i = 0; i < bundle.exportTemplates.length; i++) {
        const tpl = bundle.exportTemplates[i];
        const parsedTpl = ExportTemplateBundleSchema.safeParse(tpl);
        if (!parsedTpl.success) {
          for (const issue of parsedTpl.error.issues) {
            conflicts.push(
              `Invalid export template '${tpl?.name || i}' in bundle: ${issue.path.join('.') || 'root'}: ${issue.message}`
            );
          }
        } else {
          validatedExportTemplates.push(parsedTpl.data);
          if (!bundleEntityMap.has(tpl.entityId)) {
            conflicts.push(
              `Unknown entity ID '${tpl.entityId}' in export template '${tpl.name}'. Entity does not exist in workspace bundle.`
            );
          }
        }
      }
    }

    const existingEntities = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.entity_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const currentEntityCount = parseInt(existingEntities.rows[0]?.count || '0', 10);
    if (currentEntityCount + bundle.entities.length > limits.maxEntities) {
      conflicts.push(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxEntities} entities (current: ${currentEntityCount}, importing: ${bundle.entities.length}).`
      );
    }

    const existingEntityNames = await pool.query<{ name: string }>(
      `SELECT name FROM public.entity_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const entityNameSet = new Set(existingEntityNames.rows.map((r) => r.name.toLowerCase()));

    for (const ent of bundle.entities) {
      if (entityNameSet.has(ent.name.toLowerCase())) {
        conflicts.push(`Entity with name '${ent.name}' already exists in workspace.`);
      }
      if (ent.icon !== undefined && ent.icon !== null && ent.icon !== '') {
        const parsedIcon = AllowedIconNameSchema.safeParse(ent.icon);
        if (!parsedIcon.success) {
          conflicts.push(
            `Invalid entity icon '${ent.icon}' on entity '${ent.name}'. Must be one of the allowed curated icons.`
          );
        }
      }
    }

    const existingPageRoutes = await pool.query<{ route: string }>(
      `SELECT route FROM public.page_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const routeSet = new Set(existingPageRoutes.rows.map((r) => r.route.toLowerCase()));

    for (const p of bundle.pages) {
      if (routeSet.has(p.route.toLowerCase())) {
        conflicts.push(`Page with route '${p.route}' already exists in workspace.`);
      }

      const checkFormIcons = (node: any) => {
        if (!node) return;
        if (node.type === 'form' && node.props && Array.isArray(node.props.fields)) {
          for (const f of node.props.fields) {
            if (f && f.icon !== undefined && f.icon !== null && f.icon !== '') {
              const parsedIcon = AllowedIconNameSchema.safeParse(f.icon);
              if (!parsedIcon.success) {
                conflicts.push(
                  `Invalid form field icon '${f.icon}' on field '${f.fieldId || 'unknown'}' in page '${p.name || p.route}'. Must be one of the allowed curated icons.`
                );
              }
            }
          }
        }
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            checkFormIcons(child);
          }
        }
      };

      if (p.draft?.root) checkFormIcons(p.draft.root);
      if (p.published?.root) checkFormIcons(p.published.root);
    }

    // Validate plan limits
    if (existingEntityNames.rows.length + bundle.entities.length > limits.maxEntities) {
      conflicts.push(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxEntities} entities (current: ${existingEntityNames.rows.length}, importing: ${bundle.entities.length}).`
      );
    }

    for (const ent of bundle.entities) {
      if (ent.fields.length > limits.maxFieldsPerEntity) {
        conflicts.push(
          `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxFieldsPerEntity} fields per entity (entity '${ent.name}' has ${ent.fields.length}).`
        );
      }
      if (Array.isArray((ent as any).records) && (ent as any).records.length > limits.maxRecordsPerEntity) {
        conflicts.push(
          `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxRecordsPerEntity} records per entity (entity '${ent.name}' has ${(ent as any).records.length}).`
        );
      }
    }

    if (existingPageRoutes.rows.length + bundle.pages.length > limits.maxPages) {
      conflicts.push(
        `Limit exceeded: Plan '${plan}' allows a maximum of ${limits.maxPages} pages (current: ${existingPageRoutes.rows.length}, importing: ${bundle.pages.length}).`
      );
    }

    if (conflicts.length > 0) {
      return {
        success: false,
        dryRun,
        conflicts,
        entitiesCount: bundle.entities.length,
        pagesCount: bundle.pages.length,
      };
    }

    const tenantSchema = defaultStorageAdapter.getTenantSchemaName(tenantId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // ID Collision detection: Keep original IDs when no collision and valid format; remap only on collision
      const existingEntityIdsRes = await client.query<{ id: string }>(
        `SELECT id FROM public.entity_def`
      );
      const usedEntityIds = new Set<string>(existingEntityIdsRes.rows.map((r) => r.id));

      const existingFieldIdsRes = await client.query<{ id: string }>(
        `SELECT id FROM public.field_def`
      );
      const usedFieldIds = new Set<string>(existingFieldIdsRes.rows.map((r) => r.id));

      const existingPageIdsRes = await client.query<{ id: string }>(
        `SELECT id FROM public.page_def`
      );
      const usedPageIds = new Set<string>(existingPageIdsRes.rows.map((r) => r.id));

      const existingTemplateIdsRes = await client.query<{ id: string }>(
        `SELECT id FROM public.export_template`
      );
      const usedTemplateIds = new Set<string>(existingTemplateIdsRes.rows.map((r) => r.id));

      const idMap = new Map<string, string>();
      const entityIdMap = new Map<string, string>();
      const fieldIdMap = new Map<string, string>();
      const pageIdMap = new Map<string, string>();
      const templateIdMap = new Map<string, string>();

      // 1. Entities: keep original ID if valid t_xxxxxxxx and not collided; otherwise generate new t_xxxxxxxx
      for (const ent of bundle.entities) {
        let targetId = ent.id;
        if (!isValidStableId(targetId, 't') || usedEntityIds.has(targetId)) {
          let freshId: string;
          do {
            freshId = generateTableId();
          } while (usedEntityIds.has(freshId));
          targetId = freshId;
        }
        usedEntityIds.add(targetId);
        entityIdMap.set(ent.id, targetId);
        idMap.set(ent.id, targetId);
      }

      // 2. Fields: keep original ID if valid c_xxxxxxxx and not collided; otherwise generate new c_xxxxxxxx
      for (const ent of bundle.entities) {
        for (const f of ent.fields) {
          let targetId = f.id;
          if (!isValidStableId(targetId, 'c') || usedFieldIds.has(targetId)) {
            let freshId: string;
            do {
              freshId = generateColumnId();
            } while (usedFieldIds.has(freshId));
            targetId = freshId;
          }
          usedFieldIds.add(targetId);
          fieldIdMap.set(f.id, targetId);
          idMap.set(f.id, targetId);
        }
      }

      // 3. Pages: keep original ID if valid p_xxxxxxxx and not collided; otherwise generate new p_xxxxxxxx
      for (const p of bundle.pages) {
        let targetId = p.id;
        if (!isValidStableId(targetId, 'p') || usedPageIds.has(targetId)) {
          let freshId: string;
          do {
            freshId = generatePageId();
          } while (usedPageIds.has(freshId));
          targetId = freshId;
        }
        usedPageIds.add(targetId);
        pageIdMap.set(p.id, targetId);
        idMap.set(p.id, targetId);
      }

      // 3b. Export Templates: keep original ID if valid et_xxxxxxxx and not collided; otherwise generate new et_xxxxxxxx
      for (const tpl of validatedExportTemplates) {
        let targetId = tpl.id;
        if (!isValidStableId(targetId, 'et') || usedTemplateIds.has(targetId)) {
          let freshId: string;
          do {
            freshId = generateExportTemplateId();
          } while (usedTemplateIds.has(freshId));
          targetId = freshId;
        }
        usedTemplateIds.add(targetId);
        templateIdMap.set(tpl.id, targetId);
        idMap.set(tpl.id, targetId);
      }

      // 4. Insert entities and fields, and create physical tables
      for (const ent of bundle.entities) {
        const newEntityId = entityIdMap.get(ent.id)!;
        const physicalTable = `tbl_${ent.name.toLowerCase()}`;
        const newDisplayFieldId = ent.displayFieldId
          ? idMap.get(ent.displayFieldId) || null
          : null;

        await client.query(
          `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version, display_field_id, icon, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 1, $6, $7, NOW(), NOW())`,
          [newEntityId, tenantId, ent.name, ent.label, physicalTable, newDisplayFieldId, ent.icon || null]
        );

        // Build physical table columns
        const colDefs = [
          'id VARCHAR(64) PRIMARY KEY',
          'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
          'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        ];

        for (const f of ent.fields) {
          const newFieldId = fieldIdMap.get(f.id)!;
          const colName = `col_${f.name.toLowerCase()}`;
          const remappedConfig = deepWalkRemap(f.config || {}, idMap);

          await client.query(
            `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, physical_column_name, type, required, is_unique, position, config, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
            [
              newFieldId,
              tenantId,
              newEntityId,
              f.name,
              f.label,
              colName,
              f.type,
              f.required,
              f.isUnique,
              f.position,
              JSON.stringify(remappedConfig),
            ]
          );

          let pgType = 'TEXT';
          if (f.type === 'number') pgType = 'DOUBLE PRECISION';
          else if (f.type === 'boolean') pgType = 'BOOLEAN DEFAULT FALSE';
          else if (f.type === 'date') pgType = 'TIMESTAMPTZ';
          else if (f.type === 'json') pgType = 'JSONB DEFAULT \'{}\'::jsonb';

          colDefs.push(`"${colName}" ${pgType}`);
        }

        // Create table in tenant schema
        await client.query(
          `CREATE TABLE IF NOT EXISTS "${tenantSchema}"."${physicalTable}" (${colDefs.join(', ')})`
        );
      }

      // 5. Insert relations
      for (const rel of bundle.relations) {
        const sourceEntityId = entityIdMap.get(rel.sourceEntityId);
        const sourceFieldId = fieldIdMap.get(rel.sourceFieldId);
        const targetEntityId = entityIdMap.get(rel.targetEntityId);
        const targetFieldId = rel.targetFieldId ? fieldIdMap.get(rel.targetFieldId) : null;

        if (sourceEntityId && sourceFieldId && targetEntityId) {
          await client.query(
            `INSERT INTO public.relation_def (id, tenant_id, name, source_entity_id, source_field_id, target_entity_id, target_field_id, relation_type, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
              generateRelationId(),
              tenantId,
              rel.name,
              sourceEntityId,
              sourceFieldId,
              targetEntityId,
              targetFieldId,
              rel.relationType,
            ]
          );
        }
      }

      // 6. Remap and insert pages using deepWalkRemap
      const remappedPages: Array<{
        newPageId: string;
        name: string;
        route: string;
        draft: any;
        published: any;
      }> = [];

      for (const p of bundle.pages) {
        const newPageId = pageIdMap.get(p.id)!;
        const remappedDraft = deepWalkRemap(p.draft, idMap);
        if (remappedDraft) remappedDraft.id = newPageId;

        const remappedPublished = p.published ? deepWalkRemap(p.published, idMap) : null;
        if (remappedPublished) remappedPublished.id = newPageId;

        await client.query(
          `INSERT INTO public.page_def (id, tenant_id, name, route, draft, published, version, allowed_roles, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), NOW())`,
          [
            newPageId,
            tenantId,
            p.name,
            p.route,
            JSON.stringify(remappedDraft),
            remappedPublished ? JSON.stringify(remappedPublished) : null,
            p.allowedRoles || null,
          ]
        );

        remappedPages.push({
          newPageId,
          name: p.name,
          route: p.route,
          draft: remappedDraft,
          published: remappedPublished,
        });
      }

      // 7. Remap permissions
      const remappedEntityPerms: EntityPermissionExport[] = [];
      const remappedFieldPerms: FieldPermissionExport[] = [];

      if (validatedPermissions) {
        for (const ep of validatedPermissions.entities) {
          const targetEntityId = entityIdMap.get(ep.entityId);
          if (targetEntityId) {
            remappedEntityPerms.push({
              ...ep,
              entityId: targetEntityId,
            });
          }
        }

        for (const fp of validatedPermissions.fields) {
          const targetEntityId = entityIdMap.get(fp.entityId);
          const targetFieldId = fieldIdMap.get(fp.fieldId);
          if (targetEntityId && targetFieldId) {
            remappedFieldPerms.push({
              ...fp,
              entityId: targetEntityId,
              fieldId: targetFieldId,
            });
          }
        }
      }

      // 8. Validate bindings on every page inside the same transaction
      const brokenBindings: string[] = [];
      for (const pageItem of remappedPages) {
        if (pageItem.draft) {
          const draftBroken = await pagesService.validateBindings(tenantId, pageItem.draft, client);
          for (const b of draftBroken) {
            brokenBindings.push(`Broken binding on page '${pageItem.name}' (${pageItem.route}) draft: ${b}`);
          }
        }
        if (pageItem.published) {
          const pubBroken = await pagesService.validateBindings(tenantId, pageItem.published, client);
          for (const b of pubBroken) {
            brokenBindings.push(`Broken binding on page '${pageItem.name}' (${pageItem.route}) published: ${b}`);
          }
        }
      }

      // If dry run or any broken binding, roll back transaction
      if (dryRun || brokenBindings.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: brokenBindings.length === 0,
          dryRun,
          conflicts: brokenBindings,
          entitiesCount: bundle.entities.length,
          pagesCount: bundle.pages.length,
          exportTemplatesCount: validatedExportTemplates.length,
          permissions: {
            entityPermissionsCount: remappedEntityPerms.length,
            fieldPermissionsCount: remappedFieldPerms.length,
            entities: remappedEntityPerms,
            fields: remappedFieldPerms,
          },
        };
      }

      // 8b. Insert export templates inside transaction with deepWalkRemap
      for (const tpl of validatedExportTemplates) {
        const newTemplateId = templateIdMap.get(tpl.id)!;
        const newEntityId = entityIdMap.get(tpl.entityId) || idMap.get(tpl.entityId)!;
        const remappedDraft = deepWalkRemap(tpl.draft, idMap);
        const remappedPublished = tpl.published ? deepWalkRemap(tpl.published, idMap) : null;

        await client.query(
          `INSERT INTO public.export_template (id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            newTemplateId,
            tenantId,
            newEntityId,
            tpl.name,
            JSON.stringify(remappedDraft),
            remappedPublished ? JSON.stringify(remappedPublished) : null,
            tpl.version || 1,
          ]
        );
      }

      // 9. Insert entity and field permissions inside transaction
      for (const ep of remappedEntityPerms) {
        const canExport = ep.canExport ?? (ep.role !== 'viewer');
        await client.query(
          `INSERT INTO public.entity_permission (tenant_id, entity_id, role, can_read, can_create, can_update, can_delete, can_export)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, entity_id, role) DO UPDATE
             SET can_read = $4, can_create = $5, can_update = $6, can_delete = $7, can_export = $8`,
          [tenantId, ep.entityId, ep.role, ep.canRead, ep.canCreate, ep.canUpdate, ep.canDelete, canExport]
        );
      }

      for (const fp of remappedFieldPerms) {
        await client.query(
          `INSERT INTO public.field_permission (tenant_id, entity_id, field_id, role, hidden, read_only)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, entity_id, field_id, role) DO UPDATE
             SET hidden = $5, read_only = $6`,
          [tenantId, fp.entityId, fp.fieldId, fp.role, fp.hidden, fp.readOnly]
        );
      }

      // 10. Import theme configuration if provided in bundle
      if (validatedThemeConfig) {
        await client.query(
          `UPDATE public.tenant SET theme_config = $1 WHERE id = $2`,
          [JSON.stringify(validatedThemeConfig), tenantId]
        );
      }

      await client.query('COMMIT');

      if (session) {
        await auditLogService.log({
          tenantId,
          userId: session.userId,
          userEmail: session.email,
          action: 'workspace.import',
          entityType: 'workspace',
          entityId: tenantId,
          afterState: {
            entitiesCount: bundle.entities.length,
            pagesCount: bundle.pages.length,
            themeConfig: bundle.themeConfig,
            permissionsCount: remappedEntityPerms.length + remappedFieldPerms.length,
          },
        });
      }

      return {
        success: true,
        dryRun: false,
        conflicts: [],
        entitiesCount: bundle.entities.length,
        pagesCount: bundle.pages.length,
        exportTemplatesCount: validatedExportTemplates.length,
        permissions: {
          entityPermissionsCount: remappedEntityPerms.length,
          fieldPermissionsCount: remappedFieldPerms.length,
          entities: remappedEntityPerms,
          fields: remappedFieldPerms,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const exportImportService = new ExportImportService();
