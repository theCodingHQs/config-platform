import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env from root or current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config(); // fallback to default

const { Pool } = pg;

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/config_platform_test';

export interface ParsedDbConnection {
  host: string;
  port: string;
  database: string;
}

/**
 * Extracts normalized host, port, and database name from a database URL.
 */
export function parseDbConnection(urlStr: string): ParsedDbConnection | null {
  try {
    const parsed = new URL(urlStr);
    let host = parsed.hostname.toLowerCase();
    // Normalize localhost aliases
    if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === 'localhost') {
      host = 'localhost';
    }
    // Normalize Neon pooler hostname if present: ep-xxx-pooler.region.neon.tech -> ep-xxx.region.neon.tech
    host = host.replace('-pooler.', '.');
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//, '').split('?')[0].trim().toLowerCase();
    return { host, port, database };
  } catch {
    return null;
  }
}

/**
 * Validates that the test database does not equal or point to the same host & database as the application database.
 */
export function assertTestDatabaseSafety(testUrl: string, appUrl?: string): void {
  if (!appUrl || !appUrl.trim()) return;

  const trimmedTest = testUrl.trim();
  const trimmedApp = appUrl.trim();

  if (trimmedTest === trimmedApp) {
    throw new Error(
      `Test startup refused: TEST_DATABASE_URL equals DATABASE_URL ("${trimmedTest}"). Tests must use an isolated test database.`
    );
  }

  const testParsed = parseDbConnection(trimmedTest);
  const appParsed = parseDbConnection(trimmedApp);

  if (testParsed && appParsed) {
    if (
      testParsed.host === appParsed.host &&
      testParsed.port === appParsed.port &&
      testParsed.database === appParsed.database
    ) {
      throw new Error(
        `Test startup refused: TEST_DATABASE_URL points to the same host and database (${testParsed.host}:${testParsed.port}/${testParsed.database}) as DATABASE_URL. Tests must use an isolated test database.`
      );
    }
  }
}

/**
 * Determine SSL configuration for pg Pool.
 */
export function getPoolSslConfig(url?: string): boolean | { rejectUnauthorized: boolean } {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get('sslmode');
    const ssl = parsed.searchParams.get('ssl');
    if (sslmode === 'disable' || ssl === 'false') {
      return false;
    }
    if (sslmode === 'require' || ssl === 'true') {
      return { rejectUnauthorized: false };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === 'host.docker.internal'
    ) {
      return false;
    }
    return { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

const isTest = process.env.NODE_ENV === 'test';

if (isTest) {
  const testDbUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  assertTestDatabaseSafety(testDbUrl, process.env.DATABASE_URL);
}

const databaseUrl = isTest
  ? process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL
  : process.env.DATABASE_URL;

if (!databaseUrl && !isTest) {
  console.warn('DATABASE_URL is not defined in environment variables or .env file');
}

export const DEFAULT_STATEMENT_TIMEOUT_MS = 10000;
export const MAX_STATEMENT_TIMEOUT_MS = 300000; // 5 minutes max

/**
 * Coerces statement timeout to a validated positive integer before SET LOCAL.
 * Fallbacks to default if invalid, non-integer, negative, or exceeding max.
 */
export function coerceStatementTimeout(
  timeoutMs: any,
  fallback: number = DEFAULT_STATEMENT_TIMEOUT_MS
): number {
  const parsed = typeof timeoutMs === 'number' ? timeoutMs : parseInt(String(timeoutMs), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_STATEMENT_TIMEOUT_MS) {
    return parsed;
  }
  return fallback;
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: getPoolSslConfig(databaseUrl),
});

export const ALLOWED_TEST_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'postgres',
  'config-platform-postgres',
  'config-platform-postgres-dev',
  'host.docker.internal',
]);

/**
 * Validates that destructive test DB operations (dropping schemas, resetting public)
 * run only if the database name ends with '_test' AND the host is localhost, 127.0.0.1,
 * or the docker-compose service name.
 * Throws before executing any destructive SQL unless ALLOW_TEST_DB_RESET=true is set.
 */
export function assertDestructiveTestDbResetAllowed(
  dbUrl: string,
  allowOverride: boolean = process.env.ALLOW_TEST_DB_RESET === 'true'
): void {
  if (allowOverride) {
    return;
  }

  const parsed = parseDbConnection(dbUrl);
  if (!parsed || !parsed.database) {
    throw new Error(
      `Destructive test DB reset refused: unable to parse database connection URL. To override, set ALLOW_TEST_DB_RESET=true.`
    );
  }

  if (!parsed.database.endsWith('_test')) {
    throw new Error(
      `Destructive test DB reset refused: database name "${parsed.database}" does not end with "_test". Destructive operations (dropping schemas, resetting public) are strictly blocked to protect non-test databases. To override, set ALLOW_TEST_DB_RESET=true.`
    );
  }

  const host = parsed.host.toLowerCase();
  if (!ALLOWED_TEST_DB_HOSTS.has(host)) {
    throw new Error(
      `Destructive test DB reset refused: host "${host}" is not localhost, 127.0.0.1, or the compose service name. Destructive operations are strictly blocked against remote hosts. To override, set ALLOW_TEST_DB_RESET=true.`
    );
  }
}

/**
 * Parses connection URL and removes '-pooler' only from the hostname.
 * Preserves user, password, port, pathname, and query params untouched.
 */
export function stripPoolerFromUrl(urlStr: string): string {
  if (!urlStr || !urlStr.trim()) return '';
  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname.includes('-pooler')) {
      parsed.hostname = parsed.hostname.replace('-pooler', '');
      return parsed.toString();
    }
    return urlStr;
  } catch {
    return urlStr;
  }
}

export function getDirectDatabaseUrl(): string {
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest) {
    const testUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
    return stripPoolerFromUrl(testUrl);
  }
  if (process.env.DATABASE_URL_DIRECT && process.env.DATABASE_URL_DIRECT.trim()) {
    return process.env.DATABASE_URL_DIRECT.trim();
  }
  const base = process.env.DATABASE_URL || '';
  return stripPoolerFromUrl(base);
}

export const directPool = new Pool({
  connectionString: getDirectDatabaseUrl(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: getPoolSslConfig(getDirectDatabaseUrl()),
});

/**
 * Execute query with SET LOCAL statement_timeout inside a transaction block
 */
export async function queryWithTimeout<T extends pg.QueryResultRow = any>(
  text: string,
  params: any[] = [],
  timeoutMs: number = DEFAULT_STATEMENT_TIMEOUT_MS
): Promise<T[]> {
  const safeTimeout = coerceStatementTimeout(timeoutMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${safeTimeout}`);
    const res = await client.query<T>(text, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
