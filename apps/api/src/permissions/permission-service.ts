/**
 * PermissionService: entity-level and field-level RBAC.
 *
 * Defaults (when no specific row exists):
 *   Entity: viewer=read, editor=read+create+update+delete, builder/admin/owner=all
 *   Field:  all roles can read + write (hidden=false, readOnly=false)
 */

import { pool } from '../db/pool.js';
import type { TenantRole } from '../auth/auth-types.js';
import { hasMinRole } from '../auth/auth-types.js';

export interface EntityPermission {
  role: TenantRole;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
}

export interface FieldPermission {
  fieldId: string;
  role: TenantRole;
  hidden: boolean;
  readOnly: boolean;
}

export class PermissionService {
  // ─── Entity Permissions ───────────────────────────────────────

  /** Returns the effective permission for a given role on an entity. Falls back to defaults. */
  async getEntityPermission(
    tenantId: string,
    entityId: string,
    role: TenantRole
  ): Promise<EntityPermission> {
    const res = await pool.query(
      `SELECT can_read, can_create, can_update, can_delete, can_export
       FROM public.entity_permission
       WHERE tenant_id = $1 AND entity_id = $2 AND role = $3`,
      [tenantId, entityId, role]
    );

    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        role,
        canRead: r.can_read,
        canCreate: r.can_create,
        canUpdate: r.can_update,
        canDelete: r.can_delete,
        canExport: r.can_export ?? (role !== 'viewer'),
      };
    }

    // Default rules
    return this.defaultEntityPermission(role);
  }

  defaultEntityPermission(role: TenantRole): EntityPermission {
    if (role === 'viewer') {
      return { role, canRead: true, canCreate: false, canUpdate: false, canDelete: false, canExport: false };
    }
    // editor, builder, admin, owner all get full CRUD and export
    return { role, canRead: true, canCreate: true, canUpdate: true, canDelete: true, canExport: true };
  }

  async setEntityPermission(
    tenantId: string,
    entityId: string,
    role: TenantRole,
    perm: Omit<EntityPermission, 'role'>
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

    const canExport = perm.canExport ?? (role !== 'viewer');

    await pool.query(
      `INSERT INTO public.entity_permission (tenant_id, entity_id, role, can_read, can_create, can_update, can_delete, can_export)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, entity_id, role) DO UPDATE
         SET can_read=$4, can_create=$5, can_update=$6, can_delete=$7, can_export=$8`,
      [tenantId, entityId, role, perm.canRead, perm.canCreate, perm.canUpdate, perm.canDelete, canExport]
    );
  }

  async getEntityPermissions(tenantId: string, entityId: string): Promise<EntityPermission[]> {
    const res = await pool.query(
      `SELECT role, can_read, can_create, can_update, can_delete, can_export
       FROM public.entity_permission
       WHERE tenant_id = $1 AND entity_id = $2`,
      [tenantId, entityId]
    );
    return res.rows.map((r) => ({
      role: r.role as TenantRole,
      canRead: r.can_read,
      canCreate: r.can_create,
      canUpdate: r.can_update,
      canDelete: r.can_delete,
      canExport: r.can_export ?? (r.role !== 'viewer'),
    }));
  }

  async canExport(tenantId: string, entityId: string, role: TenantRole): Promise<boolean> {
    const perm = await this.getEntityPermission(tenantId, entityId, role);
    return Boolean(perm.canRead && perm.canExport);
  }

  // ─── Field Permissions ────────────────────────────────────────

  async getFieldPermissions(
    tenantId: string,
    entityId: string,
    role: TenantRole
  ): Promise<Map<string, { hidden: boolean; readOnly: boolean }>> {
    const res = await pool.query(
      `SELECT field_id, hidden, read_only
       FROM public.field_permission
       WHERE tenant_id = $1 AND entity_id = $2 AND role = $3`,
      [tenantId, entityId, role]
    );

    const map = new Map<string, { hidden: boolean; readOnly: boolean }>();
    for (const row of res.rows) {
      map.set(row.field_id, { hidden: row.hidden, readOnly: row.read_only });
    }
    return map;
  }

  async setFieldPermission(
    tenantId: string,
    entityId: string,
    fieldId: string,
    role: TenantRole,
    perm: { hidden: boolean; readOnly: boolean }
  ): Promise<void> {
    const fieldRes = await pool.query(
      `SELECT id FROM public.field_def WHERE id = $1 AND entity_id = $2 AND tenant_id = $3`,
      [fieldId, entityId, tenantId]
    );
    if (fieldRes.rows.length === 0) {
      const err = new Error(`Field '${fieldId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    await pool.query(
      `INSERT INTO public.field_permission (tenant_id, entity_id, field_id, role, hidden, read_only)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, entity_id, field_id, role) DO UPDATE
         SET hidden=$5, read_only=$6`,
      [tenantId, entityId, fieldId, role, perm.hidden, perm.readOnly]
    );
  }

  async getAllFieldPermissions(
    tenantId: string,
    entityId: string
  ): Promise<FieldPermission[]> {
    const res = await pool.query(
      `SELECT field_id AS "fieldId", role, hidden, read_only AS "readOnly"
       FROM public.field_permission
       WHERE tenant_id = $1 AND entity_id = $2`,
      [tenantId, entityId]
    );
    return res.rows.map((r) => ({
      fieldId: r.fieldId,
      role: r.role as TenantRole,
      hidden: r.hidden,
      readOnly: r.readOnly,
    }));
  }

  /**
   * Returns the set of field IDs hidden from this role for this entity.
   */
  async getHiddenFieldIds(
    tenantId: string,
    entityId: string,
    role: TenantRole
  ): Promise<Set<string>> {
    const perms = await this.getFieldPermissions(tenantId, entityId, role);
    const hidden = new Set<string>();
    for (const [fieldId, p] of perms.entries()) {
      if (p.hidden) hidden.add(fieldId);
    }
    return hidden;
  }

  /**
   * Returns the set of field IDs that are read-only for this role.
   */
  async getReadOnlyFieldIds(
    tenantId: string,
    entityId: string,
    role: TenantRole
  ): Promise<Set<string>> {
    const perms = await this.getFieldPermissions(tenantId, entityId, role);
    const readOnly = new Set<string>();
    for (const [fieldId, p] of perms.entries()) {
      if (p.readOnly) readOnly.add(fieldId);
    }
    return readOnly;
  }

  // ─── Page Permissions ─────────────────────────────────────────

  /**
   * Check if a role can access a page. Unpublished drafts require builder+.
   */
  canAccessPage(
    role: TenantRole,
    allowedRoles: TenantRole[] | null | undefined,
    isPublished: boolean
  ): boolean {
    // Unpublished pages only visible to builder+
    if (!isPublished && !hasMinRole(role, 'builder')) return false;

    // If page has explicit allowed roles list, enforce it
    if (allowedRoles && allowedRoles.length > 0) {
      return (allowedRoles as string[]).includes(role);
    }

    // Default: all authenticated roles can see published pages
    return true;
  }
}

export const permissionService = new PermissionService();
