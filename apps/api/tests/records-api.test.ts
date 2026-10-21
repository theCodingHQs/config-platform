import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';
import { recordsService } from '../src/records/records-service.js';
import { permissionService } from '../src/permissions/permission-service.js';

describe('Generic Records API', () => {
  let server: FastifyInstance;
  const tenantA = `rec_a_${crypto.randomBytes(3).toString('hex')}`;
  const tenantB = `rec_b_${crypto.randomBytes(3).toString('hex')}`;
  const schemaA = defaultStorageAdapter.getTenantSchemaName(tenantA);
  const schemaB = defaultStorageAdapter.getTenantSchemaName(tenantB);

  let departmentEntityId: string;
  let employeeEntityId: string;
  let ageFieldId: string;

  // Session for all Tenant A requests (owner – full CRUD)
  let authA: TestSession;
  // Session for Tenant B requests
  let authB: TestSession;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    // Provision Tenant A
    await migrationService.provisionTenant(tenantA, 'Tenant A Corp');

    // 1. Create Department Entity in Tenant A
    const deptRes = await migrationService.createEntity(tenantA, {
      name: 'department',
      label: 'Department',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'code', label: 'Code', type: 'text', unique: true },
      ],
    });
    departmentEntityId = deptRes.entity.id;

    // 2. Create Employee Entity in Tenant A
    const empRes = await migrationService.createEntity(tenantA, {
      name: 'employee',
      label: 'Employee',
      fields: [
        { name: 'full_name', label: 'Full Name', type: 'text', required: true, config: { maxLength: 50 } },
        { name: 'email', label: 'Email', type: 'text', required: true },
        { name: 'age', label: 'Age', type: 'number', config: { min: 18, max: 100 } },
        { name: 'is_active', label: 'Is Active', type: 'boolean', config: { defaultValue: true } },
        { name: 'joined_at', label: 'Joined At', type: 'date' },
        {
          name: 'role',
          label: 'Role',
          type: 'select',
          config: {
            options: [
              { label: 'Engineer', value: 'engineer' },
              { label: 'Manager', value: 'manager' },
              { label: 'Designer', value: 'designer' },
            ],
          },
        },
        {
          name: 'department_id',
          label: 'Department',
          type: 'reference',
          config: { targetEntityId: departmentEntityId },
        },
      ],
    });
    employeeEntityId = empRes.entity.id;
    ageFieldId = empRes.fields.find((f) => f.name === 'age')!.id;

    // 3. Add FK relation between Employee and Department
    const deptRefField = empRes.fields.find((f) => f.name === 'department_id')!;
    await migrationService.addRelation(tenantA, {
      name: 'employee_department_fk',
      sourceEntityId: employeeEntityId,
      sourceFieldId: deptRefField.id,
      targetEntityId: departmentEntityId,
      relationType: 'many_to_one',
      onDelete: 'RESTRICT',
    });

    // Provision Tenant B with same structure for tenant isolation testing
    await migrationService.provisionTenant(tenantB, 'Tenant B Corp');
    await migrationService.createEntity(tenantB, {
      name: 'employee',
      label: 'Employee',
      fields: [
        { name: 'full_name', label: 'Full Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'text', required: true },
      ],
    });

    // Create sessions
    authA = await createTestSession(tenantA, 'owner', 'rec_owner_a');
    authB = await createTestSession(tenantB, 'owner', 'rec_owner_b');
  }, 60000);

  afterAll(async () => {
    await server.close();
    if (authA?.userId) await cleanupTestUser(authA.userId);
    if (authB?.userId) await cleanupTestUser(authB.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id IN ($1, $2)`, [tenantA, tenantB]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
  }, 60000);

  let createdDeptId: string;
  let createdEmpId: string;

  // 1. CRUD Happy Path
  it('performs CRUD happy path on records', async () => {
    // CREATE Department
    const deptCreateRes = await server.inject({
      method: 'POST',
      url: `/api/entities/department/records`,
      headers: authA.headers,
      payload: {
        title: 'Engineering',
        code: 'ENG',
      },
    });
    expect(deptCreateRes.statusCode).toBe(201);
    const deptData = JSON.parse(deptCreateRes.payload);
    expect(deptData.id).toBeDefined();
    expect(deptData.title).toBe('Engineering');
    expect(deptData.code).toBe('ENG');
    expect(deptData.created_at).toBeDefined();
    expect(deptData.updated_at).toBeDefined();
    createdDeptId = deptData.id;

    // CREATE Employee referencing Department
    const empCreateRes = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Alice Johnson',
        email: 'alice@example.com',
        age: 30,
        is_active: true,
        joined_at: '2025-01-15T09:00:00.000Z',
        role: 'engineer',
        department_id: createdDeptId,
      },
    });
    expect(empCreateRes.statusCode).toBe(201);
    const empData = JSON.parse(empCreateRes.payload);
    expect(empData.id).toBeDefined();
    expect(empData.full_name).toBe('Alice Johnson');
    expect(empData.role).toBe('engineer');
    expect(empData.department_id).toBe(createdDeptId);
    createdEmpId = empData.id;

    // READ Record by ID
    const getRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records/${createdEmpId}`,
      headers: authA.headers,
    });
    expect(getRes.statusCode).toBe(200);
    const getEmp = JSON.parse(getRes.payload);
    expect(getEmp.id).toBe(createdEmpId);
    expect(getEmp.full_name).toBe('Alice Johnson');

    // PATCH Record
    const patchRes = await server.inject({
      method: 'PATCH',
      url: `/api/entities/employee/records/${createdEmpId}`,
      headers: authA.headers,
      payload: {
        role: 'manager',
        age: 31,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchedEmp = JSON.parse(patchRes.payload);
    expect(patchedEmp.role).toBe('manager');
    expect(Number(patchedEmp.age)).toBe(31);
    expect(patchedEmp.full_name).toBe('Alice Johnson'); // preserved
  });

  // 2. Validation errors per type
  it('validates required fields on create and returns 422 with field errors', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        age: 25,
      },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Unprocessable Entity');
    expect(body.errors.full_name).toBeDefined();
    expect(body.errors.email).toBeDefined();
  });

  it('validates text maxLength constraint', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'A'.repeat(55), // limit is 50
        email: 'test@example.com',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.errors.full_name).toContain('exceeds maximum length of 50');
  });

  it('validates number min and max constraints', async () => {
    const resUnder = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Bob',
        email: 'bob@example.com',
        age: 15, // min is 18
      },
    });
    expect(resUnder.statusCode).toBe(422);
    expect(JSON.parse(resUnder.payload).errors.age).toContain('must be at least 18');

    const resOver = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Bob',
        email: 'bob@example.com',
        age: 150, // max is 100
      },
    });
    expect(resOver.statusCode).toBe(422);
    expect(JSON.parse(resOver.payload).errors.age).toContain('must be at most 100');
  });

  it('validates date format', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Charlie',
        email: 'charlie@example.com',
        joined_at: 'not-a-valid-date',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).errors.joined_at).toContain('valid date');
  });

  it('validates select options constraint', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Dave',
        email: 'dave@example.com',
        role: 'invalid_role',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).errors.role).toContain('must be one of: engineer, manager, designer');
  });

  // 3. Unknown field rejected
  it('rejects unknown fields with 400 Bad Request', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Eve',
        email: 'eve@example.com',
        unrecognized_field: 'malicious_or_accidental',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('Unknown field(s): unrecognized_field');
  });

  // 3a. System fields (id, created_at, updated_at) silently ignored on write & left unchanged
  it('PATCH with echoed system fields succeeds and leaves them unchanged', async () => {
    // Create record
    const createRes = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Echo Test User',
        email: 'echo@example.com',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload);
    const originalId = created.id;
    const originalCreatedAt = created.created_at;

    // PATCH with echoed system fields
    const patchRes = await server.inject({
      method: 'PATCH',
      url: `/api/entities/employee/records/${originalId}`,
      headers: authA.headers,
      payload: {
        id: 'attempted-fake-id',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        full_name: 'Echo Test User Updated',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = JSON.parse(patchRes.payload);

    expect(updated.id).toBe(originalId);
    expect(updated.created_at).toBe(originalCreatedAt);
    expect(updated.full_name).toBe('Echo Test User Updated');
  });

  it('updateRecord with a full row object succeeds', async () => {
    const created = await recordsService.createRecord(tenantA, 'employee', {
      full_name: 'Full Row User',
      email: 'fullrow@example.com',
      age: 32,
    });

    // Update with full row object containing id, created_at, updated_at
    const fullRow = {
      ...created,
      full_name: 'Full Row User Modified',
    };

    const updated = await recordsService.updateRecord(tenantA, 'employee', created.id, fullRow);
    expect(updated.id).toBe(created.id);
    expect(new Date(updated.created_at).toISOString()).toBe(new Date(created.created_at).toISOString());
    expect(updated.full_name).toBe('Full Row User Modified');
  });

  it('PATCH with a truly unknown field still returns 400', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Unknown Field Test',
        email: 'unknown_patch@example.com',
      },
    });
    const created = JSON.parse(createRes.payload);

    // PATCH with system keys (ignored) AND truly unknown field
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/entities/employee/records/${created.id}`,
      headers: authA.headers,
      payload: {
        id: created.id,
        created_at: created.created_at,
        truly_unknown_field: 'should-fail',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('Unknown field(s): truly_unknown_field');
  });

  it('a viewer or editor with a read-only field does not send it and the save succeeds', async () => {
    // Configure 'age' as read-only for editor role
    await permissionService.setFieldPermission(tenantA, employeeEntityId, ageFieldId, 'editor', {
      hidden: false,
      readOnly: true,
    });

    const editorSession = await createTestSession(tenantA, 'editor', 'rec_ed_ro');

    try {
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/entities/employee/records`,
        headers: authA.headers,
        payload: {
          full_name: 'Editor RO Test',
          email: 'editor_ro@example.com',
          age: 25,
        },
      });
      const created = JSON.parse(createRes.payload);

      // Sending read-only field directly is rejected by server
      const failRes = await server.inject({
        method: 'PATCH',
        url: `/api/entities/employee/records/${created.id}`,
        headers: editorSession.headers,
        payload: {
          age: 26,
          full_name: 'Attempted RO Update',
        },
      });
      expect(failRes.statusCode).toBe(403);
      expect(JSON.parse(failRes.payload).message).toContain('read-only');

      // When editor does not send read-only field, save succeeds
      const successRes = await server.inject({
        method: 'PATCH',
        url: `/api/entities/employee/records/${created.id}`,
        headers: editorSession.headers,
        payload: {
          full_name: 'Editor RO Success',
        },
      });
      expect(successRes.statusCode).toBe(200);
      const updated = JSON.parse(successRes.payload);
      expect(updated.full_name).toBe('Editor RO Success');
      expect(Number(updated.age)).toBe(25);
    } finally {
      await cleanupTestUser(editorSession.userId);
    }
  });

  // 4. Reference integrity on create
  it('validates reference existence on create (rejects non-existent reference)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: {
        full_name: 'Frank',
        email: 'frank@example.com',
        department_id: 'non-existent-uuid',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload).errors.department_id).toContain('does not exist');
  });

  // 5. Reference integrity on delete (409 Conflict)
  it('rejects delete of parent record referenced by a foreign key with 409 Conflict', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/entities/department/records/${createdDeptId}`,
      headers: authA.headers,
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Conflict');
    expect(body.message).toContain('is referenced by another record');
  });

  // 6. Filter, Sort, Pagination and Cursor Stability
  it('filters, sorts, and paginates records with keyset cursor stability', async () => {
    const names = ['Emp_A', 'Emp_B', 'Emp_C', 'Emp_D', 'Emp_E'];
    const ages = [22, 28, 35, 42, 50];
    for (let i = 0; i < names.length; i++) {
      await server.inject({
        method: 'POST',
        url: `/api/entities/employee/records`,
        headers: authA.headers,
        payload: {
          full_name: names[i],
          email: `${names[i].toLowerCase()}@example.com`,
          age: ages[i],
          role: i % 2 === 0 ? 'engineer' : 'designer',
        },
      });
    }

    const filterRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[role][eq]=engineer&count=true`,
      headers: authA.headers,
    });
    expect(filterRes.statusCode).toBe(200);
    const filterBody = JSON.parse(filterRes.payload);
    expect(filterBody.data.every((r: any) => r.role === 'engineer')).toBe(true);
    expect(filterBody.total).toBeGreaterThanOrEqual(3);

    const containsRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name][contains]=Emp_`,
      headers: authA.headers,
    });
    expect(containsRes.statusCode).toBe(200);
    const containsBody = JSON.parse(containsRes.payload);
    expect(containsBody.data.length).toBe(5);

    const page1Res = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?sort=age&limit=2`,
      headers: authA.headers,
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = JSON.parse(page1Res.payload);
    expect(page1.data.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    const page2Res = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?sort=age&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      headers: authA.headers,
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = JSON.parse(page2Res.payload);
    expect(page2.data.length).toBe(2);

    const page1Ids = page1.data.map((r: any) => r.id);
    const page2Ids = page2.data.map((r: any) => r.id);
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
  });

  it('matches any of several fields with one filter (filter[a,b][op]) and ANDs it with other filters', async () => {
    // "_b@" is only in Emp_B's email (names have no "@"), so the condition matches by email
    const anyRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name,email][contains]=_b@&count=true`,
      headers: authA.headers,
    });
    expect(anyRes.statusCode).toBe(200);
    const anyBody = JSON.parse(anyRes.payload);
    expect(anyBody.data.map((r: any) => r.full_name)).toEqual(['Emp_B']);
    expect(anyBody.total).toBe(1);

    // Other conditions still apply (AND)
    const combined = JSON.parse((await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name,email][contains]=emp_&filter[age][gte]=40&sort=age`,
      headers: authA.headers,
    })).payload);
    expect(combined.data.map((r: any) => r.full_name)).toEqual(['Emp_D', 'Emp_E']);

    // Each field must accept the operator, and unknown fields are rejected
    const badOp = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name,age][contains]=1`,
      headers: authA.headers,
    });
    expect(badOp.statusCode).toBe(400);
    const unknown = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name,nope][contains]=x`,
      headers: authA.headers,
    });
    expect(unknown.statusCode).toBe(400);

    // Aggregates (stat cards) accept the same filters
    const agg = JSON.parse((await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=count&filter[full_name,email][contains]=_b@`,
      headers: authA.headers,
    })).payload);
    expect(Number(agg.value)).toBe(1);
  });

  it('stores calendar dates and months as written, and moments as instants, whatever the time zone', async () => {
    const created = await migrationService.createEntity(tenantA, {
      name: 'shift_log',
      label: 'Shift Log',
      fields: [
        { name: 'day', label: 'Day', type: 'date' },
        { name: 'period', label: 'Period', type: 'date', config: { granularity: 'month' } },
        { name: 'happened_at', label: 'Happened At', type: 'date', config: { includeTime: true } },
      ],
    } as any);
    const post = (payload: Record<string, unknown>) =>
      server.inject({ method: 'POST', url: `/api/entities/shift_log/records`, headers: authA.headers, payload });

    // A calendar date comes back exactly as written (it used to come back as a shifted timestamp)
    const a = JSON.parse((await post({ day: '2026-10-01', period: '2026-10-21', happened_at: '2026-10-21T20:05:00+05:30' })).payload);
    expect(a.day).toBe('2026-10-01');
    // Month granularity keeps the 1st of the month
    expect(a.period).toBe('2026-10-01');
    // A moment is stored as an instant and returned in UTC
    expect(new Date(a.happened_at).toISOString()).toBe('2026-10-21T14:35:00.000Z');

    // The written calendar date of an ISO date-time is kept, and "YYYY-MM" works for months
    const b = JSON.parse((await post({ day: '2026-10-02T00:00:00.000Z', period: '2026-11' })).payload);
    expect(b.day).toBe('2026-10-02');
    expect(b.period).toBe('2026-11-01');

    // Invalid values are rejected with field messages
    const bad = JSON.parse((await post({ day: '2026-02-30', period: 'October' })).payload);
    expect(bad.errors.day).toMatch(/valid date/);
    expect(bad.errors.period).toMatch(/month/);

    // Filtering by month matches the stored 1st
    const october = JSON.parse((await server.inject({
      method: 'GET', url: `/api/entities/shift_log/records?filter[period][eq]=2026-10-01`, headers: authA.headers,
    })).payload);
    expect(october.data).toHaveLength(1);

    // Switching a Date field to Month moves existing values to the 1st; date ⇄ date & time is refused
    const dayField = created.fields.find((f) => f.name === 'day')!;
    const timeField = created.fields.find((f) => f.name === 'happened_at')!;
    await migrationService.updateField(tenantA, {
      entityId: created.entity.id, fieldId: dayField.id, expectedVersion: created.entity.version, config: { granularity: 'month' },
    });
    const days = JSON.parse((await server.inject({ method: 'GET', url: `/api/entities/shift_log/records?sort=day`, headers: authA.headers })).payload)
      .data.map((r: any) => r.day);
    expect(days).toEqual(['2026-10-01', '2026-10-01']);
    await expect(migrationService.updateField(tenantA, {
      entityId: created.entity.id, fieldId: timeField.id, expectedVersion: created.entity.version + 1, config: {},
    })).rejects.toThrow(/date & time/);
  });

  it('returns grouped totals in key order and says when groups were cut at the limit', async () => {
    const get = async (url: string) => JSON.parse((await server.inject({ method: 'GET', url, headers: authA.headers })).payload);
    const all = await get(`/api/entities/employee/aggregate?op=count&groupBy=role&filter[full_name][contains]=Emp_`);
    // Emp_A..E: engineer x3, designer x2, sorted by key
    expect(all.groups).toEqual([{ key: 'designer', value: 2 }, { key: 'engineer', value: 3 }]);
    expect(all.groupsTruncated).toBe(false);

    const first = await get(`/api/entities/employee/aggregate?op=sum&field=age&groupBy=role&groupLimit=1&filter[full_name][contains]=Emp_`);
    expect(first.groups).toEqual([{ key: 'designer', value: 28 + 42 }]);
    expect(first.groupsTruncated).toBe(true);
  });

  it('rejects any-of and aggregate filters that use a hidden field', async () => {
    await permissionService.setFieldPermission(tenantA, employeeEntityId, ageFieldId, 'viewer', { hidden: true, readOnly: false });
    const viewer = await createTestSession(tenantA, 'viewer', 'rec_any_hidden');
    try {
      const listRes = await server.inject({
        method: 'GET',
        url: `/api/entities/employee/records?filter[full_name,age][eq]=42`,
        headers: viewer.headers,
      });
      expect(listRes.statusCode).toBe(403);
      // Counting by a hidden field would reveal its values
      const aggRes = await server.inject({
        method: 'GET',
        url: `/api/entities/employee/aggregate?op=count&filter[age][gte]=40`,
        headers: viewer.headers,
      });
      expect(aggRes.statusCode).toBe(403);
    } finally {
      await permissionService.setFieldPermission(tenantA, employeeEntityId, ageFieldId, 'viewer', { hidden: false, readOnly: false });
      await cleanupTestUser(viewer.userId);
    }
  });

  // 7. SQL injection attempts
  it('safely rejects SQL injection attempts via field names and sort clauses', async () => {
    const badFilterRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter['; DROP TABLE "test";--][eq]=1`,
      headers: authA.headers,
    });
    expect(badFilterRes.statusCode).toBe(400);

    const badSortRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?sort=age;DROP TABLE test;--`,
      headers: authA.headers,
    });
    expect(badSortRes.statusCode).toBe(400);

    const paramValRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records?filter[full_name][eq]=' OR 1=1 --`,
      headers: authA.headers,
    });
    expect(paramValRes.statusCode).toBe(200);
    const body = JSON.parse(paramValRes.payload);
    expect(body.data.length).toBe(0);
  });

  // 8. Rename field and confirm API still works with new name and old data intact
  it('renames a field in catalog, confirms API works with new name and preserves data', async () => {
    const entityErd = await migrationService.createEntity(tenantA, {
      name: 'product',
      label: 'Product',
      fields: [
        { name: 'old_title', label: 'Old Title', type: 'text', required: true },
      ],
    });

    const productEntityId = entityErd.entity.id;
    const oldTitleFieldId = entityErd.fields[0].id;

    const createProdRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/records`,
      headers: authA.headers,
      payload: {
        old_title: 'Super Gizmo',
      },
    });
    expect(createProdRes.statusCode).toBe(201);
    const prodId = JSON.parse(createProdRes.payload).id;

    await migrationService.updateField(tenantA, {
      entityId: productEntityId,
      fieldId: oldTitleFieldId,
      expectedVersion: 1,
      name: 'new_title',
      label: 'New Title',
    });

    const badReqRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/records`,
      headers: authA.headers,
      payload: {
        old_title: 'Another Gizmo',
      },
    });
    expect(badReqRes.statusCode).toBe(400);

    const getProdRes = await server.inject({
      method: 'GET',
      url: `/api/entities/product/records/${prodId}`,
      headers: authA.headers,
    });
    expect(getProdRes.statusCode).toBe(200);
    const prodData = JSON.parse(getProdRes.payload);
    expect(prodData.new_title).toBe('Super Gizmo');
    expect(prodData.old_title).toBeUndefined();

    const createNewRes = await server.inject({
      method: 'POST',
      url: `/api/entities/product/records`,
      headers: authA.headers,
      payload: {
        new_title: 'Gizmo Pro',
      },
    });
    expect(createNewRes.statusCode).toBe(201);
    expect(JSON.parse(createNewRes.payload).new_title).toBe('Gizmo Pro');
  });

  // 9. Tenant isolation
  it('strictly isolates tenant data across schemas', async () => {
    const bCreateRes = await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authB.headers,
      payload: {
        full_name: 'Tenant B User',
        email: 'user@tenantb.com',
      },
    });
    expect(bCreateRes.statusCode).toBe(201);

    const aQueryRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
    });
    const aRecords = JSON.parse(aQueryRes.payload).data;
    expect(aRecords.some((r: any) => r.full_name === 'Tenant B User')).toBe(false);

    const bQueryRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/records`,
      headers: authB.headers,
    });
    const bRecords = JSON.parse(bQueryRes.payload).data;
    expect(bRecords.length).toBe(1);
    expect(bRecords[0].full_name).toBe('Tenant B User');
  });

  // 10. Delete record happy path
  it('deletes a record successfully when no foreign key constraints are violated', async () => {
    const deleteEmpRes = await server.inject({
      method: 'DELETE',
      url: `/api/entities/employee/records/${createdEmpId}`,
      headers: authA.headers,
    });
    expect(deleteEmpRes.statusCode).toBe(200);

    const deleteDeptRes = await server.inject({
      method: 'DELETE',
      url: `/api/entities/department/records/${createdDeptId}`,
      headers: authA.headers,
    });
    expect(deleteDeptRes.statusCode).toBe(200);
  });

  // 11. Aggregate endpoint validation
  it('calculates aggregate metrics and rejects non-whitelisted ops and fields', async () => {
    await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: { full_name: 'Agg Alice', email: 'alice.agg@example.com', age: 25 },
    });
    await server.inject({
      method: 'POST',
      url: `/api/entities/employee/records`,
      headers: authA.headers,
      payload: { full_name: 'Agg Bob', email: 'bob.agg@example.com', age: 35 },
    });

    const countRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=count`,
      headers: authA.headers,
    });
    expect(countRes.statusCode).toBe(200);
    const countBody = JSON.parse(countRes.payload);
    expect(countBody.op).toBe('count');
    expect(countBody.value).toBeGreaterThanOrEqual(2);

    const sumRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=sum&field=age`,
      headers: authA.headers,
    });
    expect(sumRes.statusCode).toBe(200);
    const sumBody = JSON.parse(sumRes.payload);
    expect(sumBody.op).toBe('sum');
    expect(sumBody.value).toBeGreaterThanOrEqual(60);

    const avgRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=avg&field=age`,
      headers: authA.headers,
    });
    expect(avgRes.statusCode).toBe(200);
    const avgBody = JSON.parse(avgRes.payload);
    expect(avgBody.op).toBe('avg');
    expect(typeof avgBody.value).toBe('number');

    const invalidOpRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=drop_table&field=age`,
      headers: authA.headers,
    });
    expect(invalidOpRes.statusCode).toBe(400);
    expect(JSON.parse(invalidOpRes.payload).message).toContain('Invalid aggregate operation');

    const invalidFieldRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=sum&field=nonexistent_field_xyz`,
      headers: authA.headers,
    });
    expect(invalidFieldRes.statusCode).toBe(400);
    expect(JSON.parse(invalidFieldRes.payload).message).toContain('not found in entity');

    const nonNumericRes = await server.inject({
      method: 'GET',
      url: `/api/entities/employee/aggregate?op=sum&field=full_name`,
      headers: authA.headers,
    });
    expect(nonNumericRes.statusCode).toBe(400);
    expect(JSON.parse(nonNumericRes.payload).message).toContain('requires a numeric field');
  });

  // 12. Display field on entity definition
  it('sets displayFieldId on an entity and returns it in schema entities', async () => {
    const nameField = await server.inject({
      method: 'GET',
      url: '/api/schema/entities',
      headers: authA.headers,
    });
    const tables = JSON.parse(nameField.payload);
    const empTable = tables.find((t: any) => t.name === 'employee');
    expect(empTable).toBeDefined();

    const fullNameCol = empTable.columns.find((c: any) => c.name === 'full_name');
    expect(fullNameCol).toBeDefined();

    const updateRes = await server.inject({
      method: 'PUT',
      url: `/api/schema/entities/${empTable.id}`,
      headers: authA.headers,
      payload: {
        expectedVersion: empTable.version,
        displayFieldId: fullNameCol.id,
      },
    });
    expect(updateRes.statusCode).toBe(200);

    const refetchRes = await server.inject({
      method: 'GET',
      url: '/api/schema/entities',
      headers: authA.headers,
    });
    const updatedTables = JSON.parse(refetchRes.payload);
    const updatedEmpTable = updatedTables.find((t: any) => t.id === empTable.id);
    expect(updatedEmpTable.displayFieldId).toBe(fullNameCol.id);
  });
});
