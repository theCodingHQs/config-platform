import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool, coerceStatementTimeout } from './pool.js';

export const trackedSchemasCreatedInRun = new Set<string>();

export interface TenantTransaction {
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T[]>;
  execute(ddl: string): Promise<void>;
  client: PoolClient;
  tenantId: string;
  schemaName: string;
}

export interface StorageAdapter {
  initTenant(tenantId: string): Promise<void>;
  tenantSchemaExists(tenantId: string): Promise<boolean>;
  getTenantSchemaName(tenantId: string): string;
  getPhysicalTableName(tenantId: string, stableTableId: string): string;
  getPhysicalColumnName(stableColumnId: string): string;
  query<T extends QueryResultRow = any>(tenantId: string, text: string, params?: any[], timeoutMs?: number): Promise<T[]>;
  executeDDL(tenantId: string, ddl: string, timeoutMs?: number): Promise<void>;
  transaction<T>(tenantId: string, callback: (tx: TenantTransaction) => Promise<T>, timeoutMs?: number): Promise<T>;
}

export class PostgresSchemaStorageAdapter implements StorageAdapter {
  private dbPool: Pool;

  constructor(customPool?: Pool) {
    this.dbPool = customPool || pool;
  }

  getTenantSchemaName(tenantId: string): string {
    // Sanitize tenant ID into a safe postgres identifier: t_<cleanTenantId>
    const clean = tenantId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    return `t_${clean}`;
  }

  getPhysicalTableName(tenantId: string, stableTableId: string): string {
    const schema = this.getTenantSchemaName(tenantId);
    return `"${schema}"."${stableTableId}"`;
  }

  getPhysicalColumnName(stableColumnId: string): string {
    return `"${stableColumnId}"`;
  }

  async initTenant(tenantId: string): Promise<void> {
    const schemaName = this.getTenantSchemaName(tenantId);
    trackedSchemasCreatedInRun.add(schemaName);
    await this.dbPool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  }

  async tenantSchemaExists(tenantId: string): Promise<boolean> {
    const schemaName = this.getTenantSchemaName(tenantId);
    const result = await this.dbPool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) as exists`,
      [schemaName]
    );
    return Boolean(result.rows[0]?.exists);
  }

  async query<T extends QueryResultRow = any>(
    tenantId: string,
    text: string,
    params: any[] = [],
    timeoutMs: number = 10000
  ): Promise<T[]> {
    const schemaName = this.getTenantSchemaName(tenantId);
    const client = await this.dbPool.connect();
    const safeTimeout = coerceStatementTimeout(timeoutMs);
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${safeTimeout}`);
      // Set search_path so unqualified references resolve in tenant schema, fallback to public
      await client.query(`SET search_path TO "${schemaName}", public`);
      const res = await client.query<T>(text, params);
      await client.query('COMMIT');
      return res.rows;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      try {
        await client.query(`SET search_path TO public`);
      } catch {}
      client.release();
    }
  }

  async executeDDL(tenantId: string, ddl: string, timeoutMs: number = 10000): Promise<void> {
    const schemaName = this.getTenantSchemaName(tenantId);
    const client = await this.dbPool.connect();
    const safeTimeout = coerceStatementTimeout(timeoutMs);
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${safeTimeout}`);
      await client.query(`SET search_path TO "${schemaName}", public`);
      await client.query(ddl);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      try {
        await client.query(`SET search_path TO public`);
      } catch {}
      client.release();
    }
  }

  async transaction<T>(
    tenantId: string,
    callback: (tx: TenantTransaction) => Promise<T>,
    timeoutMs: number = 10000
  ): Promise<T> {
    const schemaName = this.getTenantSchemaName(tenantId);
    const client = await this.dbPool.connect();
    const safeTimeout = coerceStatementTimeout(timeoutMs);
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${safeTimeout}`);

      // Tenant-level transaction advisory lock to guarantee serial execution across concurrent workers
      // hashtext generates a 32-bit integer from string
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`tenant_${tenantId}`]);

      // Set tenant schema context
      await client.query(`SET search_path TO "${schemaName}", public`);

      const tx: TenantTransaction = {
        tenantId,
        schemaName,
        client,
        query: async <R extends QueryResultRow = any>(text: string, params: any[] = []): Promise<R[]> => {
          const res = await client.query<R>(text, params);
          return res.rows;
        },
        execute: async (ddl: string): Promise<void> => {
          await client.query(ddl);
        },
      };

      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      try {
        await client.query(`SET search_path TO public`);
      } catch {
        // ignore reset error on closed connection
      }
      client.release();
    }
  }
}

export const defaultStorageAdapter = new PostgresSchemaStorageAdapter();
