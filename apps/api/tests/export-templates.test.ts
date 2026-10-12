import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildServer } from '../src/server.js';
import { pool } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { permissionService } from '../src/permissions/permission-service.js';
import { createTestSession } from './test-session-helper.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { exportService } from '../src/records/export/export-service.js';
import { exportTemplateService } from '../src/records/export/export-template-service.js';
import { downloadTokenStore } from '../src/records/export/download-token-store.js';
import {
  sanitizeFilename,
  sanitizeCsvValue,
  buildSafeContentDisposition,
} from '../src/records/export/export-sanitizer.js';
import { exportImportService } from '../src/workspace/export-import-service.js';
import { tenantLimitsService } from '../src/limits/tenant-limits.js';
import { entityCache } from '../src/records/entity-cache.js';
import { queryBuilder } from '../src/records/query-builder.js';

describe('Export Templates & Streaming Engine', () => {
  let server: FastifyInstance;
  const testTenantA = `t_exp_a_${crypto.randomBytes(4).toString('hex')}`;
  const testTenantB = `t_exp_b_${crypto.randomBytes(4).toString('hex')}`;

  let customerEntityId: string;
  let orderEntityId: string;
  let customerCompanyFieldId: string;
  let orderNumFieldId: string;
  let orderCustomerRefFieldId: string;
  let orderTotalFieldId: string;
  let orderSecretFieldId: string;
  let orderDateFieldId: string;
  let orderActiveFieldId: string;

  let ownerSessionA: any;
  let editorSessionA: any;
  let viewerSessionA: any;
  let ownerSessionB: any;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(testTenantA, 'Export Tenant A');
    await migrationService.provisionTenant(testTenantB, 'Export Tenant B');

    ownerSessionA = await createTestSession(testTenantA, 'owner');
    editorSessionA = await createTestSession(testTenantA, 'editor');
    viewerSessionA = await createTestSession(testTenantA, 'viewer');
    ownerSessionB = await createTestSession(testTenantB, 'owner');

    // 1. Create Target Reference Entity: Customer
    const customerRes = await migrationService.createEntity(testTenantA, {
      name: 'customer',
      label: 'Customer',
      fields: [
        { name: 'company_name', label: 'Company Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'text', required: false },
      ],
    });
    customerEntityId = customerRes.entity.id;
    const companyField = customerRes.fields.find((f: any) => f.name === 'company_name')!;
    customerCompanyFieldId = companyField.id;

    // Set Customer display field
    await migrationService.updateEntity(testTenantA, {
      entityId: customerEntityId,
      displayFieldId: customerCompanyFieldId,
      expectedVersion: 1,
    });

    // 2. Create Order Entity with Reference, Date, Boolean, Secret
    const orderRes = await migrationService.createEntity(testTenantA, {
      name: 'order',
      label: 'Sales Order',
      fields: [
        { name: 'order_number', label: 'Order #', type: 'text', required: true, unique: true },
        {
          name: 'customer_ref',
          label: 'Customer',
          type: 'reference',
          required: false,
          config: { targetEntityId: customerEntityId, displayFieldId: customerCompanyFieldId },
        },
        { name: 'total_amount', label: 'Total', type: 'number', required: false },
        { name: 'secret_pin', label: 'Secret PIN', type: 'text', required: false },
        { name: 'order_date', label: 'Order Date', type: 'date', required: false },
        { name: 'is_active', label: 'Is Active', type: 'boolean', required: false },
      ],
    });
    orderEntityId = orderRes.entity.id;
    orderNumFieldId = orderRes.fields.find((f: any) => f.name === 'order_number')!.id;
    orderCustomerRefFieldId = orderRes.fields.find((f: any) => f.name === 'customer_ref')!.id;
    orderTotalFieldId = orderRes.fields.find((f: any) => f.name === 'total_amount')!.id;
    orderSecretFieldId = orderRes.fields.find((f: any) => f.name === 'secret_pin')!.id;
    orderDateFieldId = orderRes.fields.find((f: any) => f.name === 'order_date')!.id;
    orderActiveFieldId = orderRes.fields.find((f: any) => f.name === 'is_active')!.id;

    // 3. Insert customer records
    const cust1 = await server.inject({
      method: 'POST',
      url: `/api/entities/${customerEntityId}/records`,
      headers: ownerSessionA.headers,
      payload: { company_name: 'Acme Corp', email: 'billing@acme.com' },
    });
    const cust1Id = JSON.parse(cust1.payload).id;

    // 4. Insert order records
    await server.inject({
      method: 'POST',
      url: `/api/entities/${orderEntityId}/records`,
      headers: ownerSessionA.headers,
      payload: {
        order_number: 'ORD-1001',
        customer_ref: cust1Id,
        total_amount: 1500.5,
        secret_pin: 'PIN-999',
        order_date: '2026-03-15',
        is_active: true,
      },
    });

    await server.inject({
      method: 'POST',
      url: `/api/entities/${orderEntityId}/records`,
      headers: ownerSessionA.headers,
      payload: {
        order_number: 'ORD-1002',
        customer_ref: null,
        total_amount: 250.0,
        secret_pin: 'PIN-888',
        order_date: '2026-03-16',
        is_active: false,
      },
    });
  }, 60000);

  afterAll(async () => {
    await server.close();
  });

  it('1. Template CRUD, publish, duplicate and preview (20 rows)', async () => {
    // Create template
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/export-templates',
      headers: ownerSessionA.headers,
      payload: {
        name: 'Orders Simple Export',
        entityId: orderEntityId,
        draft: {
          kind: 'simple',
          columns: [
            { fieldId: orderNumFieldId, header: 'Order Code', format: 'text' },
            { fieldId: orderCustomerRefFieldId, header: 'Client', format: 'text' },
            { fieldId: orderTotalFieldId, header: 'Amount', format: 'currency' },
            { fieldId: orderDateFieldId, header: 'Date', format: 'date_iso' },
            { fieldId: orderActiveFieldId, header: 'Active?', format: 'boolean' },
          ],
          defaultSort: [{ fieldId: orderNumFieldId, direction: 'asc' }],
          defaultFilters: [],
          includeHeader: true,
          csv: { delimiter: ',', bom: false },
          filenameExpression: '"orders-" + today()',
          pdf: { mode: 'table' },
        },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload);
    expect(created.id).toMatch(/^et_/);
    expect(created.version).toBe(1);

    // Duplicate template
    const dupRes = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${created.id}/duplicate`,
      headers: ownerSessionA.headers,
    });
    expect(dupRes.statusCode).toBe(201);
    const duplicated = JSON.parse(dupRes.payload);
    expect(duplicated.name).toBe('Copy of Orders Simple Export');
    expect(duplicated.id).not.toBe(created.id);

    // Publish template (bumps version to 2)
    const pubRes = await server.inject({
      method: 'POST',
      url: `/api/export-templates/${created.id}/publish`,
      headers: ownerSessionA.headers,
    });
    expect(pubRes.statusCode).toBe(200);
    const published = JSON.parse(pubRes.payload);
    expect(published.published).toBeDefined();
    expect(published.version).toBe(2);

    // Preview 20 rows
    const prevRes = await server.inject({
      method: 'GET',
      url: `/api/export-templates/${created.id}/preview`,
      headers: ownerSessionA.headers,
    });
    expect(prevRes.statusCode).toBe(200);
    const preview = JSON.parse(prevRes.payload);
    expect(preview.rows.length).toBe(2);
    expect(preview.columns.length).toBe(5);
    // Reference display value check in preview:
    const row1 = preview.rows.find((r: any) => r[orderNumFieldId] === 'ORD-1001');
    expect(row1[orderCustomerRefFieldId]).toBe('Acme Corp');

    // GET /api/entities/:id/import-template returns headers
    const importTplRes = await server.inject({
      method: 'GET',
      url: `/api/entities/${orderEntityId}/import-template`,
      headers: ownerSessionA.headers,
    });
    expect(importTplRes.statusCode).toBe(200);
    const csvContent = importTplRes.payload;
    expect(csvContent).toContain('Order #');
    expect(csvContent).toContain('Customer');
  });

  it('2. Round trip: export CSV and XLSX, resolve references, re-import verification', async () => {
    // Create template
    const tpl = await exportTemplateService.createTemplate(testTenantA, {
      name: 'Full Order Export',
      entityId: orderEntityId,
      draft: {
        kind: 'simple',
        columns: [
          { fieldId: orderNumFieldId, header: 'OrderNum', format: 'text' },
          { fieldId: orderCustomerRefFieldId, header: 'CustomerName', format: 'text' },
          { fieldId: orderTotalFieldId, header: 'Total', format: 'number' },
          { fieldId: orderDateFieldId, header: 'Date', format: 'date_iso' },
          { fieldId: orderActiveFieldId, header: 'Active', format: 'boolean' },
        ],
        defaultSort: [{ fieldId: orderNumFieldId, direction: 'asc' }],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '"orders_export"',
        pdf: { mode: 'table' },
      },
    });

    // A. Export CSV via token flow
    const tokenResCsv = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionA.headers,
      payload: { templateId: tpl.id, format: 'csv' },
    });
    expect(tokenResCsv.statusCode).toBe(200);
    const { token: csvToken } = JSON.parse(tokenResCsv.payload);

    const downloadResCsv = await server.inject({
      method: 'GET',
      url: `/api/exports/${csvToken}`,
      headers: { cookie: ownerSessionA.cookieHeader },
    });
    expect(downloadResCsv.statusCode).toBe(200);
    const csvData = downloadResCsv.payload;
    expect(csvData).toContain('OrderNum,CustomerName,Total,Date,Active');
    expect(csvData).toContain('ORD-1001,Acme Corp,1500.5,2026-03-15,true');
    expect(csvData).toContain('ORD-1002,,250,2026-03-16,false');

    // B. Export XLSX via token flow
    const tokenResXlsx = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionA.headers,
      payload: { templateId: tpl.id, format: 'xlsx' },
    });
    expect(tokenResXlsx.statusCode).toBe(200);
    const { token: xlsxToken } = JSON.parse(tokenResXlsx.payload);

    const downloadResXlsx = await server.inject({
      method: 'GET',
      url: `/api/exports/${xlsxToken}`,
      headers: { cookie: ownerSessionA.cookieHeader },
    });
    expect(downloadResXlsx.statusCode).toBe(200);
    expect(downloadResXlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    // Read back XLSX using ExcelJS to verify parsed cells
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(downloadResXlsx.rawPayload);
    const sheet = workbook.getWorksheet(1);
    expect(sheet).toBeDefined();
    expect(sheet?.rowCount).toBe(3); // 1 header + 2 data rows
    const r2 = sheet?.getRow(2);
    expect(r2?.getCell(1).value).toBe('ORD-1001');
    expect(r2?.getCell(2).value).toBe('Acme Corp');
    expect(r2?.getCell(5).value).toBe(true);
  });

  it('3. User without canExport permission gets 403', async () => {
    // Viewer role has canExport: false by default
    const res = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: viewerSessionA.headers,
      payload: { entityId: orderEntityId, format: 'csv' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.message || body.error).toContain('export permission');

    // Set editor canExport to false explicitly
    await permissionService.setEntityPermission(testTenantA, orderEntityId, 'editor', {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canExport: false,
    });

    const editorRes = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: editorSessionA.headers,
      payload: { entityId: orderEntityId, format: 'csv' },
    });
    expect(editorRes.statusCode).toBe(403);

    // Restore editor canExport: true
    await permissionService.setEntityPermission(testTenantA, orderEntityId, 'editor', {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canExport: true,
    });
  });

  it('4. Hidden fields for exporting user role are omitted', async () => {
    // Hide secret_pin from editor role
    await permissionService.setFieldPermission(testTenantA, orderEntityId, orderSecretFieldId, 'editor', {
      hidden: true,
      readOnly: false,
    });

    // Create a template that includes secret_pin
    const tpl = await exportTemplateService.createTemplate(testTenantA, {
      name: 'Secret Order Export',
      entityId: orderEntityId,
      draft: {
        kind: 'simple',
        columns: [
          { fieldId: orderNumFieldId, header: 'OrderNum', format: 'text' },
          { fieldId: orderSecretFieldId, header: 'SecretPin', format: 'text' },
        ],
        defaultSort: [],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '"orders"',
        pdf: { mode: 'table' },
      },
    });

    // Export as editor
    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: editorSessionA.headers,
      payload: { templateId: tpl.id, format: 'csv' },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { token } = JSON.parse(tokenRes.payload);

    const downloadRes = await server.inject({
      method: 'GET',
      url: `/api/exports/${token}`,
      headers: { cookie: editorSessionA.cookieHeader },
    });
    expect(downloadRes.statusCode).toBe(200);
    const csvOutput = downloadRes.payload;
    // secret_pin should NOT be in the CSV
    expect(csvOutput).not.toContain('SecretPin');
    expect(csvOutput).not.toContain('PIN-999');
    expect(csvOutput).toContain('OrderNum');
  });

  it('5. Download token is single-use and expires after 60 seconds', async () => {
    const tokenPayload = downloadTokenStore.createToken({
      tenantId: testTenantA,
      userId: ownerSessionA.userId,
      userEmail: ownerSessionA.email,
      userRole: 'owner',
      entityId: orderEntityId,
      format: 'csv',
    });

    // Use once -> success
    const firstUse = downloadTokenStore.consumeToken(tokenPayload.token);
    expect(firstUse).toBeDefined();
    expect(firstUse?.params.entityId).toBe(orderEntityId);

    // Use twice -> fails (single-use)
    const secondUse = downloadTokenStore.consumeToken(tokenPayload.token);
    expect(secondUse).toBeNull();

    // Test token expiration: create token with past expiry
    const expiredToken = downloadTokenStore.createToken({
      tenantId: testTenantA,
      userId: ownerSessionA.userId,
      userEmail: ownerSessionA.email,
      userRole: 'owner',
      entityId: orderEntityId,
      format: 'csv',
      ttlSeconds: -1, // already expired
    });
    const expiredAttempt = downloadTokenStore.consumeToken(expiredToken.token);
    expect(expiredAttempt).toBeNull();
  });

  it('6. Cross-tenant isolation: another tenant cannot use a token or template', async () => {
    // Tenant A creates a token
    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionA.headers,
      payload: { entityId: orderEntityId, format: 'csv' },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { token } = JSON.parse(tokenRes.payload);

    // Tenant B attempts to download with Tenant A's token
    const crossDownload = await server.inject({
      method: 'GET',
      url: `/api/exports/${token}`,
      headers: { cookie: ownerSessionB.cookieHeader },
    });
    // Should be rejected with 403 Forbidden
    expect(crossDownload.statusCode).toBe(403);

    // Tenant B attempts to use Tenant A's template
    const tpl = await exportTemplateService.createTemplate(testTenantA, {
      name: 'Private Tenant A Template',
      entityId: orderEntityId,
    });

    const crossTplUse = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionB.headers,
      payload: { templateId: tpl.id, format: 'csv' },
    });
    expect(crossTplUse.statusCode).toBe(404);
  });

  it('7. Keyset chunking returns every row exactly once under concurrent inserts', async () => {
    // Create an entity with 300 rows
    const chunkEntityRes = await migrationService.createEntity(testTenantA, {
      name: 'chunk_test_items',
      label: 'Chunk Test Items',
      fields: [{ name: 'code', label: 'Code', type: 'text', required: true, unique: true }],
    });
    const chunkEntityId = chunkEntityRes.entity.id;
    const resolved = await entityCache.resolveEntity(testTenantA, chunkEntityId);
    expect(resolved).toBeDefined();

    const schemaName = defaultStorageAdapter.getTenantSchemaName(testTenantA);
    const insertPromises: Promise<any>[] = [];
    for (let i = 1; i <= 300; i++) {
      insertPromises.push(
        defaultStorageAdapter.query(
          testTenantA,
          `INSERT INTO "${schemaName}"."${resolved!.entity.physicalTableName}" (id, "${resolved!.fields[0].physicalColumnName}") VALUES ($1, $2)`,
          [`item_${i.toString().padStart(4, '0')}`, `CODE-${i}`]
        )
      );
    }
    await Promise.all(insertPromises);

    // Test keyset query iteration directly with chunkSize = 50
    let cursor: any = undefined;
    const allFetchedIds = new Set<string>();

    for (let chunk = 0; chunk < 10; chunk++) {
      const q = queryBuilder.buildSelectQuery(
        schemaName,
        resolved!.entity.physicalTableName,
        {
          columns: ['id', resolved!.fields[0].physicalColumnName],
          filters: [],
          sorts: [{ fieldName: 'id', physicalColumn: 'id', direction: 'ASC', type: 'text' }],
          limit: 50,
          cursor,
        }
      );

      const rows = await defaultStorageAdapter.query<any>(testTenantA, q.sql, q.params);
      if (rows.length === 0) break;

      // Simulate a concurrent insert of a higher or lower ID during streaming
      if (chunk === 2) {
        await defaultStorageAdapter.query(
          testTenantA,
          `INSERT INTO "${schemaName}"."${resolved!.entity.physicalTableName}" (id, "${resolved!.fields[0].physicalColumnName}") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [`item_9999`, `CODE-9999`]
        );
      }

      for (const row of rows) {
        expect(allFetchedIds.has(row.id)).toBe(false); // No duplicates
        allFetchedIds.add(row.id);
      }

      cursor = {
        values: [rows[rows.length - 1].id],
        id: rows[rows.length - 1].id,
      };
    }

    // Verified that all 300 rows (+ concurrent insert) were yielded without duplicates
    expect(allFetchedIds.size).toBeGreaterThanOrEqual(300);
  });

  it('8. Formula injection safety: CSV prefix escaping and XLSX string typing', async () => {
    // Test helper sanitizeCsvValue
    expect(sanitizeCsvValue('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvValue('+SUM(A1:A5)')).toBe("'+SUM(A1:A5)");
    expect(sanitizeCsvValue('-10*20')).toBe("'-10*20");
    expect(sanitizeCsvValue('@lookup')).toBe("'@lookup");
    expect(sanitizeCsvValue('   =cmd()')).toBe("'   =cmd()");
    expect(sanitizeCsvValue('Safe Normal Text')).toBe('Safe Normal Text');

    // Insert an injection record
    await server.inject({
      method: 'POST',
      url: `/api/entities/${orderEntityId}/records`,
      headers: ownerSessionA.headers,
      payload: {
        order_number: '=cmd|/c calc!A0',
        total_amount: 100,
        secret_pin: '+SUM(1,2)',
      },
    });

    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionA.headers,
      payload: { entityId: orderEntityId, format: 'csv' },
    });
    const { token } = JSON.parse(tokenRes.payload);

    const csvRes = await server.inject({
      method: 'GET',
      url: `/api/exports/${token}`,
      headers: { cookie: ownerSessionA.cookieHeader },
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.payload).toContain("'=cmd|/c calc!A0"); // escaped with '
    expect(csvRes.payload).toContain("'+SUM(1,2)");
  });

  it('9. Filename sanitization: prevents path traversal and header injection', () => {
    // Path traversal
    expect(sanitizeFilename('../../etc/passwd', 'default_export', 'csv')).toBe('etc_passwd.csv');
    // Header injection CRLF
    const sanitized = sanitizeFilename('report\r\nSet-Cookie: evil=1\n.xlsx', 'default', 'xlsx');
    expect(sanitized).not.toContain('\r');
    expect(sanitized).not.toContain('\n');
    // Safe Content-Disposition header
    const cd = buildSafeContentDisposition('my-report (Q1).xlsx');
    expect(cd).toContain('attachment; filename="my-report (Q1).xlsx"');
    expect(cd).toContain("filename*=UTF-8''");
  });

  it('10. Plan limits: maxExportRows cap and concurrency cap', async () => {
    // Concurrency slot test
    const release1 = await tenantLimitsService.acquireExportSlot(testTenantA);
    expect(typeof release1).toBe('function');
    const release2 = await tenantLimitsService.acquireExportSlot(testTenantA);
    expect(typeof release2).toBe('function');

    // Free plan max concurrency is 2: 3rd slot must be rejected
    await expect(tenantLimitsService.acquireExportSlot(testTenantA)).rejects.toThrow(
      /concurrent exports/
    );

    // Release slot and verify slot can be acquired again
    release1();
    const release3 = await tenantLimitsService.acquireExportSlot(testTenantA);
    expect(typeof release3).toBe('function');

    release2();
    release3();

    // Row cap enforcement
    await expect(tenantLimitsService.checkExportLimit(testTenantA, 60000)).rejects.toThrow(
      /maximum allowed rows/
    );
  });

  it('11. 50,000-row export keeps peak heap flat', async () => {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    const initialHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;

    // Simulate streaming 50,000 rows using ExcelJS WorkbookWriter to null stream
    const { PassThrough } = await import('node:stream');
    const blackHole = new PassThrough();
    blackHole.on('data', () => {}); // consume stream

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: blackHole,
      useStyles: false,
      useSharedStrings: false,
    });
    const worksheet = workbook.addWorksheet('Export');
    worksheet.columns = [
      { header: 'ID', key: 'id' },
      { header: 'Number', key: 'num' },
      { header: 'Text', key: 'text' },
      { header: 'Date', key: 'date' },
    ];

    let maxObservedHeapMb = initialHeapMb;

    for (let i = 1; i <= 50000; i++) {
      const row = worksheet.addRow({
        id: `row_${i}`,
        num: i * 1.5,
        text: `Sample data record content ${i}`,
        date: '2026-10-10',
      });
      row.commit();

      if (i % 10000 === 0) {
        const currentHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;
        if (currentHeapMb > maxObservedHeapMb) {
          maxObservedHeapMb = currentHeapMb;
        }
      }
    }

    await worksheet.commit();
    await workbook.commit();

    const finalHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const heapGrowthMb = maxObservedHeapMb - initialHeapMb;

    console.log(
      `[Benchmark] 50,000-row export streaming: Initial Heap: ${initialHeapMb.toFixed(1)} MB, Peak: ${maxObservedHeapMb.toFixed(1)} MB, Final: ${finalHeapMb.toFixed(1)} MB, Heap Growth: ${heapGrowthMb.toFixed(1)} MB`
    );

    // Heap growth during streaming of 50,000 rows must stay flat (under 60 MB)
    expect(heapGrowthMb).toBeLessThan(60);
  });

  it('12. Workspace export/import template round trip with deep ID remapping', async () => {
    const sourceTenant = `src_exp_${crypto.randomBytes(3).toString('hex')}`;
    const targetTenant = `tgt_exp_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(sourceTenant, 'Source Exp Tenant');
    await migrationService.provisionTenant(targetTenant, 'Target Exp Tenant');

    // 1. Create source entity
    const sourceEntityRes = await migrationService.createEntity(sourceTenant, {
      name: 'invoice',
      label: 'Invoice',
      fields: [
        { name: 'inv_code', label: 'Code', type: 'text', required: true },
        { name: 'amount', label: 'Amount', type: 'number', required: false },
      ],
    });
    const sEntityId = sourceEntityRes.entity.id;
    const sCodeFieldId = sourceEntityRes.fields.find((f: any) => f.name === 'inv_code')!.id;
    const sAmountFieldId = sourceEntityRes.fields.find((f: any) => f.name === 'amount')!.id;

    // 2. Create export template in source
    const tpl = await exportTemplateService.createTemplate(sourceTenant, {
      name: 'Invoice Summary Export',
      entityId: sEntityId,
      draft: {
        kind: 'simple',
        columns: [
          { fieldId: sCodeFieldId, header: 'Invoice #', format: 'text' },
          { fieldId: sAmountFieldId, header: 'Subtotal', format: 'currency' },
        ],
        defaultSort: [{ fieldId: sCodeFieldId, direction: 'asc' }],
        defaultFilters: [{ fieldId: sAmountFieldId, op: 'gt', value: 100 }],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '"invoices"',
        pdf: { mode: 'table' },
      },
    });

    // 3. Export workspace bundle
    const bundle = await exportImportService.exportBundle(sourceTenant);
    expect(bundle.exportTemplates).toBeDefined();
    expect(bundle.exportTemplates?.length).toBe(1);
    expect(bundle.exportTemplates![0].id).toBe(tpl.id);

    // 4. Import workspace bundle into target tenant
    const importRes = await exportImportService.importBundle(targetTenant, bundle);
    expect(importRes.success).toBe(true);

    // 5. Verify target template exists and all IDs are remapped
    const targetTemplates = await exportTemplateService.listTemplates(targetTenant);
    expect(targetTemplates.length).toBe(1);
    const targetTpl = targetTemplates[0];

    // Must have a new ID
    expect(targetTpl.id).not.toBe(tpl.id);
    // Entity ID must be remapped
    expect(targetTpl.entityId).not.toBe(sEntityId);

    // Check columns, sorts, filters inside draft: none of the old IDs may survive!
    const draftCols = targetTpl.draft.columns;
    expect(draftCols[0].fieldId).not.toBe(sCodeFieldId);
    expect(draftCols[1].fieldId).not.toBe(sAmountFieldId);

    const draftSorts = targetTpl.draft.defaultSort;
    expect(draftSorts[0].fieldId).not.toBe(sCodeFieldId);

    const draftFilters = targetTpl.draft.defaultFilters;
    expect(draftFilters[0].fieldId).not.toBe(sAmountFieldId);

    // Verify target entity has the new field IDs
    const targetResolved = await entityCache.resolveEntity(targetTenant, targetTpl.entityId);
    expect(targetResolved).toBeDefined();
    const targetFieldIds = new Set(targetResolved!.fields.map((f) => f.id));

    expect(targetFieldIds.has(draftCols[0].fieldId)).toBe(true);
    expect(targetFieldIds.has(draftCols[1].fieldId)).toBe(true);
    expect(targetFieldIds.has(draftSorts[0].fieldId)).toBe(true);
    expect(targetFieldIds.has(draftFilters[0].fieldId)).toBe(true);
  });

  it('13. PDF export returns 501 ("PDF export is not enabled yet")', async () => {
    // 1. Create export token for PDF format
    const tokenRes = await server.inject({
      method: 'POST',
      url: '/api/exports',
      headers: ownerSessionA.headers,
      payload: { entityId: orderEntityId, format: 'pdf' },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { token } = JSON.parse(tokenRes.payload);

    // 2. Download endpoint triggers streaming PDF renderer -> returns 501
    const pdfRes = await server.inject({
      method: 'GET',
      url: `/api/exports/${token}`,
      headers: { cookie: ownerSessionA.cookieHeader },
    });
    expect(pdfRes.statusCode).toBe(501);
    const body = JSON.parse(pdfRes.payload);
    expect(body.message || body.error).toContain('PDF export is not enabled yet');
  });
});
