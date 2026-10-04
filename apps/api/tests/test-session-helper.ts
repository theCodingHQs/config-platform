/**
 * Test helper: creates a real user/tenant/session in the DB and returns
 * a cookie string that can be passed to server.inject() calls.
 *
 * Also returns a CSRF token for mutation requests.
 *
 * Usage:
 *   const auth = await createTestSession(tenantId, 'owner');
 *   server.inject({ headers: auth.headers, ... });
 */

import crypto from 'node:crypto';
import argon2 from 'argon2';
import { pool } from '../src/db/pool.js';
import { authService } from '../src/auth/auth-service.js';
import type { TenantRole } from '../src/auth/auth-types.js';

let cachedArgon2Hash: string | null = null;
async function getTestPasswordHash(): Promise<string> {
  if (!cachedArgon2Hash) {
    cachedArgon2Hash = await argon2.hash('TestPassword123!');
  }
  return cachedArgon2Hash;
}

export interface TestSession {
  userId: string;
  tenantId: string;
  role: TenantRole;
  email: string;
  sessionId: string;
  /** Headers object to spread into server.inject() calls */
  headers: Record<string, string>;
  /** Cookie header string (for manual use) */
  cookieHeader: string;
}

/**
 * Ensures a tenant exists, creates a user with the given role, creates a session,
 * and returns headers ready for inject().
 *
 * @param tenantId - The tenant to associate the user with. Must already exist.
 * @param role - The role to grant.
 * @param emailPrefix - Optional prefix to make the email unique.
 */
export async function createTestSession(
  tenantId: string,
  role: TenantRole,
  emailPrefix = 'test'
): Promise<TestSession> {
  const email = `${emailPrefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
  const userId = `u_${crypto.randomBytes(8).toString('hex')}`;
  const passwordHash = await getTestPasswordHash();

  await pool.query(
    `INSERT INTO public.app_user (id, email, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (email) DO NOTHING`,
    [userId, email, passwordHash]
  );

  // Fetch the actual user id (in case email already existed)
  const userRes = await pool.query(`SELECT id FROM public.app_user WHERE email = $1`, [email]);
  const actualUserId = userRes.rows[0]?.id || userId;

  await pool.query(
    `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
    [actualUserId, tenantId, role]
  );

  const session = await authService.createSession(actualUserId, tenantId, role, email);
  const csrfToken = crypto.randomBytes(32).toString('hex');

  const cookieHeader = `sid=${session.sessionId}; csrf_token=${csrfToken}`;

  return {
    userId: actualUserId,
    tenantId,
    role,
    email,
    sessionId: session.sessionId,
    cookieHeader,
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
      'content-type': 'application/json',
    },
  };
}

/**
 * Cleanup: removes test sessions, members, and users created during tests.
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  await pool.query(`DELETE FROM public.app_session WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM public.tenant_member WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM public.app_user WHERE id = $1`, [userId]);
}
