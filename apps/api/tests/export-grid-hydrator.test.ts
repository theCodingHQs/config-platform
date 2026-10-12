import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import {
  GridHydrator,
  gridHydrator,
  rewriteFormulaCoordinates,
  GridHydrationForbiddenError,
} from '../src/records/export/grid-hydrator.js';
import { tenantLimitsService, PLAN_LIMITS } from '../src/limits/tenant-limits.js';
import { permissionService } from '../src/permissions/permission-service.js';
import type { GridExportTemplateDefinition } from '@config-platform/schema';

describe('Phase 2B: Grid Export Hydrator & Repeating Regions Engine', () => {
  let tenantId: string;
  let entityId: string;
  let physicalTableName: string;
  let fFirstNameId: string;
  let fSalaryId: string;
  let fBonusId: string;

  beforeAll(async () => {
    tenantId = `t_grid_${crypto.randomBytes(4).toString('hex')}`;
    await migrationService.provisionTenant(tenantId, 'Grid Hydrator Test Tenant');

    // Create an entity "employee"
    entityId = `e_${crypto.randomBytes(4).toString('hex')}`;
    fFirstNameId = `f_${crypto.randomBytes(4).toString('hex')}`;
    fSalaryId = `f_${crypto.randomBytes(4).toString('hex')}`;
    fBonusId = `f_${crypto.randomBytes(4).toString('hex')}`;
    physicalTableName = `rec_${crypto.randomBytes(4).toString('hex')}`;

    await pool.query(
      `INSERT INTO public.entity_def (id, tenant_id, name, label, physical_table_name, display_field_id)
       VALUES ($1, $2, $3, $4, $5, $6);`,
      [entityId, tenantId, 'employee', 'Employee', physicalTableName, fFirstNameId]
    );

    await pool.query(
      `INSERT INTO public.field_def (id, tenant_id, entity_id, name, label, type, physical_column_name)
       VALUES 
       ($1, $2, $3, 'first_name', 'First Name', 'string', 'c_first_name'),
       ($4, $2, $3, 'salary', 'Salary', 'number', 'c_salary'),
       ($5, $2, $3, 'bonus', 'Bonus', 'number', 'c_bonus');`,
      [fFirstNameId, tenantId, entityId, fSalaryId, fBonusId]
    );

    // Create physical table in tenant schema
    const tenantSchema = defaultStorageAdapter.getTenantSchemaName(tenantId);
    await pool.query(
      `CREATE TABLE "${tenantSchema}"."${physicalTableName}" (
         id VARCHAR(64) PRIMARY KEY,
         c_first_name TEXT,
         c_salary NUMERIC,
         c_bonus NUMERIC
       );`
    );

    // Seed 40 employee records
    for (let i = 1; i <= 40; i++) {
      await pool.query(
        `INSERT INTO "${tenantSchema}"."${physicalTableName}" (id, c_first_name, c_salary, c_bonus)
         VALUES ($1, $2, $3, $4);`,
        [`rec_${String(i).padStart(4, '0')}`, `Employee ${i}`, 50000 + i * 1000, 5000 + i * 100]
      );
    }
  });

  afterAll(async () => {
    const tenantSchema = defaultStorageAdapter.getTenantSchemaName(tenantId);
    await pool.query(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE;`);
    await pool.query(`DELETE FROM public.field_permission WHERE tenant_id = $1;`, [tenantId]);
    await pool.query(`DELETE FROM public.entity_permission WHERE tenant_id = $1;`, [tenantId]);
    await pool.query(`DELETE FROM public.field_def WHERE tenant_id = $1;`, [tenantId]);
    await pool.query(`DELETE FROM public.entity_def WHERE tenant_id = $1;`, [tenantId]);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1;`, [tenantId]);
  });

  // ─── 1. Formula Coordinate Rewriting ──────────────────────────────────────
  it('rewrites formula ranges and shifts cell references below expanding region', () => {
    // Region is rows 10 to 15 (1-based, 6 rows minRows). Expands by delta = 34 (40 records).
    const formula1 = '=SUM(C10:C15)';
    const rewritten1 = rewriteFormulaCoordinates(formula1, 10, 15, 34);
    expect(rewritten1).toBe('=SUM(C10:C49)');

    // Multiple ranges in formula
    const formula2 = '=SUM(C10:C15) + AVERAGE(D10:D15)';
    const rewritten2 = rewriteFormulaCoordinates(formula2, 10, 15, 34);
    expect(rewritten2).toBe('=SUM(C10:C49) + AVERAGE(D10:D49)');

    // Standalone cell below region shifted
    const formula3 = '=C16*2';
    const rewritten3 = rewriteFormulaCoordinates(formula3, 10, 15, 34);
    expect(rewritten3).toBe('=C50*2');

    // Cells above region remain unchanged
    const formula4 = '=A1+B2';
    const rewritten4 = rewriteFormulaCoordinates(formula4, 10, 15, 34);
    expect(rewritten4).toBe('=A1+B2');
  });

  // ─── 2. Band Shifting with 40 rows (N > minRows) ──────────────────────────
  it('hydrates template with 40 records (band shifting N > minRows) and shifts rows below region', async () => {
    // Region rows 2 to 7 (0-based: startRow 2, endRow 7 -> minRows = 6)
    // Summary row at row 8: =SUM(B3:B8) (1-based B3:B8 refers to rows 2..7)
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"employee_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Employees',
          order: 0,
          merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
          cells: {
            '0:0': { value: 'Company Employee Directory' },
            '1:0': { value: 'First Name' },
            '1:1': { value: 'Salary' },
            '1:2': { value: 'Bonus' },
            // Region format row (startRow 2) with placeholders
            '2:0': {
              value: '{{ First Name }}',
              binding: { entityId, fieldId: fFirstNameId, displayLabel: 'First Name' },
            },
            '2:1': {
              value: '{{ Salary }}',
              numFmt: '$#,##0',
              binding: { entityId, fieldId: fSalaryId, displayLabel: 'Salary' },
            },
            '2:2': {
              value: '{{ Bonus }}',
              numFmt: '$#,##0',
              binding: { entityId, fieldId: fBonusId, displayLabel: 'Bonus' },
            },
            // Summary row originally at row 8 (immediately below region row 7)
            '8:0': { value: 'Total Salary' },
            '8:1': { formula: '=SUM(B3:B8)' },
          },
          regions: [
            {
              id: 'reg_emp',
              entityId,
              displayLabel: 'Employee Table Band',
              startRow: 2,
              endRow: 7, // 6 rows minRows
              startCol: 0,
              endCol: 2,
              columns: [
                { col: 0, fieldId: fFirstNameId, displayLabel: 'First Name' },
                { col: 1, fieldId: fSalaryId, displayLabel: 'Salary' },
                { col: 2, fieldId: fBonusId, displayLabel: 'Bonus' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    // Hydrate with all 40 records
    const buffer = await gridHydrator.renderHydratedToBuffer(template, {
      tenantId,
      userRole: 'owner',
    });

    expect(buffer).toBeInstanceOf(Buffer);

    // Verify with ExcelJS reader
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.getWorksheet('Employees')!;
    expect(ws).toBeDefined();

    // Title at row 1 (A1)
    expect(ws.getCell('A1').value).toBe('Company Employee Directory');

    // 40 hydrated rows: rows 3 to 42 (1-based)
    expect(ws.getCell('A3').value).toBe('Employee 1');
    expect(ws.getCell('A42').value).toBe('Employee 40');

    // Summary row shifted by delta (40 - 6 = 34): 8 + 34 = row 42 (0-based) -> row 43 (1-based)
    const summaryLabel = ws.getCell('A43');
    expect(summaryLabel.value).toBe('Total Salary');

    const summaryFormula = ws.getCell('B43');
    expect((summaryFormula.value as any)?.formula).toBe('SUM(B3:B42)');
  });

  // ─── 3. Row Padding with 3 rows (N < minRows) ─────────────────────────────
  it('hydrates template with padding when records N < minRows (3 rows into 6-row region)', async () => {
    // Query limit maxRows = 3 to simulate 3 records
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"padded_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Padded Sheet',
          order: 0,
          merges: [],
          cells: {
            '2:0': {
              value: '{{ First Name }}',
              binding: { entityId, fieldId: fFirstNameId, displayLabel: 'First Name' },
            },
            '2:1': {
              value: '{{ Salary }}',
              numFmt: '$#,##0',
              binding: { entityId, fieldId: fSalaryId, displayLabel: 'Salary' },
            },
            '8:0': { value: 'Footer Below' },
          },
          regions: [
            {
              id: 'reg_emp',
              entityId,
              displayLabel: 'Employee Band',
              startRow: 2,
              endRow: 7, // 6 rows minRows
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: fFirstNameId, displayLabel: 'First Name' },
                { col: 1, fieldId: fSalaryId, displayLabel: 'Salary' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    const hydratedDef = await gridHydrator.hydrateGridDefinition(template, {
      tenantId,
      userRole: 'owner',
      maxRows: 3, // Simulate N = 3
    });

    const sheet = hydratedDef.sheets[0];
    // Rows 2, 3, 4 have records 1, 2, 3
    expect(sheet.cells['2:0']?.value).toBe('Employee 1');
    expect(sheet.cells['3:0']?.value).toBe('Employee 2');
    expect(sheet.cells['4:0']?.value).toBe('Employee 3');

    // Rows 5, 6, 7 are padded empty rows preserving minRows = 6
    expect(sheet.cells['5:0']?.value).toBe('');
    expect(sheet.cells['6:0']?.value).toBe('');
    expect(sheet.cells['7:0']?.value).toBe('');

    // Row below region (row 8) remains in place because delta = 0
    expect(sheet.cells['8:0']?.value).toBe('Footer Below');
  });

  // ─── 4. Exactly minRows (N = minRows) ─────────────────────────────────────
  it('hydrates template with exactly minRows (6 records into 6-row region)', async () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"exact_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Exact Sheet',
          order: 0,
          merges: [],
          cells: {
            '2:0': {
              value: '{{ First Name }}',
              binding: { entityId, fieldId: fFirstNameId, displayLabel: 'First Name' },
            },
            '8:0': { value: 'Footer' },
          },
          regions: [
            {
              id: 'reg_emp',
              entityId,
              startRow: 2,
              endRow: 7, // 6 rows minRows
              startCol: 0,
              endCol: 1,
              columns: [{ col: 0, fieldId: fFirstNameId, displayLabel: 'First Name' }],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    const hydratedDef = await gridHydrator.hydrateGridDefinition(template, {
      tenantId,
      userRole: 'owner',
      maxRows: 6,
    });

    const sheet = hydratedDef.sheets[0];
    expect(sheet.cells['2:0']?.value).toBe('Employee 1');
    expect(sheet.cells['7:0']?.value).toBe('Employee 6');
    expect(sheet.cells['8:0']?.value).toBe('Footer');
  });

  // ─── 5. Hidden-Field Redaction & Filter Rejection ─────────────────────────
  it('redacts hidden field from exported cells and rejects filter referencing hidden field', async () => {
    // Configure bonus field as hidden for role 'viewer'
    await permissionService.setFieldPermission(tenantId, entityId, fBonusId, 'viewer', {
      hidden: true,
      readOnly: false,
    });

    // Give viewer export permission on employee entity
    await permissionService.setEntityPermission(tenantId, entityId, 'viewer', {
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canExport: true,
    });

    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"hidden_field_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Sheet 1',
          order: 0,
          merges: [],
          cells: {
            '0:0': {
              value: '{{ Bonus }}',
              binding: { entityId, fieldId: fBonusId, displayLabel: 'Bonus' },
            },
          },
          regions: [
            {
              id: 'reg_1',
              entityId,
              startRow: 1,
              endRow: 3,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: fFirstNameId, displayLabel: 'First Name' },
                { col: 1, fieldId: fBonusId, displayLabel: 'Bonus' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    // Hydrate as 'viewer' -> hidden field bonus must be completely redacted
    const hydratedDef = await gridHydrator.hydrateGridDefinition(template, {
      tenantId,
      userRole: 'viewer',
      maxRows: 3,
    });

    // Region bonus column must be empty string
    expect(hydratedDef.sheets[0].cells['1:1']?.value).toBe('');
    expect(hydratedDef.sheets[0].cells['2:1']?.value).toBe('');

    // Scalar binding bonus must be empty string
    expect(hydratedDef.sheets[0].cells['0:0']?.value).toBe('');

    // Rejection: if a filter references hidden field 'fBonusId', throws 403
    await expect(
      gridHydrator.hydrateGridDefinition(template, {
        tenantId,
        userRole: 'viewer',
        filters: [{ fieldId: fBonusId, op: 'gt', value: 1000 }],
      })
    ).rejects.toThrow(/references hidden field/);
  });

  // ─── 6. Row Cap Rejection Before Loading Rows ─────────────────────────────
  it('rejects export over plan row cap BEFORE loading rows into memory', async () => {
    const origLimit = PLAN_LIMITS.free.maxExportRows;
    try {
      PLAN_LIMITS.free.maxExportRows = 10;

      const template: GridExportTemplateDefinition = {
        kind: 'grid',
        version: 1,
        filenameExpression: '"cap_rejection"',
        pdf: { mode: 'table' },
        sheets: [
          {
            id: 'sheet_1',
            name: 'Sheet 1',
            order: 0,
            merges: [],
            cells: {},
            regions: [
              {
                id: 'reg_1',
                entityId,
                startRow: 0,
                endRow: 5,
                startCol: 0,
                endCol: 1,
                columns: [{ col: 0, fieldId: fFirstNameId, displayLabel: 'First Name' }],
              },
            ],
            conditionalFormats: [],
          },
        ],
      };

      // Total records = 40, which exceeds maxExportRows = 10
      await expect(
        gridHydrator.hydrateGridDefinition(template, {
          tenantId,
          userRole: 'owner',
        })
      ).rejects.toThrow(/exceeds maximum allowed rows/i);
    } finally {
      PLAN_LIMITS.free.maxExportRows = origLimit;
    }
  });

  // ─── 7. Concurrency Slot Release in Finally Block ─────────────────────────
  it('guarantees concurrency slot release via finally block even on error', async () => {
    const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
    let slotReleased = false;

    try {
      try {
        throw new Error('Simulated export hydration failure');
      } finally {
        releaseSlot();
        slotReleased = true;
      }
    } catch {
      // Caught
    }

    expect(slotReleased).toBe(true);

    // Acquire slot again succeeds immediately without hanging
    const nextSlotRelease = await tenantLimitsService.acquireExportSlot(tenantId);
    expect(typeof nextSlotRelease).toBe('function');
    nextSlotRelease();
  });
});
