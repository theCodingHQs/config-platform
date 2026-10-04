import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertTestDatabaseSafety,
  assertDestructiveTestDbResetAllowed,
  stripPoolerFromUrl,
  parseDbConnection,
  DEFAULT_TEST_DATABASE_URL,
} from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '..');

describe('Database Pool Environment Validation', () => {
  describe('assertTestDatabaseSafety unit validation', () => {
    it('throws when TEST_DATABASE_URL is identical to DATABASE_URL', () => {
      const url = 'postgres://user:password@localhost:5432/mydb';
      expect(() => assertTestDatabaseSafety(url, url)).toThrow(
        /TEST_DATABASE_URL equals DATABASE_URL/
      );
    });

    it('throws when TEST_DATABASE_URL points to the same host and database', () => {
      const appUrl = 'postgres://app_user:secret@localhost:5432/my_app_db';
      const testUrl = 'postgres://test_user:different@127.0.0.1:5432/my_app_db';
      expect(() => assertTestDatabaseSafety(testUrl, appUrl)).toThrow(
        /points to the same host and database/
      );
    });

    it('throws when host is normalized (e.g. Neon pooler vs direct)', () => {
      const appUrl =
        'postgresql://owner:pass@ep-cool-leaf-12345-pooler.us-east-1.aws.neon.tech/neondb';
      const testUrl =
        'postgresql://owner:pass@ep-cool-leaf-12345.us-east-1.aws.neon.tech/neondb';
      expect(() => assertTestDatabaseSafety(testUrl, appUrl)).toThrow(
        /points to the same host and database/
      );
    });

    it('passes when TEST_DATABASE_URL points to a different database on the same host', () => {
      const appUrl = 'postgres://postgres:postgres@localhost:5432/config_platform';
      const testUrl = 'postgres://postgres:postgres@localhost:5432/config_platform_test';
      expect(() => assertTestDatabaseSafety(testUrl, appUrl)).not.toThrow();
    });

    it('passes when DATABASE_URL is not set', () => {
      const testUrl = 'postgres://postgres:postgres@localhost:5432/config_platform_test';
      expect(() => assertTestDatabaseSafety(testUrl, undefined)).not.toThrow();
      expect(() => assertTestDatabaseSafety(testUrl, '')).not.toThrow();
    });
  });

  describe('parseDbConnection unit validation', () => {
    it('normalizes localhost and 127.0.0.1', () => {
      const p1 = parseDbConnection('postgresql://user:pass@localhost:5432/dbname');
      const p2 = parseDbConnection('postgresql://user:pass@127.0.0.1:5432/dbname');
      expect(p1?.host).toBe('localhost');
      expect(p2?.host).toBe('localhost');
      expect(p1?.database).toBe('dbname');
      expect(p2?.database).toBe('dbname');
    });

    it('normalizes Neon pooler suffix', () => {
      const parsed = parseDbConnection(
        'postgresql://user:pass@ep-app-pooler.c-4.neon.tech/mydb?sslmode=require'
      );
      expect(parsed?.host).toBe('ep-app.c-4.neon.tech');
      expect(parsed?.database).toBe('mydb');
    });
  });

  describe('stripPoolerFromUrl unit validation', () => {
    it('strips -pooler strictly from the hostname and preserves other components', () => {
      const url =
        'postgresql://user-pooler:pass-pooler@ep-patient-leaf-123-pooler.c-4.neon.tech:5432/my-pooler-db?param=pooler';
      const stripped = stripPoolerFromUrl(url);
      expect(stripped).toContain('ep-patient-leaf-123.c-4.neon.tech');
      expect(stripped).not.toContain('ep-patient-leaf-123-pooler');
      // Verify credentials, path, and query parameters were untouched
      expect(stripped).toContain('user-pooler:pass-pooler');
      expect(stripped).toContain('/my-pooler-db');
      expect(stripped).toContain('param=pooler');
    });

    it('leaves non-pooler URLs unchanged', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/config_platform_test';
      expect(stripPoolerFromUrl(url)).toBe(url);
    });
  });

  describe('assertDestructiveTestDbResetAllowed safety validation', () => {
    it('refuses reset when database name does not end with _test on localhost', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/config_platform';
      expect(() => assertDestructiveTestDbResetAllowed(url)).toThrow(
        /database name "config_platform" does not end with "_test"/
      );
    });

    it('refuses reset when host is remote even if database ends with _test', () => {
      const url = 'postgresql://user:pass@ep-remote.c-4.neon.tech:5432/my_app_test';
      expect(() => assertDestructiveTestDbResetAllowed(url)).toThrow(
        /is not localhost, 127.0.0.1, or the compose service name/
      );
    });

    it('refuses reset when both host is remote and database does not end with _test', () => {
      const url = 'postgresql://user:pass@ep-remote.c-4.neon.tech:5432/production';
      expect(() => assertDestructiveTestDbResetAllowed(url)).toThrow();
    });

    it('refuses reset when connection string is unparseable', () => {
      expect(() => assertDestructiveTestDbResetAllowed('not-a-valid-url')).toThrow(
        /unable to parse database connection URL/
      );
    });

    it('allows reset when host is localhost and database ends with _test', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/config_platform_test';
      expect(() => assertDestructiveTestDbResetAllowed(url)).not.toThrow();
    });

    it('allows reset when host is 127.0.0.1 and database ends with _test', () => {
      const url = 'postgresql://postgres:postgres@127.0.0.1:5432/test_db_test';
      expect(() => assertDestructiveTestDbResetAllowed(url)).not.toThrow();
    });

    it('allows reset when host is compose service name (e.g. postgres)', () => {
      const url = 'postgresql://postgres:postgres@postgres:5432/config_platform_test';
      expect(() => assertDestructiveTestDbResetAllowed(url)).not.toThrow();
    });

    it('allows reset on remote or non-_test DB when ALLOW_TEST_DB_RESET=true override is set', () => {
      const remoteUrl = 'postgresql://user:pass@ep-remote.c-4.neon.tech:5432/production';
      expect(() => assertDestructiveTestDbResetAllowed(remoteUrl, true)).not.toThrow();
    });
  });

  describe('Runtime Startup Behavior in Test Mode', () => {
    it('defaults TEST_DATABASE_URL to local postgres if unset and allows startup when DATABASE_URL is different', () => {
      const testCode = `
        (async () => {
          process.env.NODE_ENV = 'test';
          delete process.env.TEST_DATABASE_URL;
          delete process.env.TEST_DATABASE_URL_DIRECT;
          process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/config_platform_dev';
          try {
            const { getDirectDatabaseUrl, pool, DEFAULT_TEST_DATABASE_URL } = await import('./src/db/pool.ts');
            if (getDirectDatabaseUrl() !== DEFAULT_TEST_DATABASE_URL) {
              throw new Error('Expected default test database url');
            }
            console.log('SUCCESS_DEFAULT_URL');
            process.exit(0);
          } catch (err) {
            console.error('ERROR: ' + err.message);
            process.exit(1);
          }
        })();
      `;

      const output = execSync(`npx tsx -e "${testCode.replace(/\n/g, ' ')}"`, {
        cwd: apiRoot,
        stdio: 'pipe',
      }).toString();
      expect(output).toContain('SUCCESS_DEFAULT_URL');
    });

    it('refuses to run when TEST_DATABASE_URL equals DATABASE_URL', () => {
      const testCode = `
        (async () => {
          process.env.NODE_ENV = 'test';
          const sameUrl = 'postgresql://user:secret@localhost:5432/same_db';
          process.env.DATABASE_URL = sameUrl;
          process.env.TEST_DATABASE_URL = sameUrl;
          try {
            await import('./src/db/pool.ts');
            console.log('UNEXPECTED_SUCCESS');
            process.exit(0);
          } catch (err) {
            console.error('EXPECTED_ERROR: ' + err.message);
            process.exit(1);
          }
        })();
      `;

      try {
        execSync(`npx tsx -e "${testCode.replace(/\n/g, ' ')}"`, {
          cwd: apiRoot,
          stdio: 'pipe',
        });
        expect.fail('Should have refused to run');
      } catch (err: any) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        expect(stderr).toContain('TEST_DATABASE_URL equals DATABASE_URL');
      }
    });

    it('refuses to run when TEST_DATABASE_URL points to the same host and database as DATABASE_URL', () => {
      const testCode = `
        (async () => {
          process.env.NODE_ENV = 'test';
          process.env.DATABASE_URL = 'postgresql://user1:pass1@127.0.0.1:5432/collision_db';
          process.env.TEST_DATABASE_URL = 'postgresql://user2:pass2@localhost:5432/collision_db';
          try {
            await import('./src/db/pool.ts');
            console.log('UNEXPECTED_SUCCESS');
            process.exit(0);
          } catch (err) {
            console.error('EXPECTED_ERROR: ' + err.message);
            process.exit(1);
          }
        })();
      `;

      try {
        execSync(`npx tsx -e "${testCode.replace(/\n/g, ' ')}"`, {
          cwd: apiRoot,
          stdio: 'pipe',
        });
        expect.fail('Should have refused to run');
      } catch (err: any) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        expect(stderr).toContain('points to the same host and database');
      }
    });

    it('in non-test mode, DATABASE_URL_DIRECT is optional and defaults to DATABASE_URL', () => {
      const testCode = `
        (async () => {
          process.env.NODE_ENV = 'production';
          process.env.DATABASE_URL = 'postgresql://prod_user:prod_pass@prod-host:5432/prod_db';
          process.env.DATABASE_URL_DIRECT = '';
          try {
            const { getDirectDatabaseUrl } = await import('./src/db/pool.ts');
            const direct = getDirectDatabaseUrl();
            if (direct !== process.env.DATABASE_URL) {
              throw new Error('DATABASE_URL_DIRECT did not default to DATABASE_URL: ' + direct);
            }
            console.log('SUCCESS_DIRECT_DEFAULT');
            process.exit(0);
          } catch (err) {
            console.error('ERROR: ' + err.message);
            process.exit(1);
          }
        })();
      `;

      const output = execSync(`npx tsx -e "${testCode.replace(/\n/g, ' ')}"`, {
        cwd: apiRoot,
        stdio: 'pipe',
      }).toString();
      expect(output).toContain('SUCCESS_DIRECT_DEFAULT');
    });

    it('confirms that when DATABASE_URL is a Neon pooled URL, migrations still use the non-pooler host', () => {
      const testCode = `
        (async () => {
          process.env.NODE_ENV = 'production';
          process.env.DATABASE_URL = 'postgresql://neondb_owner:pass@ep-patient-leaf-123-pooler.c-4.neon.tech/neondb?sslmode=require';
          process.env.DATABASE_URL_DIRECT = '';
          try {
            const { getDirectDatabaseUrl } = await import('./src/db/pool.ts');
            const direct = getDirectDatabaseUrl();
            const expected = 'postgresql://neondb_owner:pass@ep-patient-leaf-123.c-4.neon.tech/neondb?sslmode=require';
            if (direct !== expected) {
              throw new Error('Expected non-pooler URL ' + expected + ' but got ' + direct);
            }
            console.log('SUCCESS_NEON_NON_POOLER');
            process.exit(0);
          } catch (err) {
            console.error('ERROR: ' + err.message);
            process.exit(1);
          }
        })();
      `;

      const output = execSync(`npx tsx -e "${testCode.replace(/\n/g, ' ')}"`, {
        cwd: apiRoot,
        stdio: 'pipe',
      }).toString();
      expect(output).toContain('SUCCESS_NEON_NON_POOLER');
    });

    it('global setup and teardown hooks are exported and teardown executes safely', async () => {
      const { setup, teardown } = await import('./global-setup.js');
      expect(typeof setup).toBe('function');
      expect(typeof teardown).toBe('function');
      // Calling teardown is safe and idempotent
      await expect(teardown()).resolves.not.toThrow();
    });
  });
});

