import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { exportImportService, type WorkspaceBundle } from '../src/workspace/export-import-service.js';
import { permissionService } from '../src/permissions/permission-service.js';
import { pagesService } from '../src/pages/pages-service.js';
import { pool } from '../src/db/pool.js';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';

describe('Workspace Permissions Export / Import & Policy', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('(a) round trip: field hidden from viewer and field read-only for editor survive import and are enforced via records API', async () => {
    const sourceTenant = `src_p_${crypto.randomBytes(3).toString('hex')}`;
    const targetTenant = `tgt_p_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(sourceTenant, 'Source Tenant');
    await migrationService.provisionTenant(targetTenant, 'Target Tenant');

    try {
      // 1. Create Device Entity in source workspace
      const createEntityRes = await migrationService.createEntity(sourceTenant, {
        name: 'device',
        label: 'Device',
        fields: [
          { name: 'model', label: 'Model', type: 'text', required: true },
          { name: 'secret_key', label: 'Secret Key', type: 'text', required: false },
          { name: 'price', label: 'Price', type: 'number', required: false },
        ],
      });
      const sourceEntityId = createEntityRes.entity.id;
      const secretField = createEntityRes.fields.find((f: any) => f.name === 'secret_key')!;
      const priceField = createEntityRes.fields.find((f: any) => f.name === 'price')!;

      // 2. Set field permissions in source workspace:
      // - secret_key hidden for viewer
      // - price read-only for editor
      await permissionService.setFieldPermission(sourceTenant, sourceEntityId, secretField.id, 'viewer', {
        hidden: true,
        readOnly: false,
      });
      await permissionService.setFieldPermission(sourceTenant, sourceEntityId, priceField.id, 'editor', {
        hidden: false,
        readOnly: true,
      });

      // 3. Export bundle from source workspace
      const bundle = await exportImportService.exportBundle(sourceTenant);
      expect(bundle.bundleVersion).toBe(2);
      expect(bundle.permissions).toBeDefined();
      expect(bundle.permissions?.fields.length).toBeGreaterThanOrEqual(2);

      const expSecretPerm = bundle.permissions?.fields.find(
        (f) => f.entityId === sourceEntityId && f.fieldId === secretField.id && f.role === 'viewer'
      );
      expect(expSecretPerm).toBeDefined();
      expect(expSecretPerm?.hidden).toBe(true);

      const expPricePerm = bundle.permissions?.fields.find(
        (f) => f.entityId === sourceEntityId && f.fieldId === priceField.id && f.role === 'editor'
      );
      expect(expPricePerm).toBeDefined();
      expect(expPricePerm?.readOnly).toBe(true);

      // 4. Dry run verification: reports permissions that would be applied
      const dryRunRes = await exportImportService.importBundle(targetTenant, bundle, true);
      expect(dryRunRes.success).toBe(true);
      expect(dryRunRes.dryRun).toBe(true);
      expect(dryRunRes.permissions).toBeDefined();
      expect(dryRunRes.permissions?.fieldPermissionsCount).toBeGreaterThanOrEqual(2);

      // Confirm dry run rolled back and did not write to DB
      const dbCheckBefore = await pool.query(
        `SELECT COUNT(*) as count FROM public.field_permission WHERE tenant_id = $1`,
        [targetTenant]
      );
      expect(parseInt(dbCheckBefore.rows[0].count, 10)).toBe(0);

      // 5. Real Import into target workspace
      const importRes = await exportImportService.importBundle(targetTenant, bundle, false);
      expect(importRes.success).toBe(true);
      expect(importRes.dryRun).toBe(false);

      // 6. Verify target workspace via Records API:
      // Admin inserts a test record in target workspace
      const adminSession = await createTestSession(targetTenant, 'admin', 'tgt_admin');
      const insertRes = await server.inject({
        method: 'POST',
        url: '/api/entities/device/records',
        headers: adminSession.headers,
        payload: {
          model: 'Model-X100',
          secret_key: 'SuperSecret123',
          price: 999,
        },
      });
      expect(insertRes.statusCode).toBe(201);
      const inserted = JSON.parse(insertRes.payload);

      // Test as VIEWER in target workspace: secret_key must be hidden (stripped)
      const viewerSession = await createTestSession(targetTenant, 'viewer', 'tgt_viewer');
      const getResViewer = await server.inject({
        method: 'GET',
        url: `/api/entities/device/records/${inserted.id}`,
        headers: viewerSession.headers,
      });
      expect(getResViewer.statusCode).toBe(200);
      const viewerRecord = JSON.parse(getResViewer.payload);
      expect(viewerRecord.model).toBe('Model-X100');
      expect(viewerRecord.secret_key).toBeUndefined();

      // Test as EDITOR in target workspace: price is read-only
      const editorSession = await createTestSession(targetTenant, 'editor', 'tgt_editor');
      const patchReadOnlyRes = await server.inject({
        method: 'PATCH',
        url: `/api/entities/device/records/${inserted.id}`,
        headers: editorSession.headers,
        payload: {
          price: 1200,
        },
      });
      expect(patchReadOnlyRes.statusCode).toBe(403);
      expect(JSON.parse(patchReadOnlyRes.payload).message).toContain('read-only');

      // Editor updating non-read-only field succeeds
      const patchModelRes = await server.inject({
        method: 'PATCH',
        url: `/api/entities/device/records/${inserted.id}`,
        headers: editorSession.headers,
        payload: {
          model: 'Model-X200-Updated',
        },
      });
      expect(patchModelRes.statusCode).toBe(200);
      expect(JSON.parse(patchModelRes.payload).model).toBe('Model-X200-Updated');

      await cleanupTestUser(adminSession.userId);
      await cleanupTestUser(viewerSession.userId);
      await cleanupTestUser(editorSession.userId);
    } finally {
      await pool.query(`DELETE FROM public.field_permission WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.entity_permission WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.field_def WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.entity_def WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [sourceTenant, targetTenant]);
    }
  });

  it('(b) an entity with delete disabled for editor keeps it after import', async () => {
    const sourceTenant = `src_del_${crypto.randomBytes(3).toString('hex')}`;
    const targetTenant = `tgt_del_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(sourceTenant, 'Source Tenant Del');
    await migrationService.provisionTenant(targetTenant, 'Target Tenant Del');

    try {
      // 1. Create Project entity in source workspace
      const createRes = await migrationService.createEntity(sourceTenant, {
        name: 'project',
        label: 'Project',
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
      });
      const sourceEntityId = createRes.entity.id;

      // 2. Disable delete permission for editor on project entity
      await permissionService.setEntityPermission(sourceTenant, sourceEntityId, 'editor', {
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: false,
      });

      // 3. Export workspace
      const bundle = await exportImportService.exportBundle(sourceTenant);
      expect(bundle.bundleVersion).toBe(2);
      const editorEntPerm = bundle.permissions?.entities.find(
        (ep) => ep.entityId === sourceEntityId && ep.role === 'editor'
      );
      expect(editorEntPerm).toBeDefined();
      expect(editorEntPerm?.canDelete).toBe(false);

      // 4. Import workspace into target
      const importRes = await exportImportService.importBundle(targetTenant, bundle, false);
      expect(importRes.success).toBe(true);

      // 5. Admin creates a record in target workspace
      const adminSession = await createTestSession(targetTenant, 'admin', 'tgt_del_admin');
      const createRecRes = await server.inject({
        method: 'POST',
        url: '/api/entities/project/records',
        headers: adminSession.headers,
        payload: { name: 'Alpha Project' },
      });
      expect(createRecRes.statusCode).toBe(201);
      const recId = JSON.parse(createRecRes.payload).id;

      // 6. Editor attempts to delete record in target workspace -> must be blocked with 403 Forbidden
      const editorSession = await createTestSession(targetTenant, 'editor', 'tgt_del_editor');
      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/entities/project/records/${recId}`,
        headers: editorSession.headers,
      });
      expect(deleteRes.statusCode).toBe(403);
      expect(JSON.parse(deleteRes.payload).message).toContain('delete');

      await cleanupTestUser(adminSession.userId);
      await cleanupTestUser(editorSession.userId);
    } finally {
      await pool.query(`DELETE FROM public.field_permission WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.entity_permission WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.field_def WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.entity_def WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [sourceTenant, targetTenant]);
    }
  });

  it('(c) an old bundle without a permissions section imports and gets defaults', async () => {
    const targetTenant = `tgt_old_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(targetTenant, 'Target Tenant Old');

    try {
      // Legacy bundle version 1 with no permissions property
      const legacyBundle: WorkspaceBundle = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: 't_legacy_item',
            name: 'inventory_item',
            label: 'Inventory Item',
            fields: [
              {
                id: 'c_item_sku',
                name: 'sku',
                label: 'SKU',
                type: 'text',
                required: true,
                isUnique: false,
                position: 0,
                config: {},
              },
            ],
          },
        ],
        relations: [],
        pages: [],
        // permissions omitted (undefined)
      };

      const importRes = await exportImportService.importBundle(targetTenant, legacyBundle, false);
      expect(importRes.success).toBe(true);

      // Verify no custom rows were inserted into permissions tables
      const entityPermRows = await pool.query(
        `SELECT * FROM public.entity_permission WHERE tenant_id = $1`,
        [targetTenant]
      );
      expect(entityPermRows.rows.length).toBe(0);

      const fieldPermRows = await pool.query(
        `SELECT * FROM public.field_permission WHERE tenant_id = $1`,
        [targetTenant]
      );
      expect(fieldPermRows.rows.length).toBe(0);

      // Verify permissionService resolves default permissions
      const entRes = await pool.query<{ id: string }>(
        `SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`,
        [targetTenant, 'inventory_item']
      );
      const newEntityId = entRes.rows[0].id;

      const editorPerm = await permissionService.getEntityPermission(targetTenant, newEntityId, 'editor');
      expect(editorPerm).toEqual({
        role: 'editor',
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canExport: true,
      });

      const viewerPerm = await permissionService.getEntityPermission(targetTenant, newEntityId, 'viewer');
      expect(viewerPerm).toEqual({
        role: 'viewer',
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        canExport: false,
      });
    } finally {
      await pool.query(`DELETE FROM public.field_permission WHERE tenant_id = $1`, [targetTenant]);
      await pool.query(`DELETE FROM public.entity_permission WHERE tenant_id = $1`, [targetTenant]);
      await pool.query(`DELETE FROM public.field_def WHERE tenant_id = $1`, [targetTenant]);
      await pool.query(`DELETE FROM public.entity_def WHERE tenant_id = $1`, [targetTenant]);
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [targetTenant]);
    }
  });

  it('(d) a bundle with an unknown role is rejected', async () => {
    const targetTenant = `tgt_bad_role_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(targetTenant, 'Target Tenant Bad Role');

    try {
      const bundleWithBadRole: any = {
        bundleVersion: 2,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: 't_role_test',
            name: 'role_test',
            label: 'Role Test',
            fields: [
              {
                id: 'c_rt_name',
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                isUnique: false,
                position: 0,
                config: {},
              },
            ],
          },
        ],
        relations: [],
        pages: [],
        permissions: {
          entities: [
            {
              entityId: 't_role_test',
              role: 'super_admin_unauthorized', // Invalid role!
              canRead: true,
              canCreate: true,
              canUpdate: true,
              canDelete: true,
            },
          ],
          fields: [],
        },
      };

      const result = await exportImportService.importBundle(targetTenant, bundleWithBadRole, true);
      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(
        result.conflicts.some((c) => c.includes('Role must be one of') || c.includes('Invalid permissions'))
      ).toBe(true);

      // Also test unknown entity ID in permissions
      const bundleWithUnknownEntityId: any = {
        bundleVersion: 2,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: 't_valid_ent',
            name: 'valid_ent',
            label: 'Valid Ent',
            fields: [],
          },
        ],
        relations: [],
        pages: [],
        permissions: {
          entities: [
            {
              entityId: 't_non_existent_entity_id',
              role: 'editor',
              canRead: true,
              canCreate: true,
              canUpdate: true,
              canDelete: false,
            },
          ],
          fields: [],
        },
      };

      const result2 = await exportImportService.importBundle(targetTenant, bundleWithUnknownEntityId, true);
      expect(result2.success).toBe(false);
      expect(
        result2.conflicts.some((c) => c.includes('Unknown entity ID') && c.includes('t_non_existent_entity_id'))
      ).toBe(true);
    } finally {
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [targetTenant]);
    }
  });

  it('(e) page allowedRoles survive the round trip', async () => {
    const sourceTenant = `src_pg_roles_${crypto.randomBytes(3).toString('hex')}`;
    const targetTenant = `tgt_pg_roles_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(sourceTenant, 'Source Tenant Page Roles');
    await migrationService.provisionTenant(targetTenant, 'Target Tenant Page Roles');

    try {
      // 1. Create a page with restricted allowedRoles in source workspace
      const createdPage = await pagesService.createPage(sourceTenant, {
        name: 'Executive Dashboard',
        route: '/executive-dashboard',
        draft: {
          schemaVersion: 2,
          id: 'p_exec_dash',
          version: 1,
          route: '/executive-dashboard',
          allowedRoles: ['admin', 'builder'],
          root: {
            id: 'root_text',
            type: 'text',
            props: { value: 'Executive Only' },
          },
        } as any,
      });

      // Update public.page_def directly to ensure allowed_roles column is set on the page
      await pool.query(
        `UPDATE public.page_def SET allowed_roles = $1 WHERE id = $2 AND tenant_id = $3`,
        [['admin', 'builder'], createdPage.id, sourceTenant]
      );

      // 2. Export source workspace
      const bundle = await exportImportService.exportBundle(sourceTenant);
      expect(bundle.bundleVersion).toBe(2);
      const exportedPage = bundle.pages.find((p) => p.route === '/executive-dashboard');
      expect(exportedPage).toBeDefined();
      expect(exportedPage?.allowedRoles).toEqual(['admin', 'builder']);

      // 3. Import bundle into target workspace
      const importRes = await exportImportService.importBundle(targetTenant, bundle, false);
      expect(importRes.success).toBe(true);

      // 4. Export again from target workspace (round trip)
      const targetBundle = await exportImportService.exportBundle(targetTenant);
      const roundTripPage = targetBundle.pages.find((p) => p.route === '/executive-dashboard');
      expect(roundTripPage).toBeDefined();
      expect(roundTripPage?.allowedRoles).toEqual(['admin', 'builder']);

      // 5. Query database in target workspace directly to confirm persistence
      const pageDb = await pool.query<{ allowed_roles: string[] }>(
        `SELECT allowed_roles FROM public.page_def WHERE tenant_id = $1 AND route = $2`,
        [targetTenant, '/executive-dashboard']
      );
      expect(pageDb.rows.length).toBe(1);
      expect(pageDb.rows[0].allowed_roles).toEqual(['admin', 'builder']);
    } finally {
      await pool.query(`DELETE FROM public.page_def WHERE tenant_id IN ($1, $2)`, [sourceTenant, targetTenant]);
      await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [sourceTenant, targetTenant]);
    }
  });
});
