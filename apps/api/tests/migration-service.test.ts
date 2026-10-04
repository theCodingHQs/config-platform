import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrationService, OptimisticLockError } from '../src/migrations/migration-service.js';
import { erdService } from '../src/schema/erd-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { UnsafeConversionError } from '../src/migrations/ddl-generator.js';
import crypto from 'node:crypto';

describe('Metadata Catalog & Migration Service', () => {
  const tenantId = `tenant_${crypto.randomBytes(3).toString('hex')}`;
  const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);

  beforeAll(async () => {
    // 1. Initialize public catalog
    await initializeMetadataCatalog(pool);
    // 2. Provision test tenant
    await migrationService.provisionTenant(tenantId, 'Acme Corp');
  });

  afterAll(async () => {
    // Cleanup tenant and its physical schema
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  });

  let customerEntityId: string;
  let orderEntityId: string;
  let emailFieldId: string;
  let ageFieldId: string;
  let statusFieldId: string;
  let customerRefFieldId: string;

  it('provisions tenant and initializes schema', async () => {
    const tenantExists = await defaultStorageAdapter.tenantSchemaExists(tenantId);
    expect(tenantExists).toBe(true);

    const res = await pool.query(`SELECT * FROM public.tenant WHERE id = $1`, [tenantId]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe('Acme Corp');
  });

  it('creates an entity with stable table ID and physical projection', async () => {
    const result = await migrationService.createEntity(tenantId, {
      name: 'customer',
      label: 'Customer',
      fields: [
        {
          name: 'email',
          label: 'Email Address',
          type: 'text',
          required: true,
          unique: true,
        },
        {
          name: 'age',
          label: 'Age',
          type: 'number',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe(1);
    expect(result.entity.id).toMatch(/^t_[a-f0-9]{8}$/);
    expect(result.entity.physicalTableName).toBe(result.entity.id);
    expect(result.fields.length).toBe(2);

    customerEntityId = result.entity.id;
    emailFieldId = result.fields.find((f) => f.name === 'email')!.id;
    ageFieldId = result.fields.find((f) => f.name === 'age')!.id;

    expect(emailFieldId).toMatch(/^c_[a-f0-9]{8}$/);
    expect(ageFieldId).toMatch(/^c_[a-f0-9]{8}$/);

    // Verify physical table in tenant Postgres schema
    const checkTable = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, customerEntityId]
    );
    expect(checkTable.rows.length).toBe(1);

    // Verify physical columns: id, created_at, updated_at, emailCol, ageCol
    const checkCols = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, customerEntityId]
    );
    const colNames = checkCols.rows.map((r) => r.column_name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain(emailFieldId);
    expect(colNames).toContain(ageFieldId);
  });

  it('adds fields to existing entity and increments version', async () => {
    const addResult = await migrationService.addField(tenantId, {
      entityId: customerEntityId,
      expectedVersion: 1,
      name: 'status',
      label: 'Customer Status',
      type: 'select',
      config: {
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ],
      },
    });

    expect(addResult.success).toBe(true);
    expect(addResult.field.id).toMatch(/^c_[a-f0-9]{8}$/);
    statusFieldId = addResult.field.id;

    // Verify entity version is now 2
    const entityCheck = await pool.query(
      `SELECT version FROM public.entity_def WHERE id = $1`,
      [customerEntityId]
    );
    expect(entityCheck.rows[0].version).toBe(2);
  });

  it('enforces optimistic locking on entity version mismatch', async () => {
    // Attempting to add a field with stale expectedVersion 1 (current is 2)
    await expect(
      migrationService.addField(tenantId, {
        entityId: customerEntityId,
        expectedVersion: 1,
        name: 'should_fail',
        label: 'Should Fail',
        type: 'text',
      })
    ).rejects.toThrow(OptimisticLockError);
  });

  it('preserves stable column ID during label/name renames', async () => {
    const currentVersion = 2;
    const renameResult = await migrationService.updateField(tenantId, {
      entityId: customerEntityId,
      fieldId: emailFieldId,
      expectedVersion: currentVersion,
      label: 'Primary Work Email',
      name: 'work_email',
    });

    expect(renameResult.success).toBe(true);
    expect(renameResult.field.id).toBe(emailFieldId);
    expect(renameResult.field.physicalColumnName).toBe(emailFieldId);
    expect(renameResult.field.label).toBe('Primary Work Email');
    expect(renameResult.field.name).toBe('work_email');

    // Physical column name in DB should STILL be emailFieldId
    const checkCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schemaName, customerEntityId, emailFieldId]
    );
    expect(checkCols.rows.length).toBe(1);
  });

  it('performs expand/contract migration for type change with data preservation', async () => {
    const custTable = defaultStorageAdapter.getPhysicalTableName(tenantId, customerEntityId);

    // First, let's insert a test customer row with numeric age
    await defaultStorageAdapter.query(
      tenantId,
      `INSERT INTO ${custTable} ("${emailFieldId}", "${ageFieldId}") VALUES ($1, $2)`,
      ['alice@example.com', 29]
    );

    // Current entity version is 3 (1 initial, 2 after status add, 3 after email rename)
    const entityRow = await pool.query(
      `SELECT version FROM public.entity_def WHERE id = $1`,
      [customerEntityId]
    );
    const ver = entityRow.rows[0].version;

    // Change age field type from 'number' to 'text' (expand -> backfill -> contract)
    const updateResult = await migrationService.updateField(tenantId, {
      entityId: customerEntityId,
      fieldId: ageFieldId,
      expectedVersion: ver,
      type: 'text',
      label: 'Age (Text)',
    });

    expect(updateResult.success).toBe(true);
    expect(updateResult.field.type).toBe('text');

    // Verify existing data is preserved!
    const row = await defaultStorageAdapter.query<{ [key: string]: any }>(
      tenantId,
      `SELECT "${ageFieldId}" FROM ${custTable} WHERE "${emailFieldId}" = $1`,
      ['alice@example.com']
    );
    expect(row[0][ageFieldId]).toBe('29');

    // Check physical column type in Postgres
    const colTypeRes = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schemaName, customerEntityId, ageFieldId]
    );
    expect(colTypeRes.rows[0].data_type).toBe('text');
  });

  it('rejects unsafe type conversion if existing data cannot be converted', async () => {
    const custTable = defaultStorageAdapter.getPhysicalTableName(tenantId, customerEntityId);

    // Insert non-numeric string into the age text column
    await defaultStorageAdapter.query(
      tenantId,
      `INSERT INTO ${custTable} ("${emailFieldId}", "${ageFieldId}") VALUES ($1, $2)`,
      ['bob@example.com', 'twenty-five']
    );

    const ver = (
      await pool.query(`SELECT version FROM public.entity_def WHERE id = $1`, [customerEntityId])
    ).rows[0].version;

    // Attempting to convert 'text' back to 'number' must fail because 'twenty-five' is not a number!
    await expect(
      migrationService.updateField(tenantId, {
        entityId: customerEntityId,
        fieldId: ageFieldId,
        expectedVersion: ver,
        type: 'number',
      })
    ).rejects.toThrow(UnsafeConversionError);

    // Verify column is still text and data is intact
    const colTypeRes = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schemaName, customerEntityId, ageFieldId]
    );
    expect(colTypeRes.rows[0].data_type).toBe('text');
  });

  it('creates reference fields and foreign key relations', async () => {
    // 1. Create second entity: Order
    const orderRes = await migrationService.createEntity(tenantId, {
      name: 'order',
      label: 'Sales Order',
      fields: [
        {
          name: 'order_number',
          label: 'Order #',
          type: 'text',
          required: true,
        },
        {
          name: 'customer_id',
          label: 'Customer',
          type: 'reference',
          config: {
            targetEntityId: customerEntityId,
          },
        },
      ],
    });

    orderEntityId = orderRes.entity.id;
    customerRefFieldId = orderRes.fields.find((f) => f.name === 'customer_id')!.id;

    // 2. Add relation constraint
    const relRes = await migrationService.addRelation(tenantId, {
      name: 'order_customer_fk',
      sourceEntityId: orderEntityId,
      sourceFieldId: customerRefFieldId,
      targetEntityId: customerEntityId,
      relationType: 'many_to_one',
      onDelete: 'CASCADE',
    });

    expect(relRes.success).toBe(true);
    expect(relRes.relation.id).toMatch(/^r_[a-f0-9]{8}$/);

    // Verify physical foreign key constraint exists in Postgres
    const fkCheck = await pool.query(
      `SELECT conname FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = $1 AND conname = $2`,
      [schemaName, `fk_${relRes.relation.id}`]
    );
    expect(fkCheck.rows.length).toBe(1);
  });

  it('derives live ERD graph and live DDL from metadata catalog', async () => {
    const erd = await erdService.getLiveErd(tenantId);
    expect(erd.tenantId).toBe(tenantId);
    expect(erd.tables.length).toBe(2);

    const customerTable = erd.tables.find((t) => t.id === customerEntityId);
    const orderTable = erd.tables.find((t) => t.id === orderEntityId);

    expect(customerTable).toBeDefined();
    expect(orderTable).toBeDefined();
    expect(erd.relationships.length).toBe(1);
    expect(erd.relationships[0].fromTable).toBe(orderEntityId);
    expect(erd.relationships[0].toTable).toBe(customerEntityId);

    // Live DDL projection
    const ddl = await erdService.getLiveDDL(tenantId);
    expect(ddl).toContain(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${schemaName}"."${customerEntityId}"`);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${schemaName}"."${orderEntityId}"`);
    expect(ddl).toContain(`ALTER TABLE "${schemaName}"."${orderEntityId}" ADD CONSTRAINT`);
  });

  it('records schema migration history for every atomic operation', async () => {
    const migrations = await migrationService.getMigrations(tenantId);
    expect(migrations.length).toBeGreaterThanOrEqual(4);

    // Ensure sequential version numbering
    for (let i = 0; i < migrations.length; i++) {
      expect(migrations[i].version).toBe(i + 1);
      expect(migrations[i].status).toBe('applied');
      expect(migrations[i].ddl).toBeDefined();
    }
  });
});
