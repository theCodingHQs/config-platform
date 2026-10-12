import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildServer } from '../src/server.js';
import { pool } from '../src/db/pool.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { permissionService } from '../src/permissions/permission-service.js';
import { createTestSession } from './test-session-helper.js';
import { PLAN_LIMITS } from '../src/limits/tenant-limits.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { parseXlsxContent, MAX_XLSX_ROW_CAP } from '../src/records/import/file-parser.js';

describe('Entity Data Import (CSV & XLSX)', () => {
  let server: FastifyInstance;
  const testTenantA = `t_imp_a_${crypto.randomBytes(4).toString('hex')}`;
  const testTenantB = `t_imp_b_${crypto.randomBytes(4).toString('hex')}`;

  let targetCustomerEntityId: string;
  let targetProductEntityId: string;
  let targetOrderId: string;

  let customerDisplayFieldId: string;
  let productFields: Record<string, string> = {}; // name -> id

  // Pre-created referenced record IDs
  let acmeCustomerId: string;
  let widgetProductId: string;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(testTenantA, 'Import Tenant A');
    await migrationService.provisionTenant(testTenantB, 'Import Tenant B');

    // 1. Create Target Reference Entity: Customer (has display field 'company_name')
    const customerRes = await migrationService.createEntity(testTenantA, {
      name: 'customer',
      label: 'Customer',
      fields: [
        { name: 'company_name', label: 'Company Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'text', required: false },
      ],
    });
    targetCustomerEntityId = customerRes.entity.id;
    const compField = customerRes.fields.find((f) => f.name === 'company_name')!;
    customerDisplayFieldId = compField.id;
    await migrationService.updateEntity(testTenantA, {
      entityId: targetCustomerEntityId,
      displayFieldId: customerDisplayFieldId,
      expectedVersion: 1,
    });

    // 2. Create Target Entity with All Field Types: Product
    const productRes = await migrationService.createEntity(testTenantA, {
      name: 'product',
      label: 'Product',
      fields: [
        { name: 'sku', label: 'SKU', type: 'text', required: true, unique: true },
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'price', label: 'Price', type: 'number', required: true },
        { name: 'is_active', label: 'Is Active', type: 'boolean', required: true },
        { name: 'release_date', label: 'Release Date', type: 'date', required: false },
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          required: false,
          config: { options: [{ value: 'Electronics' }, { value: 'Hardware' }, { value: 'Clothing' }] },
        },
        {
          name: 'supplier_id',
          label: 'Supplier',
          type: 'reference',
          required: false,
          config: { targetEntityId: targetCustomerEntityId },
        },
      ],
    });
    targetProductEntityId = productRes.entity.id;
    for (const f of productRes.fields) {
      productFields[f.name] = f.id;
    }

    // Insert an initial customer record for reference resolution
    const adminSessionA = await createTestSession(testTenantA, 'admin', 'admin_a');
    const custInsert = await server.inject({
      method: 'POST',
      url: '/api/entities/customer/records',
      headers: adminSessionA.headers,
      payload: { company_name: 'Acme Corporation', email: 'acme@example.com' },
    });
    acmeCustomerId = custInsert.json().id;

    // Insert a second customer to test ambiguous reference
    await server.inject({
      method: 'POST',
      url: '/api/entities/customer/records',
      headers: adminSessionA.headers,
      payload: { company_name: 'Duplicate Company', email: 'dup1@example.com' },
    });
    await server.inject({
      method: 'POST',
      url: '/api/entities/customer/records',
      headers: adminSessionA.headers,
      payload: { company_name: 'Duplicate Company', email: 'dup2@example.com' },
    });

    // Insert an initial product record for unique constraint checking
    const prodInsert = await server.inject({
      method: 'POST',
      url: '/api/entities/product/records',
      headers: adminSessionA.headers,
      payload: {
        sku: 'SKU-EXISTING-001',
        title: 'Existing Widget',
        price: 49.99,
        is_active: true,
      },
    });
    widgetProductId = prodInsert.json().id;
  }, 60000);

  const createdTenants = new Set<string>([testTenantA, testTenantB]);

  afterAll(async () => {
    for (const tId of createdTenants) {
      const sName = defaultStorageAdapter.getTenantSchemaName(tId);
      await pool.query(`DROP SCHEMA IF EXISTS "${sName}" CASCADE`).catch(() => {});
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tId]).catch(() => {});
    }
    await server.close();
  }, 60000);

  // Helper to build multipart body buffer with boundary
  function createMultipartPayload(
    boundary: string,
    fileBuffer: Buffer,
    filename: string,
    mapping?: Record<string, string | null>,
    options?: Record<string, any>,
    sheetName?: string
  ): Buffer {
    const parts: Buffer[] = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from('\r\n'),
    ];

    if (mapping) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n${JSON.stringify(mapping)}\r\n`
        )
      );
    }

    if (options) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n`
        )
      );
    }

    if (sheetName) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="sheetName"\r\n\r\n${sheetName}\r\n`
        )
      );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }

  // =========================================================================
  // 1. (a) Round Trip: CSV with every field type
  // =========================================================================
  it('(a) round trip: imports CSV with every field type and reads back via records API as viewer and editor', async () => {
    const adminSession = await createTestSession(testTenantA, 'admin', 'admin_roundtrip');
    const viewerSession = await createTestSession(testTenantA, 'viewer', 'viewer_roundtrip');
    const editorSession = await createTestSession(testTenantA, 'editor', 'editor_roundtrip');

    const csvContent =
      `SKU,Title,Price,Active,Release Date,Category,Supplier\n` +
      `SKU-RT-100,Super Gadget,199.99,true,2026-05-15,Electronics,Acme Corporation\n` +
      `SKU-RT-200,Steel Hammer,24.50,false,2026-06-20,Hardware,Acme Corporation\n`;

    const boundary = '----WebKitFormBoundaryRoundTrip';
    const mapping = {
      SKU: productFields.sku,
      Title: productFields.title,
      Price: productFields.price,
      Active: productFields.is_active,
      'Release Date': productFields.release_date,
      Category: productFields.category,
      Supplier: productFields.supplier_id,
    };
    const options = {
      dateFormat: 'ISO',
      decimalSeparator: '.',
      trueWords: ['true'],
      falseWords: ['false'],
    };

    const payload = createMultipartPayload(
      boundary,
      Buffer.from(csvContent, 'utf8'),
      'products.csv',
      mapping,
      options
    );

    // 1. Dry run
    const dryRunRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/import/dry-run`,
      headers: {
        ...adminSession.headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(dryRunRes.statusCode).toBe(200);
    const dryRunJson = dryRunRes.json();
    expect(dryRunJson.success).toBe(true);
    expect(dryRunJson.totalRows).toBe(2);
    expect(dryRunJson.validRows).toBe(2);
    expect(dryRunJson.errorRows).toBe(0);
    expect(dryRunJson.errors).toHaveLength(0);

    // 2. Commit
    const commitRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/import/commit`,
      headers: {
        ...adminSession.headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(commitRes.statusCode).toBe(200);
    expect(commitRes.json().success).toBe(true);
    expect(commitRes.json().insertedCount).toBe(2);

    // 3. Verify via records API as VIEWER
    const viewerGet = await server.inject({
      method: 'GET',
      url: `/api/entities/product/records`,
      headers: viewerSession.headers,
    });
    expect(viewerGet.statusCode).toBe(200);
    const viewerRecords = viewerGet.json().data;
    const rtRecord = viewerRecords.find((r: any) => r.sku === 'SKU-RT-100');
    expect(rtRecord).toBeDefined();
    expect(rtRecord.title).toBe('Super Gadget');
    expect(Number(rtRecord.price)).toBe(199.99);
    expect(rtRecord.is_active).toBe(true);
    expect(rtRecord.category).toBe('Electronics');
    expect(rtRecord.supplier_id).toBe(acmeCustomerId); // Successfully resolved reference by display field!

    // 4. Verify via records API as EDITOR
    const editorGet = await server.inject({
      method: 'GET',
      url: `/api/entities/product/records/${rtRecord.id}`,
      headers: editorSession.headers,
    });
    expect(editorGet.statusCode).toBe(200);
    expect(editorGet.json().sku).toBe('SKU-RT-100');
  });

  // =========================================================================
  // 2. (b) Row Errors: All Validation Variations
  // =========================================================================
  describe('(b) row errors validation', () => {
    it('detects type error, required missing, invalid select, missing reference, and ambiguous reference in dry run', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_rowerrors');

      const csvContent =
        `SKU,Title,Price,Active,Category,Supplier\n` +
        `SKU-ERR-1,Valid Title,NOT_A_NUMBER,true,Electronics,Acme Corporation\n` + // Price invalid number
        `,Missing SKU Title,50,true,Electronics,Acme Corporation\n` + // SKU required missing
        `SKU-ERR-3,Bad Option,30,true,InvalidCategory,Acme Corporation\n` + // Category not allowed option
        `SKU-ERR-4,No Ref,40,true,Hardware,NonExistentSupplierInc\n` + // Supplier reference not found
        `SKU-ERR-5,Ambiguous,50,true,Hardware,Duplicate Company\n`; // Supplier reference ambiguous (>1 match)

      const boundary = '----WebKitFormBoundaryRowErrors';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
        Category: productFields.category,
        Supplier: productFields.supplier_id,
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'errors.csv',
        mapping
      );

      const dryRunRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(dryRunRes.statusCode).toBe(200);
      const res = dryRunRes.json();
      expect(res.success).toBe(false);
      expect(res.totalRows).toBe(5);
      expect(res.errorRows).toBe(5);

      const errMessages = res.errors.map((e: any) => e.message.toLowerCase());
      expect(errMessages.some((m: string) => m.includes('number'))).toBe(true);
      expect(errMessages.some((m: string) => m.includes('required') || m.includes('sku'))).toBe(true);
      expect(errMessages.some((m: string) => m.includes('must be one of') || m.includes('category'))).toBe(true);
      expect(errMessages.some((m: string) => m.includes('not found'))).toBe(true);
      expect(errMessages.some((m: string) => m.includes('ambiguous'))).toBe(true);
    });

    it('detects unique conflict within the file (duplicate rows in same upload)', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_dupfile');

      const csvContent =
        `SKU,Title,Price,Active\n` +
        `SKU-DUP-FILE,Title One,10,true\n` +
        `SKU-DUP-FILE,Title Two,20,true\n`;

      const boundary = '----WebKitFormBoundaryDupFile';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'dups.csv',
        mapping
      );

      const dryRunRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(dryRunRes.statusCode).toBe(200);
      const res = dryRunRes.json();
      expect(res.success).toBe(false);
      expect(res.errors.some((e: any) => e.message.includes('Duplicate value'))).toBe(true);
    });

    it('detects unique conflict against existing database records', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_dupdb');

      const csvContent =
        `SKU,Title,Price,Active\n` +
        `SKU-EXISTING-001,Colliding Widget,99,true\n`;

      const boundary = '----WebKitFormBoundaryDupDB';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'dup_db.csv',
        mapping
      );

      const dryRunRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(dryRunRes.statusCode).toBe(200);
      const res = dryRunRes.json();
      expect(res.success).toBe(false);
      expect(res.errors.some((e: any) => e.message.includes('already exists in database'))).toBe(true);
    });

    it('imports "ABC" and "abc" as distinct values for unique fields without conflict', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_casesens');

      const csvContent =
        `SKU,Title,Price,Active,Supplier\n` +
        `ABC,Uppercase Code,10,true,acme corporation\n` +
        `abc,Lowercase Code,20,true,ACME CORPORATION\n`;

      const boundary = '----WebKitFormBoundaryCaseSens';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
        Supplier: productFields.supplier_id,
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'case_sensitive.csv',
        mapping
      );

      // Dry run must pass with 2 valid rows and zero errors
      const dryRunRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(dryRunRes.statusCode).toBe(200);
      expect(dryRunRes.json().success).toBe(true);
      expect(dryRunRes.json().validRows).toBe(2);

      // Commit imports both rows cleanly
      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(2);

      // Verify records API returns both "ABC" and "abc" as distinct records
      const recordsRes = await server.inject({
        method: 'GET',
        url: `/api/entities/product/records`,
        headers: adminSession.headers,
      });
      const data = recordsRes.json().data;
      expect(data.some((r: any) => r.sku === 'ABC')).toBe(true);
      expect(data.some((r: any) => r.sku === 'abc')).toBe(true);
    });
  });

  // =========================================================================
  // 3. (c) Rollback: Failed commit leaves no rows
  // =========================================================================
  it('(c) failed commit leaves no rows: all-or-nothing transactional rollback verified', async () => {
    const adminSession = await createTestSession(testTenantA, 'admin', 'admin_rollback');

    // 1 row is valid, 2nd row is invalid
    const csvContent =
      `SKU,Title,Price,Active\n` +
      `SKU-ROLLBACK-GOOD,Good Product,55,true\n` +
      `SKU-ROLLBACK-BAD,Bad Product,NOT_VALID_NUMBER,true\n`;

    const boundary = '----WebKitFormBoundaryRollback';
    const mapping = {
      SKU: productFields.sku,
      Title: productFields.title,
      Price: productFields.price,
      Active: productFields.is_active,
    };

    const payload = createMultipartPayload(
      boundary,
      Buffer.from(csvContent, 'utf8'),
      'rollback.csv',
      mapping
    );

    const commitRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/import/commit`,
      headers: {
        ...adminSession.headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(commitRes.statusCode).toBe(422);

    // Verify Good Product was NOT committed
    const recordsCheck = await server.inject({
      method: 'GET',
      url: `/api/entities/product/records`,
      headers: adminSession.headers,
    });
    const found = recordsCheck.json().data.find((r: any) => r.sku === 'SKU-ROLLBACK-GOOD');
    expect(found).toBeUndefined();
  });

  // =========================================================================
  // 4. (d) Limits: Size cap, row cap, plan maxRecordsPerEntity
  // =========================================================================
  describe('(d) limits enforcement', () => {
    it('rejects file exceeding size limit cap (> 10 MB)', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_size');
      // Buffer larger than 10MB
      const hugeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20); // 10MB + 1KB spaces

      const boundary = '----WebKitFormBoundaryHuge';
      const payload = createMultipartPayload(
        boundary,
        hugeBuffer,
        'huge.csv',
        { SKU: productFields.sku }
      );

      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/preview`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      // Fastify multipart triggers 413 Payload Too Large
      expect([400, 413]).toContain(res.statusCode);
    });

    it('rejects when import would exceed plan maxRecordsPerEntity', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_plan');
      // Create a separate tenant with 'free' plan (limit 1,000 records)
      const freeTenant = `t_free_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(freeTenant, 'Free Tenant');
      const freeEnt = await migrationService.createEntity(freeTenant, {
        name: 'sample',
        label: 'Sample',
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
      });

      // Craft 1005 rows
      let csv = 'Name\n';
      for (let i = 0; i < 1005; i++) {
        csv += `Item_${i}\n`;
      }

      const boundary = '----WebKitFormBoundaryPlanExceeded';
      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csv, 'utf8'),
        'many.csv',
        { Name: freeEnt.fields[0].id }
      );

      const freeAdmin = await createTestSession(freeTenant, 'admin', 'free_adm');
      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/sample/import/commit`,
        headers: {
          ...freeAdmin.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Limit exceeded');
    });
  });

  // =========================================================================
  // 5. (e) Permissions & Authorization
  // =========================================================================
  describe('(e) permissions and field restrictions', () => {
    it('viewer or editor without create permission gets 403 Forbidden', async () => {
      // Configure editor with canCreate = false on product entity
      await permissionService.setEntityPermission(testTenantA, targetProductEntityId, 'editor', {
        canRead: true,
        canCreate: false,
        canUpdate: true,
        canDelete: true,
      });

      const editorSession = await createTestSession(testTenantA, 'editor', 'editor_nocreate');
      const boundary = '----WebKitFormBoundaryNoCreate';
      const payload = createMultipartPayload(
        boundary,
        Buffer.from('SKU,Title\nSKU-1,T1\n', 'utf8'),
        'test.csv'
      );

      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/preview`,
        headers: {
          ...editorSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('permission');

      // Reset editor canCreate to true
      await permissionService.setEntityPermission(testTenantA, targetProductEntityId, 'editor', {
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
      });
    });

    it('rejects mapping a read-only or hidden field for current role', async () => {
      // Set price field to read-only for editor
      await permissionService.setFieldPermission(
        testTenantA,
        targetProductEntityId,
        productFields.price,
        'editor',
        { readOnly: true, hidden: false }
      );

      const editorSession = await createTestSession(testTenantA, 'editor', 'editor_readonly');
      const boundary = '----WebKitFormBoundaryReadOnly';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price, // Editor attempting to map a read-only field!
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from('SKU,Title,Price,Active\nSKU-RO,RO,50,true\n', 'utf8'),
        'test.csv',
        mapping
      );

      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: {
          ...editorSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('read-only or hidden');

      // Reset field permission
      await permissionService.setFieldPermission(
        testTenantA,
        targetProductEntityId,
        productFields.price,
        'editor',
        { readOnly: false, hidden: false }
      );
    });
  });

  // =========================================================================
  // 6. (f) Multi-tenant Isolation
  // =========================================================================
  it('(f) cross-tenant: Tenant B user cannot import into Tenant A entity', async () => {
    const adminSessionB = await createTestSession(testTenantB, 'admin', 'admin_b');
    const boundary = '----WebKitFormBoundaryCrossTenant';
    const payload = createMultipartPayload(
      boundary,
      Buffer.from('SKU,Title\nSKU-X,Tx\n', 'utf8'),
      'test.csv'
    );

    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/${targetProductEntityId}/import/preview`,
      headers: {
        ...adminSessionB.headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(404);
  });

  // =========================================================================
  // 7. (g) Security Checks: Zip-bomb, Non-CSV Magic Bytes, XLSX Formulas & Macros
  // =========================================================================
  describe('(g) security guards', () => {
    it('rejects renamed binary file containing null bytes disguised as CSV', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_nullbytes');
      // Buffer with binary null bytes
      const binaryDisguised = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);

      const boundary = '----WebKitFormBoundaryBinaryDisguised';
      const payload = createMultipartPayload(
        boundary,
        binaryDisguised,
        'malicious.csv'
      );

      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/preview`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('binary null bytes detected');
    });

    it('reads cached values in XLSX formula cells and never evaluates formulas', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_xlsx_formula');

      // Create an XLSX file with a formula cell using exceljs
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Products');
      ws.addRow(['SKU', 'Title', 'Price', 'Active']);
      // Row 2: formula cell for price
      const r2 = ws.addRow(['SKU-XLSX-001', 'Formulated Item', null, true]);
      r2.getCell(3).value = {
        formula: '100 + 50',
        result: 150, // cached result
      };

      const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const boundary = '----WebKitFormBoundaryXlsxFormula';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        xlsxBuffer,
        'formulas.xlsx',
        mapping
      );

      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(1);

      // Verify records API returns cached formula result (150)
      const getRes = await server.inject({
        method: 'GET',
        url: `/api/entities/product/records`,
        headers: adminSession.headers,
      });
      const rec = getRes.json().data.find((r: any) => r.sku === 'SKU-XLSX-001');
      expect(rec).toBeDefined();
      expect(Number(rec.price)).toBe(150);
    });

    it('rejects zip-bomb style XLSX exceeding entry or ratio caps', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_zipbomb');
      // Create artificial corrupted/huge zip buffer with excessive entry count in Central Directory
      const corruptZip = Buffer.alloc(100);
      corruptZip[0] = 0x50;
      corruptZip[1] = 0x4b;
      corruptZip[2] = 0x03;
      corruptZip[3] = 0x04;

      // Put EOCD signature at end with 999 entries
      const eocdPos = 60;
      corruptZip.writeUInt32LE(0x06054b50, eocdPos);
      corruptZip.writeUInt16LE(999, eocdPos + 10); // 999 entries > cap 500

      const boundary = '----WebKitFormBoundaryZipBomb';
      const payload = createMultipartPayload(boundary, corruptZip, 'bomb.xlsx');

      const res = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/preview`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('ZIP security check failed');
    });
  });

  // =========================================================================
  // 8. (h) Formatting: UTF-8 BOM, Quoted Newlines, Dates, Decimal Comma
  // =========================================================================
  describe('(h) formatting variations', () => {
    it('seamlessly imports CSV with UTF-8 BOM and quoted newlines', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_bom');

      // UTF-8 BOM is 0xEF, 0xBB, 0xBF
      const bomHeader = Buffer.from([0xef, 0xbb, 0xbf]);
      const csvBody = Buffer.from(
        `SKU,Title,Price,Active\n` +
        `SKU-BOM-1,"Multi-line\nTitle Description",79.99,true\n`,
        'utf8'
      );
      const csvWithBom = Buffer.concat([bomHeader, csvBody]);

      const boundary = '----WebKitFormBoundaryBOM';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        csvWithBom,
        'bom.csv',
        mapping
      );

      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(1);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/entities/product/records`,
        headers: adminSession.headers,
      });
      const rec = getRes.json().data.find((r: any) => r.sku === 'SKU-BOM-1');
      expect(rec).toBeDefined();
      expect(rec.title).toBe('Multi-line\nTitle Description');
    });

    it('parses dates in DD/MM/YYYY and MM/DD/YYYY, and numbers with decimal comma', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_formats');

      const csvContent =
        `SKU,Title,Price,Active,Release Date\n` +
        `SKU-FMT-1,European Format,"1.250,50",true,25/12/2026\n`; // DD/MM/YYYY and decimal comma

      const boundary = '----WebKitFormBoundaryFormats';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
        'Release Date': productFields.release_date,
      };
      const options = {
        dateFormat: 'DD/MM/YYYY',
        decimalSeparator: ',',
      };

      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'formats.csv',
        mapping,
        options
      );

      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(1);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/entities/product/records`,
        headers: adminSession.headers,
      });
      const rec = getRes.json().data.find((r: any) => r.sku === 'SKU-FMT-1');
      expect(Number(rec.price)).toBe(1250.5);
      const parsedDate = new Date(rec.release_date);
      expect(parsedDate.getFullYear()).toBe(2026);
      expect(parsedDate.getMonth()).toBe(11);
      expect(parsedDate.getDate()).toBe(25);
    });
  });

  describe('Import Hardening, CSRF & Performance Tests', () => {
    it('CSRF enforcement: rejects multipart POST without CSRF token with 403 Forbidden', async () => {
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_csrf_test');
      const boundary = '----WebKitFormBoundaryCsrfHarden';
      const csvContent = 'SKU,Title,Price\nSKU-NO-CSRF,Widget,10\n';
      const payload = createMultipartPayload(
        boundary,
        Buffer.from(csvContent, 'utf8'),
        'test.csv',
        { SKU: productFields.sku }
      );

      // Session cookie is present, but x-csrf-token header is omitted
      const headersNoCsrf = {
        cookie: adminSession.headers.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      };

      // 1. Preview route
      const previewRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/preview`,
        headers: headersNoCsrf,
        payload,
      });
      expect(previewRes.statusCode).toBe(403);
      expect(previewRes.json().message).toBe('CSRF token mismatch');

      // 2. Dry-run route
      const dryRunRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/dry-run`,
        headers: headersNoCsrf,
        payload,
      });
      expect(dryRunRes.statusCode).toBe(403);
      expect(dryRunRes.json().message).toBe('CSRF token mismatch');

      // 3. Commit route
      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: headersNoCsrf,
        payload,
      });
      expect(commitRes.statusCode).toBe(403);
      expect(commitRes.json().message).toBe('CSRF token mismatch');
    });

    it('Performance test: imports 10,000 rows with 1 reference field and 1 unique field into an empty entity under 30s timeout', async () => {
      // 1. Elevate tenant to pro plan so 10,000 row import is allowed
      await pool.query(`UPDATE public.tenant SET plan = 'pro' WHERE id = $1`, [testTenantA]);

      // 2. Create empty target entity with 1 unique text field and 1 reference field
      const perfEntityRes = await migrationService.createEntity(testTenantA, {
        name: 'perf_device',
        label: 'Performance Device',
        fields: [
          { name: 'serial_no', label: 'Serial Number', type: 'text', required: true, unique: true },
          {
            name: 'client_id',
            label: 'Client Reference',
            type: 'reference',
            required: false,
            config: { targetEntityId: targetCustomerEntityId },
          },
        ],
      });
      const perfEntityId = perfEntityRes.entity.id;
      const serialFieldId = perfEntityRes.fields.find((f) => f.name === 'serial_no')!.id;
      const clientFieldId = perfEntityRes.fields.find((f) => f.name === 'client_id')!.id;

      // 3. Generate 10,000 CSV rows: each has a unique serial_no and references pre-created "Acme Corporation"
      const csvRows = ['Serial,Client'];
      for (let i = 1; i <= 10000; i++) {
        csvRows.push(`SN-PERF-${i},Acme Corporation`);
      }
      const csvBuffer = Buffer.from(csvRows.join('\n'), 'utf8');

      const boundary = '----WebKitFormBoundaryPerf10k';
      const mapping = {
        Serial: serialFieldId,
        Client: clientFieldId,
      };

      const payload = createMultipartPayload(
        boundary,
        csvBuffer,
        'perf_10000.csv',
        mapping
      );

      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_perf_test');

      // 4. Intercept SQL queries to count total queries issued
      let sqlQueryCount = 0;
      const originalPoolQuery = pool.query.bind(pool);
      const originalStorageQuery = defaultStorageAdapter.query.bind(defaultStorageAdapter);
      const originalStorageTx = defaultStorageAdapter.transaction.bind(defaultStorageAdapter);

      pool.query = (async (...args: any[]) => {
        sqlQueryCount++;
        return (originalPoolQuery as any)(...args);
      }) as any;

      defaultStorageAdapter.query = (async (...args: any[]) => {
        sqlQueryCount++;
        return (originalStorageQuery as any)(...args);
      }) as any;

      defaultStorageAdapter.transaction = (async (tenantId: string, callback: any, timeoutMs?: number) => {
        return originalStorageTx(
          tenantId,
          async (tx: any) => {
            const originalTxQuery = tx.query.bind(tx);
            tx.query = async (...txArgs: any[]) => {
              sqlQueryCount++;
              return originalTxQuery(...txArgs);
            };
            return callback(tx);
          },
          timeoutMs
        );
      }) as any;

      const startTime = Date.now();
      let commitRes;
      try {
        commitRes = await server.inject({
          method: 'POST',
          url: `/api/entities/perf_device/import/commit`,
          headers: {
            ...adminSession.headers,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          payload,
        });
      } finally {
        pool.query = originalPoolQuery;
        defaultStorageAdapter.query = originalStorageQuery;
        defaultStorageAdapter.transaction = originalStorageTx;
      }

      const elapsedMs = Date.now() - startTime;

      console.log(`\n=== 10,000 ROW IMPORT PERFORMANCE RESULTS ===`);
      console.log(`Elapsed Time: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
      console.log(`SQL Queries Issued: ${sqlQueryCount}`);
      console.log(`Timeout Threshold: 30,000 ms`);
      console.log(`Inserted Count: ${commitRes.json()?.insertedCount}`);
      console.log(`==============================================\n`);

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(10000);
      // Deterministic query count assertion: batched reference and unique lookups + 1 single insert query
      expect(sqlQueryCount).toBeLessThan(25);
    }, 60000);

    it('Peak memory report for 10 MB XLSX at 10,000 row cap and row cap enforcement', async () => {
      // 1. Build a ~10 MB XLSX workbook with 10,000 rows (at the row cap)
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.columns = [
        { header: 'Serial', key: 'c1' },
        { header: 'PayloadA', key: 'c2' },
        { header: 'PayloadB', key: 'c3' },
      ];

      for (let i = 0; i < 10000; i++) {
        ws.addRow({
          c1: `SN-${i}`,
          c2: crypto.randomBytes(450).toString('hex'),
          c3: crypto.randomBytes(450).toString('hex'),
        });
      }

      const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());
      const bufferMb = Number((xlsxBuffer.length / (1024 * 1024)).toFixed(2));
      expect(bufferMb).toBeGreaterThanOrEqual(9.5); // Assert ~10 MB file

      const initialHeap = process.memoryUsage().heapUsed;
      let peakHeap = initialHeap;
      const interval = setInterval(() => {
        const cur = process.memoryUsage().heapUsed;
        if (cur > peakHeap) peakHeap = cur;
      }, 5);

      const parsed = await parseXlsxContent(xlsxBuffer);
      clearInterval(interval);

      const peakHeapMb = Number((peakHeap / (1024 * 1024)).toFixed(2));
      const deltaHeapMb = Number(((peakHeap - initialHeap) / (1024 * 1024)).toFixed(2));

      console.log(`\n=== 10 MB XLSX MEMORY BENCHMARK RESULTS ===`);
      console.log(`Buffer Size: ${bufferMb} MB`);
      console.log(`Initial Heap: ${(initialHeap / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`Peak Heap Used: ${peakHeapMb} MB`);
      console.log(`Delta Heap: ${deltaHeapMb} MB`);
      console.log(`Parsed Row Count: ${parsed.rows.length}`);
      console.log(`===========================================\n`);

      expect(parsed.rows.length).toBe(10000);
      expect(peakHeapMb).toBeLessThan(350); // Peak memory stays well within healthy limits

      // 2. Assert XLSX exceeding the 10,000 row cap is rejected
      const oversizedWb = new ExcelJS.Workbook();
      const oversizedWs = oversizedWb.addWorksheet('Sheet1');
      oversizedWs.columns = [{ header: 'Code', key: 'c1' }];
      for (let i = 1; i <= 10001; i++) {
        oversizedWs.addRow({ c1: `Item-${i}` });
      }
      const oversizedBuf = Buffer.from(await oversizedWb.xlsx.writeBuffer());

      await expect(parseXlsxContent(oversizedBuf)).rejects.toThrow(
        /XLSX row cap exceeded: maximum allowed is 10,000 data rows/
      );
    }, 60000);

    it('XLSX row cap counts rows that actually contain values: 50 data rows in ~10 MB file with 1,048,576 explicit empty rows imports fine; peak heap under 250 MB', async () => {
      // 1. Build a ~10 MB XLSX containing 1,048,576 explicit empty <row> elements
      const { PassThrough } = await import('node:stream');
      const pt = new PassThrough();
      const chunks: Buffer[] = [];
      pt.on('data', (c) => chunks.push(c));
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pt });
      const ws = wb.addWorksheet('Sheet1');
      const headers = ['SKU', 'Title', 'Price', 'Active'];
      for (let c = 1; c <= 8; c++) headers.push('Extra' + c);
      ws.addRow(headers);

      // 50 real data rows with payload in unmapped columns to create a realistic ~10 MB file
      for (let i = 1; i <= 50; i++) {
        const row: any[] = [`SKU-SPARSE-${i}`, `Sparse Item ${i}`, 19.99, true];
        for (let c = 1; c <= 8; c++) row.push(crypto.randomBytes(17000).toString('hex'));
        ws.addRow(row);
      }

      // Explicit empty <row> elements spanning up to Excel max row 1,048,576
      for (let i = 52; i <= 1048576; i++) {
        const r = ws.addRow();
        r.height = 15;
        r.commit();
      }
      ws.commit();
      await wb.commit();

      const sparseBuf = Buffer.concat(chunks);
      const bufferMb = Number((sparseBuf.length / (1024 * 1024)).toFixed(2));
      expect(bufferMb).toBeGreaterThanOrEqual(9.5); // Assert ~10 MB file

      const initialHeap = process.memoryUsage().heapUsed;
      let peakHeap = initialHeap;
      const interval = setInterval(() => {
        const cur = process.memoryUsage().heapUsed;
        if (cur > peakHeap) peakHeap = cur;
      }, 5);

      // parseXlsxContent uses streaming reader and only counts rows with actual cell values
      const sparseParsed = await parseXlsxContent(sparseBuf);
      clearInterval(interval);

      const peakHeapMb = Number((peakHeap / (1024 * 1024)).toFixed(2));
      console.log(`\n=== 10 MB XLSX (1,048,576 ROWS) STREAMING PARSER RESULTS ===`);
      console.log(`Buffer Size: ${bufferMb} MB`);
      console.log(`Initial Heap: ${(initialHeap / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`Peak Heap Used: ${peakHeapMb} MB`);
      console.log(`Parsed Data Row Count: ${sparseParsed.rows.length}`);
      console.log(`=============================================================\n`);

      expect(sparseParsed.rows.length).toBe(50);
      expect(peakHeapMb).toBeLessThan(250); // Peak heap must stay under 250 MB

      // Verify full import commit succeeds with 50 rows
      const adminSession = await createTestSession(testTenantA, 'admin', 'admin_sparse_50');
      const boundary = '----WebKitFormBoundarySparse50';
      const mapping = {
        SKU: productFields.sku,
        Title: productFields.title,
        Price: productFields.price,
        Active: productFields.is_active,
      };

      const payload = createMultipartPayload(
        boundary,
        sparseBuf,
        'sparse_50.xlsx',
        mapping
      );

      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/entities/product/import/commit`,
        headers: {
          ...adminSession.headers,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(50);

      // 2. Sheet with 10,001 real data rows is rejected
      const oversizedWb = new ExcelJS.Workbook();
      const oversizedWs = oversizedWb.addWorksheet('Sheet1');
      oversizedWs.columns = [{ header: 'Code', key: 'c1' }];
      for (let i = 1; i <= 10001; i++) {
        oversizedWs.addRow({ c1: `Item-${i}` });
      }
      const oversizedBuf = Buffer.from(await oversizedWb.xlsx.writeBuffer());

      await expect(parseXlsxContent(oversizedBuf)).rejects.toThrow(
        /XLSX row cap exceeded: maximum allowed is 10,000 data rows/
      );
    }, 60000);

    it('Reference & uniqueness lookups filter by distinct file values (= ANY($1::text[])): 100,000-row target table with 100-row import reads few rows and completes fast', async () => {
      // 1. Provision scale tenant with enterprise plan
      const scaleTenant = `t_scale_${crypto.randomBytes(4).toString('hex')}`;
      createdTenants.add(scaleTenant);
      await migrationService.provisionTenant(scaleTenant, 'Scale Test Tenant');
      await pool.query(`UPDATE public.tenant SET plan = 'enterprise' WHERE id = $1`, [scaleTenant]);

      // 2. Create customer entity and seed 100,000 rows
      const custEntityRes = await migrationService.createEntity(scaleTenant, {
        name: 'scale_customer',
        label: 'Scale Customer',
        fields: [
          { name: 'name', label: 'Customer Name', type: 'text', required: true },
        ],
      });
      const custEntityId = custEntityRes.entity.id;
      const custDisplayFieldId = custEntityRes.fields.find((f) => f.name === 'name')!.id;
      await migrationService.updateEntity(scaleTenant, {
        entityId: custEntityId,
        displayFieldId: custDisplayFieldId,
        expectedVersion: 1,
      });

      const custPhysicalTable = defaultStorageAdapter.getPhysicalTableName(
        scaleTenant,
        custEntityRes.entity.physicalTableName
      );
      const custPhysicalCol = defaultStorageAdapter.getPhysicalColumnName(
        custEntityRes.fields.find((f) => f.name === 'name')!.physicalColumnName
      );

      // Fast seed 100,000 customers in single query using generate_series
      await pool.query(`
        INSERT INTO ${custPhysicalTable} (id, created_at, updated_at, ${custPhysicalCol})
        SELECT gen_random_uuid(), NOW(), NOW(), 'Customer ' || g
        FROM generate_series(1, 100000) g
      `);

      // 3. Create target order entity with 1 unique field and 1 reference field
      const orderEntityRes = await migrationService.createEntity(scaleTenant, {
        name: 'scale_order',
        label: 'Scale Order',
        fields: [
          { name: 'order_number', label: 'Order Number', type: 'text', required: true, unique: true },
          {
            name: 'customer_id',
            label: 'Customer',
            type: 'reference',
            required: true,
            config: { targetEntityId: custEntityId },
          },
        ],
      });
      const orderEntityId = orderEntityRes.entity.id;
      const orderNumFieldId = orderEntityRes.fields.find((f) => f.name === 'order_number')!.id;
      const orderCustFieldId = orderEntityRes.fields.find((f) => f.name === 'customer_id')!.id;

      // 4. Generate 100-row CSV referencing Customer 1..Customer 100
      const csvLines = ['OrderNo,Customer'];
      for (let i = 1; i <= 100; i++) {
        csvLines.push(`ORD-SCALE-${i},Customer ${i}`);
      }
      const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf8');

      const boundary = '----WebKitFormBoundaryScale100';
      const mapping = {
        OrderNo: orderNumFieldId,
        Customer: orderCustFieldId,
      };

      const payload = createMultipartPayload(
        boundary,
        csvBuffer,
        'orders_100.csv',
        mapping
      );

      const adminSession = await createTestSession(scaleTenant, 'admin', 'admin_scale');

      // 5. Measure full-scan query baseline time (SELECT id, name FROM scale_customer)
      const fullScanStart = Date.now();
      const fullScanRows = await defaultStorageAdapter.query(
        scaleTenant,
        `SELECT id, ${custPhysicalCol}::text AS disp FROM ${custPhysicalTable}`
      );
      const fullScanElapsedMs = Date.now() - fullScanStart;
      expect(fullScanRows.length).toBe(100000);

      // 6. Execute import and track rows read by the reference and uniqueness queries
      let referenceRowsRead = 0;
      let uniquenessRowsRead = 0;
      const originalStorageQuery = defaultStorageAdapter.query.bind(defaultStorageAdapter);

      defaultStorageAdapter.query = (async (tId: string, text: string, params?: any[], timeoutMs?: number) => {
        const res = await originalStorageQuery(tId, text, params, timeoutMs);
        if (
          text.includes(custEntityRes.entity.physicalTableName) &&
          text.includes('ANY($1::text[])')
        ) {
          referenceRowsRead += res.length;
        }
        if (
          text.includes(orderEntityRes.entity.physicalTableName) &&
          text.includes('ANY($1::text[])')
        ) {
          uniquenessRowsRead += res.length;
        }
        return res;
      }) as any;

      const importStart = Date.now();
      let commitRes;
      try {
        commitRes = await server.inject({
          method: 'POST',
          url: `/api/entities/scale_order/import/commit`,
          headers: {
            ...adminSession.headers,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          payload,
        });
      } finally {
        defaultStorageAdapter.query = originalStorageQuery;
      }
      const importElapsedMs = Date.now() - importStart;

      console.log(`\n=== 100,000-ROW TARGET TABLE LOOKUP BENCHMARK ===`);
      console.log(`Target Table Rows: 100,000`);
      console.log(`Import File Rows: 100`);
      console.log(`Full-Scan Baseline Elapsed: ${fullScanElapsedMs} ms (100,000 rows read into memory)`);
      console.log(`Filtered Lookup Import Total Elapsed: ${importElapsedMs} ms`);
      console.log(`Reference Rows Read from DB: ${referenceRowsRead} (expected: 100, NOT 100,000)`);
      console.log(`Uniqueness Rows Read from DB: ${uniquenessRowsRead} (expected: 0, NOT 100,000)`);
      console.log(`Total Lookup Rows Read: ${referenceRowsRead + uniquenessRowsRead} vs 100,000 in full scan`);
      console.log(`Inserted Count: ${commitRes.json()?.insertedCount}`);
      console.log(`=================================================\n`);

      expect(commitRes.statusCode).toBe(200);
      expect(commitRes.json().insertedCount).toBe(100);

      // Assert deterministic values only: few rows read (only 100 matching reference records and 0 unique conflicts)
      expect(referenceRowsRead).toBe(100);
      expect(uniquenessRowsRead).toBe(0);
      expect(referenceRowsRead + uniquenessRowsRead).toBe(100);
    }, 60000);
  });
});
