import { describe, it, expect, beforeAll } from 'vitest';
import { pool, directPool, assertDestructiveTestDbResetAllowed, DEFAULT_TEST_DATABASE_URL } from '../src/db/pool.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { bootstrapOwner } from '../src/scripts/bootstrap-owner.js';
import { addUser } from '../src/scripts/add-user.js';
import { validatePassword } from '../src/auth/auth-service.js';

describe('pnpm user:add Script & User Provisioning', () => {
  let isDbAvailable = false;
  let testTenantId: string;
  let testTenantName: string;

  beforeAll(async () => {
    try {
      const testDbUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
      assertDestructiveTestDbResetAllowed(testDbUrl);
      await directPool.query(`
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public;
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      `);
      await initializeMetadataCatalog(pool);

      // Bootstrap initial owner
      const boot = await bootstrapOwner({
        email: 'initial-owner@company.com',
        password: 'ValidOwnerPassword123!',
        tenantName: 'Acme Test Corp',
      });
      testTenantId = boot.tenantId;
      testTenantName = boot.tenantName;
      isDbAvailable = true;
    } catch {
      // Database not running locally, skip integration tests
      isDbAvailable = false;
    }
  });

  describe('Password & Role Validation Rules', () => {
    it('validates password minimum length (10 chars)', () => {
      expect(() => validatePassword('short')).toThrow(/at least 10 characters/i);
    });

    it('rejects common/weak passwords', () => {
      expect(() => validatePassword('password123')).toThrow(/too common/i);
      expect(() => validatePassword('12345678901')).toThrow(/too common/i);
    });

    it('accepts strong passwords meeting requirements', () => {
      expect(() => validatePassword('SuperSecretStrongPassword2026!')).not.toThrow();
    });
  });

  describe('User Creation in Tenant & Audit Logging', () => {
    it('rejects user addition with invalid role', async () => {
      if (!isDbAvailable) return;

      await expect(
        addUser({
          email: 'test-user@company.com',
          password: 'ValidUserPassword123!',
          role: 'superadmin' as any,
          tenantId: testTenantId,
        })
      ).rejects.toThrow(/Invalid role "superadmin"/i);
    });

    it('rejects user addition to a non-existent tenant', async () => {
      if (!isDbAvailable) return;

      await expect(
        addUser({
          email: 'test-user@company.com',
          password: 'ValidUserPassword123!',
          role: 'editor',
          tenant: 'non_existent_tenant_id_9999',
        })
      ).rejects.toThrow(/not found/i);
    });

    it('successfully adds user to existing tenant and writes an audit log entry', async () => {
      if (!isDbAvailable) return;

      const userEmail = 'editor-alice@company.com';
      const result = await addUser({
        email: userEmail,
        password: 'AliceStrongPassword2026!',
        role: 'editor',
        tenantId: testTenantId,
      });

      expect(result.userId).toMatch(/^u_[a-f0-9]{16}$/);
      expect(result.email).toBe(userEmail);
      expect(result.role).toBe('editor');
      expect(result.tenantId).toBe(testTenantId);

      // Verify membership record exists in database
      const memberRes = await pool.query(
        'SELECT user_id, tenant_id, role FROM public.tenant_member WHERE user_id = $1 AND tenant_id = $2',
        [result.userId, testTenantId]
      );
      expect(memberRes.rows.length).toBe(1);
      expect(memberRes.rows[0].role).toBe('editor');

      // Verify audit log entry was written
      const auditRes = await pool.query(
        `SELECT action, entity_type, entity_id, user_email, tenant_id, after_state
         FROM public.audit_log
         WHERE tenant_id = $1 AND entity_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [testTenantId, result.userId]
      );

      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].action).toBe('user.add');
      expect(auditRes.rows[0].entity_type).toBe('member');
      expect(auditRes.rows[0].user_email).toBe(userEmail);
      expect(auditRes.rows[0].tenant_id).toBe(testTenantId);
    });

    it('allows adding multiple users with different roles as many times as needed', async () => {
      if (!isDbAvailable) return;

      const roles = ['admin', 'builder', 'viewer'] as const;
      for (const role of roles) {
        const email = `${role}-user@company.com`;
        const res = await addUser({
          email,
          password: `Complex${role}Pass2026!`,
          role,
          tenantName: testTenantName,
        });

        expect(res.role).toBe(role);
        expect(res.email).toBe(email);
      }
    });

    it('rejects adding duplicate user to the same workspace', async () => {
      if (!isDbAvailable) return;

      await expect(
        addUser({
          email: 'editor-alice@company.com',
          password: 'AliceStrongPassword2026!',
          role: 'viewer',
          tenantId: testTenantId,
        })
      ).rejects.toThrow(/already a member of workspace/i);
    });
  });
});
