import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  assertTestDatabaseSafety,
  assertDestructiveTestDbResetAllowed,
  DEFAULT_TEST_DATABASE_URL,
  getPoolSslConfig,
  parseDbConnection,
} from '../src/db/pool.js';
import { trackedSchemasCreatedInRun } from '../src/db/storage-adapter.js';
import { runCatalogMigrations } from '../src/db/catalog-migration-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config();

const PROTECTED_SYSTEM_SCHEMAS = new Set([
  'pg_catalog',
  'information_schema',
  'public',
  'pg_toast',
]);

let initialSchemas = new Set<string>();
let isTornDown = false;

function isProtectedSchema(name: string): boolean {
  if (PROTECTED_SYSTEM_SCHEMAS.has(name)) return true;
  if (name.startsWith('pg_toast')) return true;
  if (name.startsWith('pg_temp')) return true;
  return false;
}

async function getTestDbClient(testDbUrl: string): Promise<pg.Client | null> {
  const ssl = getPoolSslConfig(testDbUrl);
  const client = new pg.Client({
    connectionString: testDbUrl,
    ssl,
  });

  try {
    await client.connect();
    return client;
  } catch (err: any) {
    // If database does not exist (PostgreSQL error 3D000), try auto-creating it via 'postgres' maintenance db
    if (err.code === '3D000') {
      const parsed = parseDbConnection(testDbUrl);
      if (parsed && parsed.database) {
        try {
          const maintenanceUrl = testDbUrl.replace(
            `/${parsed.database}`,
            '/postgres'
          );
          const maintClient = new pg.Client({
            connectionString: maintenanceUrl,
            ssl,
          });
          await maintClient.connect();
          await maintClient.query(`CREATE DATABASE "${parsed.database}"`);
          await maintClient.end();

          const retryClient = new pg.Client({
            connectionString: testDbUrl,
            ssl,
          });
          await retryClient.connect();
          return retryClient;
        } catch {
          // If auto-creation fails, bubble original error
        }
      }
    }
    throw err;
  }
}

/**
 * Global test setup:
 * 1. Strictly asserts that TEST_DATABASE_URL does not equal or point to the same host/db as DATABASE_URL.
 * 2. Asserts that destructive operations are allowed (database ends in _test and host is local/compose).
 * 3. Takes a snapshot of existing schemas and cleans leftover tenant schemas from interrupted runs.
 */
export async function setup() {
  const testDbUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

  // 1. Refuse to run if TEST_DATABASE_URL equals DATABASE_URL or points to the same host and database
  assertTestDatabaseSafety(testDbUrl, process.env.DATABASE_URL);

  // 2. Destructive safety assertion before touching anything
  assertDestructiveTestDbResetAllowed(testDbUrl);

  // 3. Snapshot existing schemas and clean leftovers
  try {
    const client = await getTestDbClient(testDbUrl);
    if (client) {
      try {
        const res = await client.query<{ schema_name: string }>(
          `SELECT schema_name FROM information_schema.schemata`
        );
        initialSchemas = new Set(res.rows.map((r) => r.schema_name));

        // Clean any leftover tenant schemas from previously interrupted runs
        for (const schema of res.rows.map((r) => r.schema_name)) {
          if (schema.startsWith('t_') && !isProtectedSchema(schema)) {
            await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
          }
        }
      } finally {
        await client.end();
      }
    }
  } catch (err: any) {
    console.warn(
      `[global-setup] Could not snapshot initial schemas from test database: ${err.message}`
    );
  }

  return async () => {
    await teardown();
  };
}

/**
 * Global test teardown:
 * 1. Validates destructive safety guard before touching anything.
 * 2. Drops every schema created during the test run (CASCADE), even when a test fails.
 * 3. Resets the test DB's public schema, recreates required extensions, and verifies migrations run cleanly from empty.
 */
export async function teardown() {
  if (isTornDown) return;
  isTornDown = true;

  const testDbUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

  // 1. Guard against destructive reset on non-test or remote databases
  assertDestructiveTestDbResetAllowed(testDbUrl);

  let client: pg.Client | null = null;
  try {
    client = await getTestDbClient(testDbUrl);
    if (!client) return;

    // 2. Drop all tenant and newly created schemas
    const res = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata`
    );
    const currentSchemas = res.rows.map((r) => r.schema_name);

    for (const schema of currentSchemas) {
      if (isProtectedSchema(schema)) continue;

      // Drop if it was created during this run, tracked, or is a tenant test schema (t_*)
      if (
        !initialSchemas.has(schema) ||
        trackedSchemasCreatedInRun.has(schema) ||
        schema.startsWith('t_')
      ) {
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } catch (dropErr: any) {
          console.warn(`[global-teardown] Failed to drop schema "${schema}":`, dropErr.message);
        }
      }
    }

    // Also drop any tracked schemas that might not have been in schemata query
    for (const schema of trackedSchemasCreatedInRun) {
      if (!isProtectedSchema(schema)) {
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } catch {}
      }
    }
    trackedSchemasCreatedInRun.clear();

    // 3. Reset the test DB's public schema between runs
    await client.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);

    // 4. Recreate extensions if needed
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    } catch {}
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    } catch {}

    // 5. Verify migrations run cleanly from empty
    const verifyPool = new pg.Pool({
      connectionString: testDbUrl,
      ssl: getPoolSslConfig(testDbUrl),
      max: 2,
    });
    try {
      const migrationReport = await runCatalogMigrations(verifyPool);
      if (!migrationReport.success) {
        throw new Error('Migrations failed to run cleanly on empty public schema during global teardown');
      }
    } finally {
      await verifyPool.end();
    }
  } catch (err: any) {
    console.warn(`[global-teardown] Error during teardown schema cleanup:`, err.message);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {}
    }
  }
}
