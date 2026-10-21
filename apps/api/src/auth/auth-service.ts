/**
 * AuthService: handles signup, login, logout, invite flow, role management.
 * Password hashing via argon2. Sessions stored in public.app_session.
 * Password reset is stubbed – link is logged in dev.
 */

import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { migrationService } from '../migrations/migration-service.js';
import { defaultEmailVerifier, defaultEmailSender } from './email-verifier.js';
import type { AppUser, SessionPayload, TenantRole } from './auth-types.js';
import { isValidRole } from './auth-types.js';

// Dynamically import argon2 so test environments without native can still load the module
let argon2: typeof import('argon2');
async function getArgon2() {
  if (!argon2) {
    argon2 = await import('argon2');
  }
  return argon2;
}

export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';
const SESSION_TTL_HOURS = 24 * 7; // 7 days

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const COMMON_PASSWORDS = new Set([
  '1234567890',
  'password123',
  'admin12345',
  'qwertyuiop',
  '12345678901',
  'password1234',
  'welcome1234',
  'letmein1234',
  'changeme123',
  'iloveyou123',
  'abc1234567',
  'adminadmin1',
  'passcode123',
  'monkey12345',
  'dragon12345',
  'master12345',
  'trustno1234',
  'sunshine123',
  'princess123',
  'football123',
  'superman123',
]);

export function validatePassword(password: string): void {
  if (!password || password.length < 10) {
    throw new AuthError('Password must be at least 10 characters long', 400);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new AuthError('Password is too common and easily guessable', 400);
  }
}

export class AuthService {
  // ─── Signup ───────────────────────────────────────────────────

  async signup(email: string, password: string, tenantName?: string): Promise<SessionPayload> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new AuthError('Email and password are required', 400);
    }
    validatePassword(password);

    const lib = await getArgon2();
    const hash = await lib.hash(password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check email uniqueness
      const existing = await client.query(
        `SELECT id FROM public.app_user WHERE email = $1`,
        [normalizedEmail]
      );
      if (existing.rows.length > 0) {
        throw new AuthError('Email already registered', 409);
      }

      const tenantId = `t_${crypto.randomBytes(8).toString('hex')}`;
      const name = (tenantName || normalizedEmail.split('@')[0] || 'My Tenant').trim();

      // Create a tenant for this user (owner) first to satisfy FK constraint
      await client.query(
        `INSERT INTO public.tenant (id, name, schema_version, created_at)
         VALUES ($1, $2, 1, NOW())`,
        [tenantId, name]
      );

      const userId = `u_${crypto.randomBytes(8).toString('hex')}`;
      await client.query(
        `INSERT INTO public.app_user (id, email, password_hash, last_tenant_id, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW())`,
        [userId, normalizedEmail, hash, tenantId]
      );

      // Add as owner
      await client.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, 'owner', NOW())`,
        [userId, tenantId]
      );

      // Create email verification token
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const hashedVerifyToken = hashToken(verifyToken);
      const verifyExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);
      await client.query(
        `INSERT INTO public.email_verification_token (token, user_id, email, expires_at, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [hashedVerifyToken, userId, normalizedEmail, verifyExpiresAt]
      );

      await client.query('COMMIT');

      // Provision the postgres schema for this new tenant
      await defaultStorageAdapter.initTenant(tenantId);

      // Send verification email via interface (non-blocking)
      await defaultEmailVerifier.sendVerificationEmail(normalizedEmail, verifyToken).catch((err) => {
        console.error('[EMAIL VERIFICATION ERROR]', err);
      });

      // Create session
      return this.createSession(userId, tenantId, 'owner', normalizedEmail, name);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Verify Email ─────────────────────────────────────────────

  async verifyEmail(rawToken: string): Promise<{ success: boolean; email: string }> {
    const hashed = hashToken(rawToken);
    const res = await pool.query(
      `SELECT user_id, email, expires_at FROM public.email_verification_token WHERE token = $1`,
      [hashed]
    );
    if (res.rows.length === 0) {
      throw new AuthError('Invalid verification token', 400);
    }
    const row = res.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      throw new AuthError('Verification token has expired', 400);
    }
    await pool.query(`UPDATE public.app_user SET email_verified = true WHERE id = $1`, [row.user_id]);
    await pool.query(`DELETE FROM public.email_verification_token WHERE token = $1`, [hashed]);
    return { success: true, email: row.email };
  }

  // ─── Login ────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<SessionPayload> {
    const normalizedEmail = email.trim().toLowerCase();

    const userRes = await pool.query(
      `SELECT id, email, password_hash, last_tenant_id, email_verified FROM public.app_user WHERE email = $1`,
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      throw new AuthError('Invalid credentials', 401);
    }

    const user = userRes.rows[0];

    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true' ||
      (process.env.NODE_ENV === 'production' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false');
    if (requireVerification && !user.email_verified) {
      throw new AuthError('Email verification required before accessing workspace. Please check your inbox.', 403);
    }

    const lib = await getArgon2();
    const valid = await lib.verify(user.password_hash, password);
    if (!valid) {
      throw new AuthError('Invalid credentials', 401);
    }

    // Get user's memberships
    const memberships = await pool.query(
      `SELECT m.tenant_id, m.role, t.name AS "tenantName"
       FROM public.tenant_member m
       JOIN public.tenant t ON t.id = m.tenant_id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC`,
      [user.id]
    );

    if (memberships.rows.length === 0) {
      throw new AuthError('User has no workspace memberships', 403);
    }

    // Land in the last used workspace if user is still a member, otherwise default to first
    let target = memberships.rows.find((m) => m.tenant_id === user.last_tenant_id);
    if (!target) {
      target = memberships.rows[0];
    }

    // Update last_tenant_id
    await pool.query(
      `UPDATE public.app_user SET last_tenant_id = $1 WHERE id = $2`,
      [target.tenant_id, user.id]
    );

    return this.createSession(user.id, target.tenant_id, target.role as TenantRole, user.email, target.tenantName);
  }

  // ─── Session management ───────────────────────────────────────

  async createSession(
    userId: string,
    tenantId: string,
    role: TenantRole,
    email: string,
    tenantName?: string
  ): Promise<SessionPayload> {
    const rawSessionId = crypto.randomBytes(32).toString('hex');
    const hashedSessionId = hashToken(rawSessionId);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

    // If tenantName is not provided, fetch it
    let effectiveTenantName = tenantName;
    if (!effectiveTenantName) {
      const tRes = await pool.query(`SELECT name FROM public.tenant WHERE id = $1`, [tenantId]);
      effectiveTenantName = tRes.rows[0]?.name || 'Workspace';
    }

    await pool.query(
      `INSERT INTO public.app_session (id, user_id, tenant_id, role, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [hashedSessionId, userId, tenantId, role, expiresAt]
    );

    return { sessionId: rawSessionId, userId, tenantId, tenantName: effectiveTenantName, role, email, expiresAt };
  }

  async resolveSession(sessionId: string): Promise<SessionPayload | null> {
    const hashed = hashToken(sessionId);
    const res = await pool.query(
      `SELECT s.id AS "sessionId", s.user_id AS "userId", s.tenant_id AS "tenantId",
              t.name AS "tenantName", s.role, s.expires_at AS "expiresAt", u.email,
              u.theme_preference AS "themePreference",
              u.date_preferences AS "datePreferences"
       FROM public.app_session s
       JOIN public.app_user u ON u.id = s.user_id
       JOIN public.tenant t ON t.id = s.tenant_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [hashed]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      sessionId,
      userId: row.userId,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      role: row.role as TenantRole,
      email: row.email,
      themePreference: (row.themePreference as any) || 'system',
      datePreferences: row.datePreferences || {},
      expiresAt: row.expiresAt,
    };
  }

  async destroySession(sessionId: string): Promise<void> {
    const hashed = hashToken(sessionId);
    await pool.query(`DELETE FROM public.app_session WHERE id = $1`, [hashed]);
  }

  async destroyAllSessions(userId: string): Promise<void> {
    await pool.query(`DELETE FROM public.app_session WHERE user_id = $1`, [userId]);
  }

  // ─── CSRF Token ───────────────────────────────────────────────

  generateCsrfToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // ─── Members ─────────────────────────────────────────────────

  async listMembers(tenantId: string) {
    const res = await pool.query(
      `SELECT u.id, u.email, m.role, m.created_at AS "memberSince"
       FROM public.tenant_member m
       JOIN public.app_user u ON u.id = m.user_id
       WHERE m.tenant_id = $1
       ORDER BY m.created_at ASC`,
      [tenantId]
    );
    return res.rows;
  }

  async changeRole(tenantId: string, targetUserId: string, newRole: TenantRole): Promise<void> {
    if (!isValidRole(newRole)) throw new AuthError('Invalid role', 400);
    const res = await pool.query(
      `UPDATE public.tenant_member SET role = $1 WHERE tenant_id = $2 AND user_id = $3 RETURNING user_id`,
      [newRole, tenantId, targetUserId]
    );
    if (res.rows.length === 0) throw new AuthError('Member not found', 404);
  }

  async removeMember(tenantId: string, targetUserId: string): Promise<void> {
    const res = await pool.query(
      `DELETE FROM public.tenant_member WHERE tenant_id = $1 AND user_id = $2 RETURNING user_id`,
      [tenantId, targetUserId]
    );
    if (res.rows.length === 0) {
      throw new AuthError('Member not found', 404);
    }
  }

  // ─── Workspaces ───────────────────────────────────────────────

  async getUserWorkspaces(userId: string, currentTenantId?: string): Promise<Array<{
    tenantId: string;
    tenantName: string;
    role: TenantRole;
    isCurrent: boolean;
  }>> {
    const res = await pool.query(
      `SELECT m.tenant_id, m.role, t.name AS "tenantName"
       FROM public.tenant_member m
       JOIN public.tenant t ON t.id = m.tenant_id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC`,
      [userId]
    );
    return res.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenantName,
      role: row.role as TenantRole,
      isCurrent: row.tenant_id === currentTenantId,
    }));
  }

  async switchWorkspace(
    currentSessionId: string,
    userId: string,
    targetTenantId: string
  ): Promise<SessionPayload> {
    const res = await pool.query(
      `SELECT m.role, t.name AS "tenantName", u.email
       FROM public.tenant_member m
       JOIN public.tenant t ON t.id = m.tenant_id
       JOIN public.app_user u ON u.id = m.user_id
       WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [userId, targetTenantId]
    );
    if (res.rows.length === 0) {
      throw new AuthError('Workspace not found or access denied', 403);
    }
    const row = res.rows[0];

    // Invalidate old session
    await this.destroySession(currentSessionId);

    // Update last_tenant_id
    await pool.query(
      `UPDATE public.app_user SET last_tenant_id = $1 WHERE id = $2`,
      [targetTenantId, userId]
    );

    return this.createSession(userId, targetTenantId, row.role as TenantRole, row.email, row.tenantName);
  }

  // ─── Invite flow ──────────────────────────────────────────────

  async createInvite(
    tenantId: string,
    inviterUserId: string,
    inviteeEmail: string,
    role: TenantRole
  ): Promise<string> {
    if (!isValidRole(role)) throw new AuthError('Invalid role', 400);
    const normalizedEmail = inviteeEmail.trim().toLowerCase();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000); // 72 hours

    await pool.query(
      `INSERT INTO public.invite_token (token, tenant_id, inviter_id, invitee_email, role, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, invitee_email) DO UPDATE
         SET token = EXCLUDED.token, role = EXCLUDED.role, expires_at = EXCLUDED.expires_at, used_at = NULL`,
      [hashedToken, tenantId, inviterUserId, normalizedEmail, role, expiresAt]
    );

    const tenantRes = await pool.query('SELECT name FROM public.tenant WHERE id = $1', [tenantId]);
    const tenantName = tenantRes.rows[0]?.name;
    const inviterRes = await pool.query('SELECT email FROM public.app_user WHERE id = $1', [inviterUserId]);
    const inviterEmail = inviterRes.rows[0]?.email;

    await defaultEmailSender.sendInviteEmail(normalizedEmail, rawToken, inviterEmail, tenantName).catch((err) => {
      console.error('[EMAIL ERROR] Failed to send invite email:', err);
    });

    return rawToken;
  }

  async getInviteInfo(token: string): Promise<{
    email: string;
    role: string;
    tenantName: string;
    userExists: boolean;
  }> {
    const hashedToken = hashToken(token);
    const res = await pool.query(
      `SELECT i.invitee_email, i.role, i.expires_at, i.used_at, t.name as tenant_name
       FROM public.invite_token i
       JOIN public.tenant t ON t.id = i.tenant_id
       WHERE i.token = $1`,
      [hashedToken]
    );

    if (res.rows.length === 0) {
      throw new AuthError('Invite token is invalid', 404);
    }

    const row = res.rows[0];
    if (row.used_at) {
      throw new AuthError('This invitation has already been used', 400);
    }
    if (new Date(row.expires_at) < new Date()) {
      throw new AuthError('This invitation has expired', 400);
    }

    const userRes = await pool.query(
      `SELECT id FROM public.app_user WHERE email = $1`,
      [row.invitee_email]
    );

    return {
      email: row.invitee_email,
      role: row.role,
      tenantName: row.tenant_name,
      userExists: userRes.rows.length > 0,
    };
  }

  async acceptInvite(
    token: string,
    email: string | undefined,
    password: string
  ): Promise<SessionPayload> {
    let normalizedEmail = email ? email.trim().toLowerCase() : '';
    const hashedToken = hashToken(token);

    const inviteRes = normalizedEmail
      ? await pool.query(
          `SELECT * FROM public.invite_token
           WHERE token = $1 AND invitee_email = $2 AND expires_at > NOW() AND used_at IS NULL`,
          [hashedToken, normalizedEmail]
        )
      : await pool.query(
          `SELECT * FROM public.invite_token
           WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL`,
          [hashedToken]
        );

    if (inviteRes.rows.length === 0) {
      throw new AuthError('Invite token is invalid, expired, or already used', 400);
    }

    const invite = inviteRes.rows[0];
    normalizedEmail = invite.invitee_email;

    const lib = await getArgon2();
    const hash = await lib.hash(password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert or join existing user
      let userId: string;
      const existingUser = await client.query(
        `SELECT id, password_hash, email_verified FROM public.app_user WHERE email = $1`,
        [normalizedEmail]
      );

      if (existingUser.rows.length > 0) {
        const u = existingUser.rows[0];
        userId = u.id;
        const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true' ||
          (process.env.NODE_ENV === 'production' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false');
        if (requireVerification && !u.email_verified) {
          throw new AuthError('Email verification required before accepting invitation. Please verify your email first.', 403);
        }
        // Verify password for existing account
        const isValid = await lib.verify(u.password_hash, password);
        if (!isValid) {
          throw new AuthError('Incorrect password for existing account', 401);
        }
        await client.query(`UPDATE public.app_user SET last_tenant_id = $1 WHERE id = $2`, [invite.tenant_id, userId]);
      } else {
        validatePassword(password);
        userId = `u_${crypto.randomBytes(8).toString('hex')}`;
        await client.query(
          `INSERT INTO public.app_user (id, email, password_hash, last_tenant_id, email_verified, created_at, updated_at)
           VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())`,
          [userId, normalizedEmail, hash, invite.tenant_id]
        );
      }

      // Add or update tenant membership
      await client.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
        [userId, invite.tenant_id, invite.role]
      );

      // Mark invite as used (single use)
      await client.query(
        `UPDATE public.invite_token SET used_at = NOW() WHERE token = $1`,
        [hashedToken]
      );

      await client.query('COMMIT');

      return this.createSession(userId, invite.tenant_id, invite.role as TenantRole, normalizedEmail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Password Reset (stubbed) ─────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('hex');
    const link = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    // In dev, log the link. In production this would send an email.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AUTH] Password reset link for ${normalizedEmail}: ${link}`);
    }
    // Store the token (no-op stub in this skeleton)
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const authService = new AuthService();
