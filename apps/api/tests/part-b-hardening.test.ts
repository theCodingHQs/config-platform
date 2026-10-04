import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { runCatalogMigrations } from '../src/db/catalog-migration-runner.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { auditLogService } from '../src/audit/audit-service.js';
import { tenantLimitsService, PLAN_LIMITS } from '../src/limits/tenant-limits.js';
import { exportImportService, deepWalkRemap } from '../src/workspace/export-import-service.js';
import { EntityCache } from '../src/records/entity-cache.js';
import { queryBuilder } from '../src/records/query-builder.js';
import { isValidStableId, generateTableId, generateColumnId } from '../src/utils/id-gen.js';
import {
  StackPropsSchema,
  TextPropsSchema,
  ButtonPropsSchema,
  TablePropsSchema,
  FormPropsSchema,
  ModalPropsSchema,
  SelectPropsSchema,
  InputPropsSchema,
  DetailsPropsSchema,
  GridPropsSchema,
  CardPropsSchema,
  TabsPropsSchema,
  StatPropsSchema,
  ChartPropsSchema,
} from '@config-platform/schema';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

describe('Part B: Hardening & Enterprise Guardrails', () => {
  let server: FastifyInstance;

  const tenant = `part_b_${crypto.randomBytes(3).toString('hex')}`;
  let owner: TestSession;
  let admin: TestSession;
  let builder: TestSession;
  let viewer: TestSession;

  let baseEntityId: string;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(tenant, 'Hardening Workspace');

    owner = await createTestSession(tenant, 'owner', 'owner_b');
    admin = await createTestSession(tenant, 'admin', 'admin_b');
    builder = await createTestSession(tenant, 'builder', 'builder_b');
    viewer = await createTestSession(tenant, 'viewer', 'viewer_b');

    const entRes = await migrationService.createEntity(tenant, {
      name: 'device',
      label: 'Device',
      fields: [
        { name: 'serial', label: 'Serial Number', type: 'text', required: true, unique: false, config: {} },
        { name: 'temp', label: 'Temperature', type: 'number', required: false, unique: false, config: {} },
      ],
    });
    baseEntityId = entRes.entityId;
  }, 60000);

  afterAll(async () => {
    if (owner?.userId) await cleanupTestUser(owner.userId);
    if (admin?.userId) await cleanupTestUser(admin.userId);
    if (builder?.userId) await cleanupTestUser(builder.userId);
    if (viewer?.userId) await cleanupTestUser(viewer.userId);
    if (server) await server.close();
  });

  // =========================================================================
  // 1. Per-tenant limits, configurable per plan
  // =========================================================================
  describe('B.1: Plan Limits & Usage Reporting', () => {
    it('returns workspace plan and usage report via GET /workspace/usage', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/workspace/usage',
        headers: owner.headers,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.plan).toBe('free');
      expect(data.limits.maxEntities).toBe(PLAN_LIMITS.free.maxEntities);
      expect(data.usage.entities).toBeGreaterThanOrEqual(1);
    });

    it('enforces entity limit and rejects with 403 LimitExceededError when exceeded', async () => {
      // Temporarily set a tenant to free plan with 1 max entity
      const customTenant = `limit_test_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(customTenant, 'Limit Tenant');
      const customOwner = await createTestSession(customTenant, 'owner', 'custom_owner');

      // Create 1 entity (now at limit of 1 if plan allows 1, or fill to free limit)
      // We test tenantLimitsService.checkEntityLimit by overriding plan or testing max
      const originalMax = PLAN_LIMITS.free.maxEntities;
      try {
        PLAN_LIMITS.free.maxEntities = 1;
        await migrationService.createEntity(customTenant, { name: 'ent1', label: 'Ent 1', fields: [] });

        // Attempting to create second entity must fail with 403
        const res = await server.inject({
          method: 'POST',
          url: '/api/schema/entities',
          headers: customOwner.headers,
          payload: { name: 'ent2', label: 'Ent 2', fields: [] },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('Limit exceeded');
      } finally {
        PLAN_LIMITS.free.maxEntities = originalMax;
        await cleanupTestUser(customOwner.userId);
      }
    });

    it('enforces field limit per entity and rejects with 403 when exceeded', async () => {
      const originalMaxFields = PLAN_LIMITS.free.maxFieldsPerEntity;
      try {
        PLAN_LIMITS.free.maxFieldsPerEntity = 2; // baseEntityId already has 2 fields (serial, temp)
        const res = await server.inject({
          method: 'POST',
          url: `/api/schema/entities/${baseEntityId}/fields`,
          headers: builder.headers,
          payload: {
            name: 'extra_field',
            label: 'Extra Field',
            type: 'text',
            expectedVersion: 1,
          },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('Limit exceeded');
      } finally {
        PLAN_LIMITS.free.maxFieldsPerEntity = originalMaxFields;
      }
    });
  });

  // =========================================================================
  // 2. Query caps and Statement Timeout
  // =========================================================================
  describe('B.2: Statement Timeout & Query Caps', () => {
    it('enforces cap on filter count (max 10 filters per query)', async () => {
      // Build query with 11 filters
      const query: Record<string, string> = {};
      for (let i = 1; i <= 11; i++) {
        query[`filter[serial][eq]`] = `val_${i}`;
      }

      // Pass via query object with 11 filters
      const filterObj: Record<string, any> = {};
      for (let i = 1; i <= 11; i++) {
        filterObj[`f_${i}`] = { eq: `val_${i}` };
      }

      const res = await server.inject({
        method: 'GET',
        url: `/api/entities/${baseEntityId}/records?${new URLSearchParams(
          Array.from({ length: 11 }, (_, i) => [`filter[serial][eq]`, `val_${i}`])
        ).toString()}`,
        headers: owner.headers,
      });
      // Query builder rejects queries with > 10 filters
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Filter limit exceeded');
    });

    it('caps page size at 100 max', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/entities/${baseEntityId}/records?limit=500`,
        headers: owner.headers,
      });
      expect(res.statusCode).toBe(200);
      // Query executes and clamps limit to 100
      expect(res.json().limit).toBe(100);
    });

    it('caps aggregate group count at 50 max', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/entities/${baseEntityId}/aggregate?op=count&field=serial&groupBy=serial&groupLimit=100`,
        headers: owner.headers,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Group limit exceeded');
    });
  });

  // =========================================================================
  // 3. Append-only Audit Log
  // =========================================================================
  describe('B.3: Audit Log & Viewer API', () => {
    it('records audit events for entity, page, and permission mutations', async () => {
      // 1. Create a page to trigger page.create audit log
      const pageRes = await server.inject({
        method: 'POST',
        url: '/api/pages',
        headers: builder.headers,
        payload: { name: 'Audit Test Page', route: '/audit-test-page' },
      });
      expect(pageRes.statusCode).toBe(201);
      const pageId = pageRes.json().id;

      // 2. Update page to trigger page.update
      await server.inject({
        method: 'PUT',
        url: `/api/pages/${pageId}`,
        headers: builder.headers,
        payload: { name: 'Updated Audit Test Page' },
      });

      // 3. Update entity permission to trigger permission.entity.update
      await server.inject({
        method: 'PUT',
        url: `/api/schema/entities/${baseEntityId}/permissions/editor`,
        headers: admin.headers,
        payload: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
      });

      // 4. Query audit logs as admin
      const logsRes = await server.inject({
        method: 'GET',
        url: '/api/audit-logs?limit=20',
        headers: admin.headers,
      });
      expect(logsRes.statusCode).toBe(200);
      const logs = logsRes.json();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);

      const pageCreateLog = logs.find((l: any) => l.action === 'page.create' && l.entityId === pageId);
      expect(pageCreateLog).toBeDefined();
      expect(pageCreateLog.userEmail).toBe(builder.email);

      const permLog = logs.find((l: any) => l.action === 'permission.entity.update');
      expect(permLog).toBeDefined();
      expect(permLog.afterState).toBeDefined();

      // 5. Non-admin (viewer) gets 403 on /audit-logs
      const viewerRes = await server.inject({
        method: 'GET',
        url: '/api/audit-logs',
        headers: viewer.headers,
      });
      expect(viewerRes.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 4. Export / Import Workspace Bundle
  // =========================================================================
  describe('B.4: Versioned Workspace Export & Import', () => {
    it('exports workspace schema and pages as a bundle, then imports into a new workspace', async () => {
      // Export current workspace
      const exportRes = await server.inject({
        method: 'GET',
        url: '/api/workspace/export',
        headers: builder.headers,
      });
      expect(exportRes.statusCode).toBe(200);
      const bundle = exportRes.json();
      expect(bundle.bundleVersion).toBe(1);
      expect(bundle.entities.length).toBeGreaterThan(0);
      expect(bundle.entities.some((e: any) => e.name === 'device')).toBe(true);

      // Create a fresh target tenant
      const targetTenant = `imp_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(targetTenant, 'Import Target');
      const targetAdmin = await createTestSession(targetTenant, 'admin', 'imp_admin');

      // Test dry-run validation first
      const dryRunRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: targetAdmin.headers,
        payload: { bundle, dryRun: true },
      });
      expect(dryRunRes.statusCode).toBe(200);
      expect(dryRunRes.json().dryRun).toBe(true);
      expect(dryRunRes.json().success).toBe(true);
      expect(dryRunRes.json().conflicts).toHaveLength(0);

      // Test actual import in single transaction
      const importRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: targetAdmin.headers,
        payload: { bundle, dryRun: false },
      });
      expect(importRes.statusCode).toBe(200);
      expect(importRes.json().success).toBe(true);

      // Verify the entities and pages now exist in target tenant
      const entCheck = await pool.query(
        'SELECT name FROM public.entity_def WHERE tenant_id = $1 AND name = $2',
        [targetTenant, 'device']
      );
      expect(entCheck.rows.length).toBe(1);

      // Second import of same bundle should detect naming conflicts
      const conflictRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: targetAdmin.headers,
        payload: { bundle, dryRun: true },
      });
      expect(conflictRes.statusCode).toBe(200);
      expect(conflictRes.json().conflicts.length).toBeGreaterThan(0);

      await cleanupTestUser(targetAdmin.userId);
    });

    it('keeps original IDs on import when there is no collision, and remaps to valid t_xxxxxxxx/c_xxxxxxxx only on collision', async () => {
      const freshTenant1 = `coll_test_1_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(freshTenant1, 'Collision Target 1');
      const admin1 = await createTestSession(freshTenant1, 'admin', 'coll_admin_1');

      const origEntityId = 't_' + crypto.randomBytes(4).toString('hex');
      const origFieldId = 'c_' + crypto.randomBytes(4).toString('hex');

      const nonCollidingBundle: any = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: origEntityId,
            name: 'custom_item',
            label: 'Custom Item',
            fields: [
              {
                id: origFieldId,
                name: 'code',
                label: 'Code',
                type: 'text',
                required: false,
                isUnique: false,
                position: 0,
                config: {},
              },
            ],
          },
        ],
        relations: [],
        pages: [],
      };

      // 1. Import when there is NO collision: original IDs must be preserved
      const res1 = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: admin1.headers,
        payload: { bundle: nonCollidingBundle, dryRun: false },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().success).toBe(true);

      const entRow1 = await pool.query<{ id: string }>(
        `SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`,
        [freshTenant1, 'custom_item']
      );
      expect(entRow1.rows[0].id).toBe(origEntityId);
      expect(isValidStableId(entRow1.rows[0].id, 't')).toBe(true);

      const fieldRow1 = await pool.query<{ id: string }>(
        `SELECT id FROM public.field_def WHERE tenant_id = $1 AND name = $2`,
        [freshTenant1, 'code']
      );
      expect(fieldRow1.rows[0].id).toBe(origFieldId);
      expect(isValidStableId(fieldRow1.rows[0].id, 'c')).toBe(true);

      // 2. Import the SAME bundle into a DIFFERENT tenant:
      // Since origEntityId and origFieldId already exist globally in public.entity_def and public.field_def,
      // they MUST collide and be remapped to fresh IDs conforming to t_xxxxxxxx and c_xxxxxxxx.
      const freshTenant2 = `coll_test_2_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(freshTenant2, 'Collision Target 2');
      const admin2 = await createTestSession(freshTenant2, 'admin', 'coll_admin_2');

      const res2 = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: admin2.headers,
        payload: { bundle: nonCollidingBundle, dryRun: false },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().success).toBe(true);

      const entRow2 = await pool.query<{ id: string }>(
        `SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`,
        [freshTenant2, 'custom_item']
      );
      expect(entRow2.rows[0].id).not.toBe(origEntityId);
      expect(isValidStableId(entRow2.rows[0].id, 't')).toBe(true);

      const fieldRow2 = await pool.query<{ id: string }>(
        `SELECT id FROM public.field_def WHERE tenant_id = $1 AND name = $2`,
        [freshTenant2, 'code']
      );
      expect(fieldRow2.rows[0].id).not.toBe(origFieldId);
      expect(isValidStableId(fieldRow2.rows[0].id, 'c')).toBe(true);

      await cleanupTestUser(admin1.userId);
      await cleanupTestUser(admin2.userId);
    });

    it('(a) after import, serialize all pages and field configs and assert no old ID remains that is not also in the new catalog', async () => {
      const targetTenant = `imp_chk_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(targetTenant, 'Import Check Target');
      const targetAdmin = await createTestSession(targetTenant, 'admin', 'imp_chk_admin');

      const oldEntityId = 't_' + crypto.randomBytes(4).toString('hex');
      const oldFieldId1 = 'c_' + crypto.randomBytes(4).toString('hex');
      const oldFieldId2 = 'c_' + crypto.randomBytes(4).toString('hex');
      const oldRelEntityId = 't_' + crypto.randomBytes(4).toString('hex');
      const oldRelFieldId = 'c_' + crypto.randomBytes(4).toString('hex');

      // Pre-insert entity with oldEntityId into public.entity_def to FORCE collision
      await pool.query(
        `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [oldEntityId, tenant, 'collision_entity', 'Collision Entity', 'tbl_coll']
      );

      const bundle: any = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: oldEntityId,
            name: 'sensor',
            label: 'Sensor',
            displayFieldId: oldFieldId1,
            fields: [
              {
                id: oldFieldId1,
                name: 'sensor_name',
                label: 'Sensor Name',
                type: 'text',
                required: true,
                isUnique: false,
                position: 0,
                config: {},
              },
              {
                id: oldFieldId2,
                name: 'reading',
                label: 'Reading',
                type: 'number',
                required: false,
                isUnique: false,
                position: 1,
                config: { min: 0, max: 500 },
              },
            ],
          },
          {
            id: oldRelEntityId,
            name: 'location',
            label: 'Location',
            fields: [
              {
                id: oldRelFieldId,
                name: 'loc_ref',
                label: 'Location Ref',
                type: 'reference',
                required: false,
                isUnique: false,
                position: 0,
                config: { targetEntityId: oldEntityId },
              },
            ],
          },
        ],
        relations: [],
        pages: [
          {
            id: 'p_sensor_page',
            name: 'Sensors',
            route: '/sensors',
            draft: {
              schemaVersion: 2,
              id: 'p_sensor_page',
              version: 1,
              route: '/sensors',
              dataSources: [
                {
                  id: 'ds_sensors',
                  entityId: oldEntityId,
                  sort: { fieldId: oldFieldId2, direction: 'asc' },
                  filter: { [oldFieldId1]: 'Active' },
                },
              ],
              root: {
                id: 'root_stack',
                type: 'stack',
                props: { direction: 'vertical' },
                children: [
                  {
                    id: 'tbl_sensors',
                    type: 'table',
                    props: {
                      source: 'ds_sensors',
                      columns: [{ fieldId: oldFieldId1 }, { fieldId: oldFieldId2 }],
                    },
                  },
                  {
                    id: 'chart_sensors',
                    type: 'chart',
                    props: {
                      source: 'ds_sensors',
                      type: 'line',
                      groupByFieldId: oldFieldId1,
                      aggregateFieldId: oldFieldId2,
                    },
                  },
                  {
                    id: 'stat_sensors',
                    type: 'stat',
                    props: {
                      entityId: oldEntityId,
                      op: 'avg',
                      fieldId: oldFieldId2,
                    },
                  },
                  {
                    id: 'card_expr',
                    type: 'card',
                    props: {
                      title: 'Expression Test',
                    },
                    visibleIf: `{{ row.${oldFieldId2} > 10 }}`,
                  },
                ],
              },
            },
            published: null,
          },
        ],
      };

      const importRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: targetAdmin.headers,
        payload: { bundle, dryRun: false },
      });
      expect(importRes.statusCode).toBe(200);
      expect(importRes.json().success).toBe(true);

      // Fetch all pages, field configs, and entity definitions from the database for this tenant
      const pagesInDb = await pool.query<{ draft: any; published: any }>(
        `SELECT draft, published FROM public.page_def WHERE tenant_id = $1`,
        [targetTenant]
      );
      const fieldsInDb = await pool.query<{ id: string; config: any }>(
        `SELECT id, config FROM public.field_def WHERE tenant_id = $1`,
        [targetTenant]
      );
      const entitiesInDb = await pool.query<{ id: string; display_field_id: string }>(
        `SELECT id, display_field_id FROM public.entity_def WHERE tenant_id = $1`,
        [targetTenant]
      );

      // Collect all valid new catalog IDs for target tenant
      const catalogEntityIds = new Set(entitiesInDb.rows.map((e) => e.id));
      const catalogFieldIds = new Set(fieldsInDb.rows.map((f) => f.id));
      const catalogIds = new Set([...catalogEntityIds, ...catalogFieldIds]);

      // All imported IDs strictly match t_xxxxxxxx and c_xxxxxxxx format
      for (const entId of catalogEntityIds) {
        expect(isValidStableId(entId, 't')).toBe(true);
      }
      for (const fId of catalogFieldIds) {
        expect(isValidStableId(fId, 'c')).toBe(true);
      }

      // Serialize all pages and field configs
      const serializedData = JSON.stringify({
        pages: pagesInDb.rows,
        fieldConfigs: fieldsInDb.rows.map((f) => f.config),
        entityDisplayFields: entitiesInDb.rows.map((e) => e.display_field_id),
      });

      // Find all IDs matching [ct]_[0-9a-f]{8} in the serialized output
      const matches = serializedData.match(/[ct]_[0-9a-f]{8}/g) || [];
      expect(matches.length).toBeGreaterThan(0);

      // Assert that NO old ID remains that is not in the new catalog
      for (const matchedId of matches) {
        expect(catalogIds.has(matchedId)).toBe(true);
      }
      // Specifically assert oldEntityId (which collided) does NOT appear in target tenant's pages or configs
      expect(serializedData).not.toContain(oldEntityId);

      await cleanupTestUser(targetAdmin.userId);
    });

    it('(b) round-trip test: export, import into a fresh tenant, export again, and assert the two bundles are equal after ID normalization', async () => {
      // 1. Export current workspace (tenant)
      const exportRes1 = await server.inject({
        method: 'GET',
        url: '/api/workspace/export',
        headers: builder.headers,
      });
      expect(exportRes1.statusCode).toBe(200);
      const bundle1 = exportRes1.json();

      // 2. Import into a fresh tenant
      const freshTenant = `rt_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(freshTenant, 'Roundtrip Target');
      const freshAdmin = await createTestSession(freshTenant, 'admin', 'rt_admin');

      const importRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: freshAdmin.headers,
        payload: { bundle: bundle1, dryRun: false },
      });
      expect(importRes.statusCode).toBe(200);
      expect(importRes.json().success).toBe(true);

      // 3. Export again from fresh tenant
      const exportRes2 = await server.inject({
        method: 'GET',
        url: '/api/workspace/export',
        headers: freshAdmin.headers,
      });
      expect(exportRes2.statusCode).toBe(200);
      const bundle2 = exportRes2.json();

      // 4. Normalize IDs across both bundles
      function normalizeBundle(b: any) {
        const norm = JSON.parse(JSON.stringify(b));
        norm.entities.sort((x: any, y: any) => x.name.localeCompare(y.name));
        for (const ent of norm.entities) {
          ent.fields.sort((x: any, y: any) => x.name.localeCompare(y.name));
        }
        norm.relations.sort((x: any, y: any) => x.name.localeCompare(y.name));
        norm.pages.sort((x: any, y: any) => x.route.localeCompare(y.route));

        const normMap = new Map<string, string>();
        norm.entities.forEach((ent: any, idx: number) => {
          normMap.set(ent.id, `$entity_${idx}`);
          ent.fields.forEach((f: any, fIdx: number) => {
            normMap.set(f.id, `$field_${idx}_${fIdx}`);
          });
        });
        norm.pages.forEach((p: any, idx: number) => {
          normMap.set(p.id, `$page_${idx}`);
        });

        const normalized = deepWalkRemap(norm, normMap);
        delete normalized.exportedAt;
        return normalized;
      }

      const normalized1 = normalizeBundle(bundle1);
      const normalized2 = normalizeBundle(bundle2);

      expect(normalized2).toEqual(normalized1);

      await cleanupTestUser(freshAdmin.userId);
    });

    it('(c) a contract test that iterates every registered component propsSchema and fails if any prop holding an entity or field ID is not covered by import', () => {
      const componentSchemas: Record<string, any> = {
        stack: StackPropsSchema,
        text: TextPropsSchema,
        button: ButtonPropsSchema,
        table: TablePropsSchema,
        form: FormPropsSchema,
        modal: ModalPropsSchema,
        select: SelectPropsSchema,
        input: InputPropsSchema,
        details: DetailsPropsSchema,
        grid: GridPropsSchema,
        card: CardPropsSchema,
        tabs: TabsPropsSchema,
        stat: StatPropsSchema,
        chart: ChartPropsSchema,
      };

      const oldEntityId = 't_11111111';
      const newEntityId = 't_99999999';
      const oldFieldId = 'c_22222222';
      const newFieldId = 'c_88888888';

      const idMap = new Map<string, string>([
        [oldEntityId, newEntityId],
        [oldFieldId, newFieldId],
      ]);

      // Iterate every registered component's props schema
      for (const [type, schema] of Object.entries(componentSchemas)) {
        const shape = (schema as any).shape || (schema as any)._def?.shape?.() || (schema as any)._def?.schema?.shape;
        if (!shape) continue;

        for (const [propName, propDef] of Object.entries(shape)) {
          const isEntityProp = /entityid/i.test(propName);
          const isFieldProp = /fieldid/i.test(propName);

          if (isEntityProp) {
            const testObj = { [propName]: oldEntityId };
            const remapped = deepWalkRemap(testObj, idMap);
            expect(remapped[propName]).toBe(newEntityId);
          }

          if (isFieldProp) {
            const testObj = { [propName]: oldFieldId };
            const remapped = deepWalkRemap(testObj, idMap);
            expect(remapped[propName]).toBe(newFieldId);
          }
        }
      }

      // Also verify all complex nested structures handled by component schemas
      const complexTestProps: any = {
        entityId: oldEntityId,
        fieldId: oldFieldId,
        groupByFieldId: oldFieldId,
        aggregateFieldId: oldFieldId,
        columns: [{ fieldId: oldFieldId }],
        fields: [{ fieldId: oldFieldId }],
        filter: { [oldFieldId]: 'active' },
        onClick: [
          {
            type: 'deleteRecord',
            params: { entityId: oldEntityId, fieldId: oldFieldId },
          },
        ],
        visibleIf: `{{ row.${oldFieldId} === '${oldEntityId}' }}`,
      };

      const remappedComplex = deepWalkRemap(complexTestProps, idMap);

      expect(remappedComplex.entityId).toBe(newEntityId);
      expect(remappedComplex.fieldId).toBe(newFieldId);
      expect(remappedComplex.groupByFieldId).toBe(newFieldId);
      expect(remappedComplex.aggregateFieldId).toBe(newFieldId);
      expect(remappedComplex.columns[0].fieldId).toBe(newFieldId);
      expect(remappedComplex.fields[0].fieldId).toBe(newFieldId);
      expect(remappedComplex.filter[newFieldId]).toBe('active');
      expect(remappedComplex.onClick[0].params.entityId).toBe(newEntityId);
      expect(remappedComplex.onClick[0].params.fieldId).toBe(newFieldId);
      expect(remappedComplex.visibleIf).toBe(`{{ row.${newFieldId} === '${newEntityId}' }}`);
    });

    it('inside the same transaction, runs validateBindings on every page and rolls back with broken-binding list if any; dryRun reports the same', async () => {
      const testTenant = `val_tx_${crypto.randomBytes(3).toString('hex')}`;
      await migrationService.provisionTenant(testTenant, 'Validation Target');
      const testAdmin = await createTestSession(testTenant, 'admin', 'val_admin');

      const brokenBundle: any = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: 't_' + crypto.randomBytes(4).toString('hex'),
            name: 'custom_entity',
            label: 'Custom Entity',
            fields: [
              {
                id: 'c_' + crypto.randomBytes(4).toString('hex'),
                name: 'title',
                label: 'Title',
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
        pages: [
          {
            id: 'p_broken_page',
            name: 'Broken Page',
            route: '/broken-route',
            draft: {
              schemaVersion: 2,
              id: 'p_broken_page',
              version: 1,
              route: '/broken-route',
              dataSources: [],
              root: {
                id: 'root',
                type: 'stack',
                props: { direction: 'vertical' },
                children: [
                  {
                    id: 'tbl_broken',
                    type: 'table',
                    props: {
                      columns: [{ fieldId: 'c_non_existent_field_id' }],
                      entityId: 't_non_existent_entity_id',
                    },
                  },
                ],
              },
            },
            published: null,
          },
        ],
      };

      // 1. Dry run should report broken bindings and roll back
      const dryRunRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: testAdmin.headers,
        payload: { bundle: brokenBundle, dryRun: true },
      });
      expect(dryRunRes.statusCode).toBe(200);
      const dryRunBody = dryRunRes.json();
      expect(dryRunBody.success).toBe(false);
      expect(dryRunBody.dryRun).toBe(true);
      expect(dryRunBody.conflicts.length).toBeGreaterThan(0);
      expect(
        dryRunBody.conflicts.some(
          (c: string) => c.includes('references missing entity') || c.includes('references missing column')
        )
      ).toBe(true);

      // Verify DB is clean after dryRun
      const dryRunCheck = await pool.query(
        `SELECT count(*)::int AS count FROM public.entity_def WHERE tenant_id = $1`,
        [testTenant]
      );
      expect(dryRunCheck.rows[0].count).toBe(0);

      // 2. Actual import should also detect broken bindings and roll back transaction
      const importRes = await server.inject({
        method: 'POST',
        url: '/api/workspace/import',
        headers: testAdmin.headers,
        payload: { bundle: brokenBundle, dryRun: false },
      });
      expect(importRes.statusCode).toBe(422);
      const importBody = importRes.json();
      expect(importBody.conflicts.length).toBeGreaterThan(0);
      expect(importBody.conflicts.some((c: string) => c.includes('Broken binding'))).toBe(true);

      // Verify DB was rolled back completely (0 entities, 0 pages)
      const afterRollbackEntities = await pool.query(
        `SELECT count(*)::int AS count FROM public.entity_def WHERE tenant_id = $1`,
        [testTenant]
      );
      expect(afterRollbackEntities.rows[0].count).toBe(0);
      const afterRollbackPages = await pool.query(
        `SELECT count(*)::int AS count FROM public.page_def WHERE tenant_id = $1`,
        [testTenant]
      );
      expect(afterRollbackPages.rows[0].count).toBe(0);

      await cleanupTestUser(testAdmin.userId);
    });
  });

  // =========================================================================
  // 5. Metadata Cache Staleness Avoidance Across Multiple Instances
  // =========================================================================
  describe('B.5: Multi-Instance Metadata Cache Concurrency', () => {
    it('verifies two EntityCache instances never serve stale metadata when entity version changes', async () => {
      const cache1 = new EntityCache();
      const cache2 = new EntityCache();

      // Instance 1 loads entity
      const res1 = await cache1.resolveEntity(tenant, 'device', pool);
      expect(res1.entity.name).toBe('device');
      expect(res1.fields.some((f) => f.name === 'serial')).toBe(true);

      // Instance 2 loads entity (both have version 1 cached)
      const res2Initial = await cache2.resolveEntity(tenant, 'device', pool);
      expect(res2Initial.entity.version).toBe(res1.entity.version);

      // Mutate entity metadata (add field) which increments version in DB
      await migrationService.addField(tenant, {
        entityId: baseEntityId,
        name: 'battery_level',
        label: 'Battery Level (%)',
        type: 'number',
        expectedVersion: res1.entity.version,
      });

      // Now query Instance 2 WITHOUT invalidating Instance 2
      // Because resolveEntity cheaply checks version in entity_def on each request,
      // Instance 2 immediately detects the new version and returns fresh metadata!
      const res2Fresh = await cache2.resolveEntity(tenant, 'device', pool);
      expect(res2Fresh.entity.version).toBeGreaterThan(res2Initial.entity.version);
      expect(res2Fresh.fields.some((f) => f.name === 'battery_level')).toBe(true);
    });
  });

  // =========================================================================
  // 6. Migrations on Deploy with Advisory Lock
  // =========================================================================
  describe('B.6: Advisory Lock Catalog Migration Runner', () => {
    it('runs migrations behind advisory lock and records applied migrations idempotently', async () => {
      // Run catalog migrations again
      const runnerRes = await runCatalogMigrations(pool);
      expect(runnerRes.success).toBe(true);

      // Verify public.schema_migrations has recorded migrations
      const migRows = await pool.query('SELECT version, name, applied_at FROM public.schema_migrations ORDER BY version ASC');
      expect(migRows.rows.length).toBeGreaterThanOrEqual(5);

      const versions = migRows.rows.map((r) => r.version);
      expect(versions).toContain(1);
      expect(versions).toContain(2);
      expect(versions).toContain(3);
      expect(versions).toContain(4);
      expect(versions).toContain(5);
    });
  });
});
