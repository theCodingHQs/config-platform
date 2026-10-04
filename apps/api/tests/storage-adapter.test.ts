import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import crypto from 'node:crypto';

describe('StorageAdapter - Tenant Schema Isolation', () => {
  const testTenantId = `test_tenant_${crypto.randomBytes(3).toString('hex')}`;
  const schemaName = defaultStorageAdapter.getTenantSchemaName(testTenantId);

  beforeAll(async () => {
    await defaultStorageAdapter.initTenant(testTenantId);
  });

  afterAll(async () => {
    // Cleanup test schema
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  });

  it('provisions isolated Postgres schema for tenant', async () => {
    const exists = await defaultStorageAdapter.tenantSchemaExists(testTenantId);
    expect(exists).toBe(true);
  });

  it('executes queries within tenant schema context', async () => {
    const physicalTable = defaultStorageAdapter.getPhysicalTableName(testTenantId, 'test_table');
    await defaultStorageAdapter.executeDDL(
      testTenantId,
      `CREATE TABLE ${physicalTable} (id TEXT PRIMARY KEY, val TEXT);`
    );

    await defaultStorageAdapter.query(
      testTenantId,
      `INSERT INTO ${physicalTable} (id, val) VALUES ($1, $2)`,
      ['row_1', 'hello world']
    );

    const rows = await defaultStorageAdapter.query<{ id: string; val: string }>(
      testTenantId,
      `SELECT * FROM ${physicalTable} WHERE id = $1`,
      ['row_1']
    );

    expect(rows.length).toBe(1);
    expect(rows[0].val).toBe('hello world');
  });

  it('rolls back atomic transactions on failure without leaving partial state', async () => {
    const physicalTable = defaultStorageAdapter.getPhysicalTableName(testTenantId, 'test_table');
    const rollbackTable = defaultStorageAdapter.getPhysicalTableName(testTenantId, 'should_rollback');

    await expect(
      defaultStorageAdapter.transaction(testTenantId, async (tx) => {
        await tx.execute(`CREATE TABLE ${rollbackTable} (id TEXT PRIMARY KEY);`);
        await tx.query(`INSERT INTO ${physicalTable} (id, val) VALUES ($1, $2)`, ['row_2', 'temp']);
        throw new Error('Simulated failure during migration transaction');
      })
    ).rejects.toThrow('Simulated failure');

    // Verify row_2 was rolled back
    const rows = await defaultStorageAdapter.query(
      testTenantId,
      `SELECT * FROM ${physicalTable} WHERE id = $1`,
      ['row_2']
    );
    expect(rows.length).toBe(0);

    // Verify should_rollback table does not exist
    const client = await pool.connect();
    try {
      const tableCheck = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name = 'should_rollback'
         ) as exists`,
        [schemaName]
      );
      expect(tableCheck.rows[0].exists).toBe(false);
    } finally {
      client.release();
    }
  });
});
