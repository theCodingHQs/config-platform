import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ALLOWED_ENTITY_ICONS,
  AllowedIconNameSchema,
  isAllowedIcon,
  CreateEntityInputSchema,
  UpdateEntityInputSchema,
  EntityDefSchema,
} from '@config-platform/schema';
import { catalogMigrations, runCatalogMigrations } from '../src/db/catalog-migration-runner.js';
import { exportImportService, type WorkspaceBundle } from '../src/workspace/export-import-service.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { pagesService } from '../src/pages/pages-service.js';
import { pool } from '../src/db/pool.js';

describe('Entity Icons, Migration 10 & Export/Import Policy', () => {
  it('confirms the icon column came from a NEW migration 10 (010_entity_def_icon)', () => {
    const migration10 = catalogMigrations.find((m) => m.version === 10);
    expect(migration10).toBeDefined();
    expect(migration10?.name).toBe('010_entity_def_icon');

    // Confirm versions are strictly sequential
    const versions = catalogMigrations.map((m) => m.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('validates entity.icon against allowed curated icons with Zod on create', () => {
    // Valid icons
    expect(
      CreateEntityInputSchema.safeParse({
        name: 'customer',
        label: 'Customer',
        icon: 'User',
      }).success
    ).toBe(true);

    expect(
      CreateEntityInputSchema.safeParse({
        name: 'orders',
        label: 'Orders',
        icon: 'ShoppingCart',
      }).success
    ).toBe(true);

    expect(
      CreateEntityInputSchema.safeParse({
        name: 'invoice',
        label: 'Invoice',
        icon: null,
      }).success
    ).toBe(true);

    expect(
      CreateEntityInputSchema.safeParse({
        name: 'items',
        label: 'Items',
      }).success
    ).toBe(true);

    // Invalid icon names
    const invalidName = CreateEntityInputSchema.safeParse({
      name: 'bad_icon',
      label: 'Bad Icon',
      icon: 'NonExistentIconXYZ',
    });
    expect(invalidName.success).toBe(false);

    const scriptInjection = CreateEntityInputSchema.safeParse({
      name: 'hacker',
      label: 'Hacker',
      icon: '<script>alert(1)</script>',
    });
    expect(scriptInjection.success).toBe(false);
  });

  it('validates entity.icon against allowed curated icons with Zod on update', () => {
    const validUpdate = UpdateEntityInputSchema.safeParse({
      entityId: 't_test1234',
      expectedVersion: 1,
      icon: 'Building2',
    });
    expect(validUpdate.success).toBe(true);

    const invalidUpdate = UpdateEntityInputSchema.safeParse({
      entityId: 't_test1234',
      expectedVersion: 1,
      icon: 'RandomIconDoesNotExist',
    });
    expect(invalidUpdate.success).toBe(false);
  });

  describe('ALLOWED_ENTITY_ICONS append-only policy', () => {
    // Pinned baseline snapshot of the 78 allowed icon names
    const PINNED_ALLOWED_ENTITY_ICONS = [
      'User',
      'Users',
      'UserCheck',
      'Contact',
      'Briefcase',
      'ShoppingCart',
      'ShoppingBag',
      'Package',
      'CreditCard',
      'DollarSign',
      'Receipt',
      'Tag',
      'Building2',
      'Building',
      'Warehouse',
      'Store',
      'MapPin',
      'Globe',
      'Home',
      'Map',
      'Navigation',
      'FileText',
      'Folder',
      'ClipboardList',
      'Database',
      'Layers',
      'Table',
      'Book',
      'Bookmark',
      'File',
      'Inbox',
      'Calendar',
      'Clock',
      'Truck',
      'Shield',
      'Settings',
      'HeartPulse',
      'Lock',
      'Key',
      'Server',
      'Cpu',
      'Terminal',
      'Radio',
      'Wifi',
      'Activity',
      'Zap',
      'Mail',
      'Phone',
      'MessageSquare',
      'Send',
      'Share2',
      'Camera',
      'Image',
      'Video',
      'Music',
      'Volume2',
      'Tv',
      'CheckSquare',
      'Link',
      'Code',
      'Type',
      'Hash',
      'Award',
      'Star',
      'Heart',
      'Gift',
      'Flag',
      'Filter',
      'Search',
      'Download',
      'Eye',
      'Compass',
      'Laptop',
      'Smartphone',
      'Printer',
      'Box',
      'Grid',
      'List',
      'Circle',
      'ThumbsUp',
      'Wrench',
      'Trash2',
      'Info',
      'HelpCircle',
    ];

    it('pins the current list of allowed icon names and fails if any existing name disappears or is renamed', () => {
      const currentIcons = new Set<string>(ALLOWED_ENTITY_ICONS);
      const missingIcons = PINNED_ALLOWED_ENTITY_ICONS.filter((name) => !currentIcons.has(name));

      expect(
        missingIcons,
        `ALLOWED_ENTITY_ICONS is append-only: names may be added, never removed or renamed. Missing: ${missingIcons.join(', ')}`
      ).toEqual([]);
      expect(ALLOWED_ENTITY_ICONS.length).toBeGreaterThanOrEqual(PINNED_ALLOWED_ENTITY_ICONS.length);
    });

    it('fails if any existing pinned name is simulated as missing', () => {
      const simulatedMissingSet = new Set(
        ALLOWED_ENTITY_ICONS.filter((name) => name !== 'Building2' && name !== 'User')
      );
      const missing = PINNED_ALLOWED_ENTITY_ICONS.filter((name) => !simulatedMissingSet.has(name as any));
      expect(missing).toEqual(['User', 'Building2']);
    });
  });

  it('validates EntityDefSchema allows stored icon values while write schemas strictly reject invalid names', () => {
    // Write schemas strictly reject unknown icon names:
    expect(
      CreateEntityInputSchema.safeParse({
        name: 'vendor',
        label: 'Vendor',
        icon: 'FakeIcon',
      }).success
    ).toBe(false);

    // Stored entity definitions allow string icons so loading existing entities never throws:
    const loadedDef = EntityDefSchema.safeParse({
      id: 't_12345678',
      tenantId: 'cust_abc123',
      name: 'vendor',
      label: 'Vendor',
      physicalTableName: 'tbl_vendor',
      version: 1,
      icon: 'FakeIcon',
    });
    expect(loadedDef.success).toBe(true);
  });

  describe('Workspace Export/Import with entity.icon', () => {
    let testTenantId: string;

    beforeAll(async () => {
      testTenantId = `cust_icon_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(testTenantId, 'Icon Test Tenant');
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM public.field_def WHERE tenant_id = $1`, [testTenantId]);
      await pool.query(`DELETE FROM public.entity_def WHERE tenant_id = $1`, [testTenantId]);
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [testTenantId]);
    });

    it('rejects workspace import if any entity contains an invalid icon name', async () => {
      const bundle: WorkspaceBundle = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: 't_badicon1',
            name: 'product_invalid',
            label: 'Product Invalid',
            icon: 'DisallowedIcon999',
            fields: [
              {
                id: 'c_field001',
                name: 'title',
                label: 'Title',
                type: 'text',
                required: false,
                isUnique: false,
                position: 1,
                config: {},
              },
            ],
          },
        ],
        relations: [],
        pages: [],
      };

      const result = await exportImportService.importBundle(testTenantId, bundle, true);
      expect(result.success).toBe(false);
      expect(result.conflicts.some((c) => c.includes('Invalid entity icon') && c.includes('DisallowedIcon999'))).toBe(true);
    });

    it('exports entity icon and correctly imports entity icon into database', async () => {
      const importTenantId = `cust_import_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(importTenantId, 'Import Target Tenant');

      try {
        const bundle: WorkspaceBundle = {
          bundleVersion: 1,
          exportedAt: new Date().toISOString(),
          entities: [
            {
              id: 't_goods001',
              name: 'goods',
              label: 'Goods',
              icon: 'Package',
              fields: [
                {
                  id: 'c_goods001',
                  name: 'sku',
                  label: 'SKU',
                  type: 'text',
                  required: true,
                  isUnique: false,
                  position: 1,
                  config: {},
                },
              ],
            },
          ],
          relations: [],
          pages: [],
        };

        const result = await exportImportService.importBundle(importTenantId, bundle, false);
        expect(result.success).toBe(true);

        // Verify entity_def in DB has the icon column populated
        const dbRes = await pool.query<{ icon: string }>(
          `SELECT icon FROM public.entity_def WHERE tenant_id = $1 AND name = $2`,
          [importTenantId, 'goods']
        );
        expect(dbRes.rows.length).toBe(1);
        expect(dbRes.rows[0].icon).toBe('Package');

        // Verify exportBundle preserves the icon
        const exported = await exportImportService.exportBundle(importTenantId);
        const goodsExported = exported.entities.find((e) => e.name === 'goods');
        expect(goodsExported).toBeDefined();
        expect(goodsExported?.icon).toBe('Package');
      } finally {
        await pool.query(`DELETE FROM public.field_def WHERE tenant_id = $1`, [importTenantId]);
        await pool.query(`DELETE FROM public.entity_def WHERE tenant_id = $1`, [importTenantId]);
        await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [importTenantId]);
      }
    });
  });

  describe('Migration 010 Upgrade Test', () => {
    let upgradeTenantId: string;

    beforeAll(async () => {
      upgradeTenantId = `cust_upg_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(upgradeTenantId, 'Upgrade Test Tenant');
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM public.field_def WHERE tenant_id = $1`, [upgradeTenantId]);
      await pool.query(`DELETE FROM public.entity_def WHERE tenant_id = $1`, [upgradeTenantId]);
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [upgradeTenantId]);
    });

    it('upgrade test: database at migration 009 with an entity -> run migrations -> entity intact, icon column present and null', async () => {
      // 1. Simulate DB at migration 009:
      // Drop the icon column if present and remove version >= 10 from schema_migrations
      await pool.query(`ALTER TABLE public.entity_def DROP COLUMN IF EXISTS icon;`);
      await pool.query(`DELETE FROM public.schema_migrations WHERE version >= 10;`);

      // Verify icon column is NOT present in entity_def
      const colCheckBefore = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'entity_def' AND column_name = 'icon'`
      );
      expect(colCheckBefore.rows.length).toBe(0);

      // Verify schema_migrations has version <= 9
      const migCheckBefore = await pool.query<{ max_ver: number }>(
        `SELECT COALESCE(MAX(version), 0) as max_ver FROM public.schema_migrations`
      );
      expect(migCheckBefore.rows[0].max_ver).toBeLessThanOrEqual(9);

      // 2. Insert an entity while at migration 009 (without icon column)
      const testEntityId = `t_legacy_${crypto.randomBytes(4).toString('hex')}`;
      await pool.query(
        `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, version, display_field_id)
         VALUES ($1, $2, $3, $4, $5, 1, null)`,
        [testEntityId, upgradeTenantId, 'legacy_device', 'Legacy Device', 't_legacy_device']
      );

      // 3. Run catalog migrations to upgrade from 009 to 010
      const reports = await runCatalogMigrations();
      const m10Report = reports.find((r) => r.version === 10);
      expect(m10Report).toBeDefined();
      expect(m10Report?.name).toBe('010_entity_def_icon');

      // 4. Verify version 10 is recorded in schema_migrations
      const migCheckAfter = await pool.query<{ version: number; name: string }>(
        `SELECT version, name FROM public.schema_migrations WHERE version = 10`
      );
      expect(migCheckAfter.rows.length).toBe(1);
      expect(migCheckAfter.rows[0].name).toBe('010_entity_def_icon');

      // 5. Verify icon column is present in entity_def
      const colCheckAfter = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'entity_def' AND column_name = 'icon'`
      );
      expect(colCheckAfter.rows.length).toBe(1);
      expect(colCheckAfter.rows[0].column_name).toBe('icon');

      // 6. Verify entity is intact and icon column is null for pre-existing entity
      const entityCheck = await pool.query<{ id: string; name: string; label: string; icon: string | null }>(
        `SELECT id, name, label, icon FROM public.entity_def WHERE id = $1`,
        [testEntityId]
      );
      expect(entityCheck.rows.length).toBe(1);
      expect(entityCheck.rows[0].name).toBe('legacy_device');
      expect(entityCheck.rows[0].label).toBe('Legacy Device');
      expect(entityCheck.rows[0].icon).toBeNull();
    });
  });

  describe('Form field icons schema validation', () => {
    let testTenantId: string;

    beforeAll(async () => {
      testTenantId = `cust_ff_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(testTenantId, 'Form Icon Test Tenant');
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM public.page_def WHERE tenant_id = $1`, [testTenantId]);
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [testTenantId]);
    });

    it('rejects an unknown form field icon name on page save', async () => {
      const pageDraft = {
        schemaVersion: 2,
        id: 'p_test_form_bad_icon',
        version: 1,
        route: '/test-form-bad-icon',
        root: {
          id: 'root_form',
          type: 'form' as const,
          props: {
            entityId: 't_dummy',
            fields: [
              {
                fieldId: 'f_title',
                label: 'Title',
                icon: 'UnknownCrazyIcon999',
              },
            ],
          },
        },
      };

      await expect(
        pagesService.createPage(testTenantId, {
          name: 'Bad Icon Page',
          route: '/test-form-bad-icon',
          draft: pageDraft as any,
        })
      ).rejects.toThrow(/Invalid form field icon 'UnknownCrazyIcon999'/);
    });

    it('rejects an unknown form field icon name on workspace import', async () => {
      const bundle: WorkspaceBundle = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        entities: [],
        relations: [],
        pages: [
          {
            id: 'p_import_bad_icon',
            name: 'Import Bad Icon',
            route: '/import-bad-icon',
            draft: {
              schemaVersion: 2,
              id: 'p_import_bad_icon',
              version: 1,
              route: '/import-bad-icon',
              root: {
                id: 'root_form',
                type: 'form' as const,
                props: {
                  entityId: 't_dummy',
                  fields: [
                    {
                      fieldId: 'f_amount',
                      icon: 'BogusIconXYZ',
                    },
                  ],
                },
              },
            },
            published: null,
          },
        ],
      };

      const result = await exportImportService.importBundle(testTenantId, bundle, true);
      expect(result.success).toBe(false);
      expect(
        result.conflicts.some(
          (c) => c.includes('Invalid form field icon') && c.includes('BogusIconXYZ')
        )
      ).toBe(true);
    });

    it('loading a stored page containing an unknown form field icon never throws', async () => {
      const legacyPageId = `p_legacy_${crypto.randomBytes(4).toString('hex')}`;
      const storedDraft = {
        schemaVersion: 2,
        id: legacyPageId,
        version: 1,
        route: `/legacy-form-${legacyPageId}`,
        state: {},
        dataSources: [],
        root: {
          id: 'root_form',
          type: 'form' as const,
          props: {
            entityId: 't_dummy',
            fields: [
              {
                fieldId: 'f_legacy',
                label: 'Legacy Field',
                icon: 'UnknownStoredIcon123',
              },
            ],
          },
        },
      };

      // Insert directly into database to simulate a previously saved/stored page
      await pool.query(
        `INSERT INTO public.page_def (id, tenant_id, name, route, draft, published, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, 1, NOW(), NOW())`,
        [legacyPageId, testTenantId, 'Legacy Stored Page', `/legacy-form-${legacyPageId}`, JSON.stringify(storedDraft)]
      );

      // Loading the stored page via pagesService.getPage must never throw
      const pageDetail = await pagesService.getPage(testTenantId, legacyPageId);
      expect(pageDetail).toBeDefined();
      expect(pageDetail.draft.root.props?.fields[0].icon).toBe('UnknownStoredIcon123');

      // Loading published pages list must never throw
      const published = await pagesService.listPublishedPages(testTenantId);
      const found = published.find((p) => p.id === legacyPageId);
      expect(found).toBeDefined();
      expect(found?.root.props?.fields[0].icon).toBe('UnknownStoredIcon123');
    });
  });
});
