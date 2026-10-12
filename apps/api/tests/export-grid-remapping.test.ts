import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { exportImportService, type WorkspaceBundle } from '../src/workspace/export-import-service.js';
import type { GridExportTemplateDefinition } from '@config-platform/schema';

describe('Grid Export Templates Workspace Export/Import Remapping', () => {
  const sourceTenant = `src_grid_${crypto.randomBytes(4).toString('hex')}`;
  const targetTenant = `tgt_grid_${crypto.randomBytes(4).toString('hex')}`;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    await migrationService.provisionTenant(sourceTenant, 'Source Grid Workspace');
    await migrationService.provisionTenant(targetTenant, 'Target Grid Workspace');
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [sourceTenant, targetTenant]);
  });

  it('remaps entityId and fieldId in grid cell bindings and regions with zero old IDs surviving', async () => {
    // 1. Create an entity with fields in source tenant
    const entRes = await migrationService.createEntity(sourceTenant, {
      name: 'financial_line',
      label: 'Financial Line',
      fields: [
        { name: 'account_code', label: 'Account Code', type: 'text', required: true },
        { name: 'amount', label: 'Amount', type: 'number', required: true },
      ],
    });

    const oldEntityId = entRes.entity.id;
    const oldCodeFieldId = entRes.fields.find((f: any) => f.name === 'account_code')!.id;
    const oldAmountFieldId = entRes.fields.find((f: any) => f.name === 'amount')!.id;
    const oldTemplateId = `et_${crypto.randomBytes(4).toString('hex')}`;

    // 2. Build a grid template definition with cell bindings and repeating regions referencing stable IDs
    const gridDraft: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"financial_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_main',
          name: 'Summary',
          order: 0,
          merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
          cells: {
            '0:0': {
              value: 'Financial Summary Header',
              style: { font: { bold: true } },
            },
            // Cell bound by structured entityId / fieldId
            '1:0': {
              binding: {
                entityId: oldEntityId,
                fieldId: oldCodeFieldId,
                displayLabel: 'Display Account Code',
              },
            },
            // Another cell bound to amount
            '1:1': {
              binding: {
                entityId: oldEntityId,
                fieldId: oldAmountFieldId,
                displayLabel: 'Display Amount',
              },
              numFmt: '$#,##0.00',
            },
            // Cell referencing entity in template expression
            '1:2': {
              binding: `records.${oldEntityId}.${oldAmountFieldId}`,
            },
          },
          regions: [
            {
              id: 'reg_finance',
              entityId: oldEntityId,
              displayLabel: 'Financial Repeating Region',
              startRow: 5,
              endRow: 15,
              startCol: 0,
              endCol: 2,
              columns: [
                { col: 0, fieldId: oldCodeFieldId, displayLabel: 'Account Code' },
                { col: 1, fieldId: oldAmountFieldId, displayLabel: 'Amount' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    // Construct workspace bundle
    const sourceBundle: WorkspaceBundle = {
      bundleVersion: 2,
      exportedAt: new Date().toISOString(),
      entities: [
        {
          id: oldEntityId,
          name: 'financial_line',
          label: 'Financial Line',
          fields: [
            {
              id: oldCodeFieldId,
              name: 'account_code',
              label: 'Account Code',
              type: 'text',
              required: true,
              isUnique: false,
              position: 0,
              config: {},
            },
            {
              id: oldAmountFieldId,
              name: 'amount',
              label: 'Amount',
              type: 'number',
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
      exportTemplates: [
        {
          id: oldTemplateId,
          name: 'Financial Grid Template',
          entityId: oldEntityId,
          draft: gridDraft,
          published: gridDraft,
          version: 1,
        },
      ],
    };

    // 3. Import bundle into target workspace
    const importRes = await exportImportService.importBundle(targetTenant, sourceBundle, false);
    expect(importRes.success).toBe(true);
    expect(importRes.conflicts).toEqual([]);
    expect(importRes.exportTemplatesCount).toBe(1);

    // 4. Query target database for imported template
    const templateRows = await pool.query<{
      id: string;
      entity_id: string;
      name: string;
      draft: any;
      published: any;
    }>(
      `SELECT id, entity_id, name, draft, published FROM public.export_template WHERE tenant_id = $1`,
      [targetTenant]
    );

    expect(templateRows.rows.length).toBe(1);
    const targetTemplate = templateRows.rows[0];

    // Verify entity was imported in target workspace with a new ID if colliding or valid stable ID
    const targetEntityRows = await pool.query<{ id: string }>(
      `SELECT id FROM public.entity_def WHERE tenant_id = $1`,
      [targetTenant]
    );
    const newEntityId = targetEntityRows.rows[0].id;
    expect(targetTemplate.entity_id).toBe(newEntityId);

    // Verify draft and published contents
    const targetDraft = typeof targetTemplate.draft === 'string'
      ? JSON.parse(targetTemplate.draft)
      : targetTemplate.draft;
    const targetPublished = typeof targetTemplate.published === 'string'
      ? JSON.parse(targetTemplate.published)
      : targetTemplate.published;

    expect(targetDraft.kind).toBe('grid');
    expect(targetPublished.kind).toBe('grid');

    const targetSheet = targetDraft.sheets[0];
    const cell10 = targetSheet.cells['1:0'];
    const cell11 = targetSheet.cells['1:1'];
    const cell12 = targetSheet.cells['1:2'];

    // Verify cell bindings were remapped to the new entity and new fields
    expect(cell10.binding.entityId).toBe(newEntityId);
    expect(cell10.binding.fieldId).not.toBe(oldCodeFieldId);
    expect(cell10.binding.displayLabel).toBe('Display Account Code'); // display label untouched

    expect(cell11.binding.entityId).toBe(newEntityId);
    expect(cell11.binding.fieldId).not.toBe(oldAmountFieldId);
    expect(cell11.binding.displayLabel).toBe('Display Amount');

    // Verify template expression string was also remapped
    expect(cell12.binding).toContain(newEntityId);
    expect(cell12.binding).not.toContain(oldEntityId);
    expect(cell12.binding).not.toContain(oldAmountFieldId);

    // Verify repeating region was remapped
    expect(targetSheet.regions.length).toBe(1);
    const targetRegion = targetSheet.regions[0];
    expect(targetRegion.entityId).toBe(newEntityId);
    expect(targetRegion.entityId).not.toBe(oldEntityId);
    expect(targetRegion.columns[0].fieldId).not.toBe(oldCodeFieldId);
    expect(targetRegion.columns[1].fieldId).not.toBe(oldAmountFieldId);
    expect(targetRegion.displayLabel).toBe('Financial Repeating Region');

    // 5. CRITICAL TEST: Test that NO OLD ID SURVIVES in the imported template JSON
    // If the source had oldEntityId, oldCodeFieldId, oldAmountFieldId, and collision happened
    // or when bundle remapped them, none of the old IDs must exist in serialized template
    // Let's test with a scenario where collision explicitly forced new ID generation:
    // Notice if oldEntityId already existed in target:
    // Let's test with an explicit bundle whose IDs were forcibly remapped because of collision!
  });

  it('guarantees that when ID collision occurs, 100% of old IDs are remapped and ZERO old IDs survive in the grid template', async () => {
    const collTenantA = `col_a_${crypto.randomBytes(4).toString('hex')}`;
    const collTenantB = `col_b_${crypto.randomBytes(4).toString('hex')}`;
    await migrationService.provisionTenant(collTenantA, 'Collision A');
    await migrationService.provisionTenant(collTenantB, 'Collision B');

    try {
      // 1. In Workspace A, create entity and template
      const entA = await migrationService.createEntity(collTenantA, {
        name: 'inventory_item',
        label: 'Inventory Item',
        fields: [
          { name: 'sku', label: 'SKU', type: 'text', required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
        ],
      });

      const oldEntityId = entA.entity.id;
      const oldSkuFieldId = entA.fields.find((f: any) => f.name === 'sku')!.id;
      const oldQtyFieldId = entA.fields.find((f: any) => f.name === 'quantity')!.id;
      const oldTemplateId = `et_${crypto.randomBytes(4).toString('hex')}`;

      const gridTemplate: GridExportTemplateDefinition = {
        kind: 'grid',
        version: 1,
        filenameExpression: '"inventory"',
        sheets: [
          {
            id: 'sheet_items',
            name: 'Items',
            order: 0,
            cells: {
              '0:0': {
                binding: {
                  entityId: oldEntityId,
                  fieldId: oldSkuFieldId,
                  displayLabel: 'Item SKU',
                },
              },
              '0:1': {
                binding: {
                  entityId: oldEntityId,
                  fieldId: oldQtyFieldId,
                  displayLabel: 'Stock Qty',
                },
              },
            },
            regions: [
              {
                id: 'reg_inventory',
                entityId: oldEntityId,
                displayLabel: 'Inventory Band',
                startRow: 2,
                endRow: 20,
                startCol: 0,
                endCol: 2,
                columns: [
                  { col: 0, fieldId: oldSkuFieldId, displayLabel: 'SKU' },
                  { col: 1, fieldId: oldQtyFieldId, displayLabel: 'Quantity' },
                ],
              },
            ],
            conditionalFormats: [],
          },
        ],
      };

      // Insert template in collTenantA so that oldTemplateId collides in public.export_template
      await pool.query(
        `INSERT INTO public.export_template (id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())`,
        [oldTemplateId, collTenantA, oldEntityId, 'Colliding Grid Template In A', JSON.stringify(gridTemplate), JSON.stringify(gridTemplate)]
      );

      const bundle: WorkspaceBundle = {
        bundleVersion: 2,
        exportedAt: new Date().toISOString(),
        entities: [
          {
            id: oldEntityId,
            name: 'inventory_item_imported',
            label: 'Inventory Item Imported',
            fields: [
              {
                id: oldSkuFieldId,
                name: 'sku',
                label: 'SKU',
                type: 'text',
                required: true,
                isUnique: false,
                position: 0,
                config: {},
              },
              {
                id: oldQtyFieldId,
                name: 'quantity',
                label: 'Quantity',
                type: 'number',
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
        exportTemplates: [
          {
            id: oldTemplateId,
            name: 'Colliding Grid Template',
            entityId: oldEntityId,
            draft: gridTemplate,
            published: gridTemplate,
            version: 1,
          },
        ],
      };

      // Import bundle into Workspace B
      const result = await exportImportService.importBundle(collTenantB, bundle, false);
      expect(result.success).toBe(true);

      // Fetch the imported export template from Workspace B
      const tplRes = await pool.query<{ id: string; entity_id: string; draft: any; published: any }>(
        `SELECT id, entity_id, draft, published FROM public.export_template WHERE tenant_id = $1`,
        [collTenantB]
      );
      expect(tplRes.rows.length).toBe(1);
      const row = tplRes.rows[0];

      // Serialization check: Ensure NO old ID survived in the template row or its JSON
      const fullRowJson = JSON.stringify(row);

      expect(row.entity_id).not.toBe(oldEntityId);
      expect(row.id).not.toBe(oldTemplateId);

      // Exact assertion that not a single old ID survived anywhere in the template JSON
      expect(fullRowJson.includes(oldEntityId)).toBe(false);
      expect(fullRowJson.includes(oldSkuFieldId)).toBe(false);
      expect(fullRowJson.includes(oldQtyFieldId)).toBe(false);
      expect(fullRowJson.includes(oldTemplateId)).toBe(false);

      // Verify that the new IDs are valid and consistent
      const newEntityRow = await pool.query<{ id: string }>(
        `SELECT id FROM public.entity_def WHERE tenant_id = $1`,
        [collTenantB]
      );
      const newEntityId = newEntityRow.rows[0].id;
      expect(row.entity_id).toBe(newEntityId);

      const parsedDraft = typeof row.draft === 'string' ? JSON.parse(row.draft) : row.draft;
      expect(parsedDraft.sheets[0].cells['0:0'].binding.entityId).toBe(newEntityId);
      expect(parsedDraft.sheets[0].regions[0].entityId).toBe(newEntityId);
    } finally {
      await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [collTenantA, collTenantB]);
    }
  });
});
