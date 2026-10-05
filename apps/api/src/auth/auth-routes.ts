/**
 * Auth routes: signup, login, logout, me, CSRF token, invites, members.
 *
 * PUBLIC routes (no session needed): signup, login, logout, me, csrf, forgot-password, accept-invite
 * PROTECTED routes (session required): invite, members management
 *   → These are registered via memberRoutes() exported separately and hooked into the protected scope
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  authService,
  AuthError,
  SESSION_COOKIE,
} from './auth-service.js';
import type { TenantRole } from './auth-types.js';
import { hasMinRole, isValidRole } from './auth-types.js';
import { csrfCheckHook } from './session-middleware.js';
import { createRateLimitHook } from './rate-limiter.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { auditLogService } from '../audit/audit-service.js';
import { pool } from '../db/pool.js';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 3600, // 7 days in seconds
};

const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export function getSignupMode(): 'open' | 'invite_only' {
  if (process.env.SIGNUP_MODE === 'open' || process.env.SIGNUP_MODE === 'invite_only') {
    return process.env.SIGNUP_MODE;
  }
  return process.env.NODE_ENV === 'production' ? 'invite_only' : 'open';
}

/** Public auth routes – no session required */
export async function authRoutes(fastify: FastifyInstance) {
  // ─── GET /auth/csrf ──────────────────────────────────────────
  fastify.get('/auth/csrf', async (_req: FastifyRequest, reply: FastifyReply) => {
    const csrfToken = authService.generateCsrfToken();
    reply
      .setCookie('csrf_token', csrfToken, CSRF_COOKIE_OPTS)
      .send({ csrfToken });
  });

  // ─── GET /auth/me ────────────────────────────────────────────
  fastify.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
    if (!sessionId) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
    const session = await authService.resolveSession(sessionId);
    if (!session) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
    return {
      id: session.userId,
      email: session.email,
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      role: session.role,
      themePreference: session.themePreference || 'system',
    };
  });

  // ─── PATCH /auth/theme ───────────────────────────────────────
  fastify.patch('/auth/theme', { preHandler: [csrfCheckHook] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
    if (!sessionId) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
    const session = await authService.resolveSession(sessionId);
    if (!session) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
    const { theme } = (req.body as any) || {};
    if (!theme || !['system', 'light', 'dark'].includes(theme)) {
      return reply.status(400).send({ statusCode: 400, error: 'Invalid theme. Must be system, light, or dark.' });
    }
    await pool.query('UPDATE public.app_user SET theme_preference = $1, updated_at = NOW() WHERE id = $2', [
      theme,
      session.userId,
    ]);
    return { success: true, theme };
  });

  // ─── POST /auth/signup ───────────────────────────────────────
  fastify.post('/auth/signup', {
    preHandler: [createRateLimitHook(5, 15 * 60 * 1000), csrfCheckHook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const mode = getSignupMode();
    if (mode === 'invite_only') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Public registration is disabled. You must be invited by an existing workspace administrator.',
      });
    }

    const { email, password, tenantName } = (req.body as any) || {};
    const session = await authService.signup(email, password, tenantName);

    const csrfToken = authService.generateCsrfToken();
    reply
      .setCookie(SESSION_COOKIE, session.sessionId, COOKIE_OPTS)
      .setCookie('csrf_token', csrfToken, CSRF_COOKIE_OPTS)
      .status(201)
      .send({
        id: session.userId,
        email: session.email,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        role: session.role,
      });
  });

  // ─── POST /auth/login ────────────────────────────────────────
  fastify.post('/auth/login', {
    preHandler: [createRateLimitHook(10, 15 * 60 * 1000), csrfCheckHook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = (req.body as any) || {};
    const session = await authService.login(email, password);

    const csrfToken = authService.generateCsrfToken();
    reply
      .setCookie(SESSION_COOKIE, session.sessionId, COOKIE_OPTS)
      .setCookie('csrf_token', csrfToken, CSRF_COOKIE_OPTS)
      .send({
        id: session.userId,
        email: session.email,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        role: session.role,
      });
  });

  // ─── POST /auth/logout ───────────────────────────────────────
  fastify.post('/auth/logout', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
    if (sessionId) {
      await authService.destroySession(sessionId);
    }
    reply
      .clearCookie(SESSION_COOKIE, { path: '/' })
      .clearCookie('csrf_token', { path: '/' })
      .send({ success: true });
  });

  // ─── POST /auth/forgot-password ──────────────────────────────
  fastify.post('/auth/forgot-password', {
    preHandler: createRateLimitHook(3, 15 * 60 * 1000),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { email } = (req.body as any) || {};
    if (email) await authService.requestPasswordReset(email).catch(() => {});
    return { success: true };
  });

  // ─── GET /auth/invite-info ──────────────────────────────────
  fastify.get('/auth/invite-info', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = (req.query as any) || {};
    if (!token) {
      return reply.status(400).send({ error: 'token query parameter is required' });
    }
    const info = await authService.getInviteInfo(token);
    return info;
  });

  // ─── POST /auth/accept-invite ────────────────────────────────
  fastify.post('/auth/accept-invite', {
    preHandler: [createRateLimitHook(10, 15 * 60 * 1000), csrfCheckHook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { token, email, password } = (req.body as any) || {};
    if (!token || !password) {
      return reply.status(400).send({ error: 'token and password are required' });
    }
    const session = await authService.acceptInvite(token, email, password);
    const csrfToken = authService.generateCsrfToken();
    reply
      .setCookie(SESSION_COOKIE, session.sessionId, COOKIE_OPTS)
      .setCookie('csrf_token', csrfToken, CSRF_COOKIE_OPTS)
      .send({
        id: session.userId,
        email: session.email,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        role: session.role,
      });
  });

  // ─── POST /auth/verify-email ────────────────────────────────
  fastify.post('/auth/verify-email', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = (req.body as any) || {};
    if (!token) return reply.status(400).send({ error: 'token is required' });
    const result = await authService.verifyEmail(token);
    return result;
  });

  // ─── GET /auth/workspaces ────────────────────────────────────
  fastify.get('/auth/workspaces', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
    if (!sessionId) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    const session = await authService.resolveSession(sessionId);
    if (!session) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    const workspaces = await authService.getUserWorkspaces(session.userId, session.tenantId);
    return workspaces;
  });

  // ─── POST /auth/switch-workspace ─────────────────────────────
  fastify.post('/auth/switch-workspace', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
    if (!sessionId) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    const session = await authService.resolveSession(sessionId);
    if (!session) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });

    const { tenantId } = (req.body as any) || {};
    if (!tenantId) return reply.status(400).send({ error: 'tenantId is required' });

    const newSession = await authService.switchWorkspace(sessionId, session.userId, tenantId);
    const csrfToken = authService.generateCsrfToken();
    reply
      .setCookie(SESSION_COOKIE, newSession.sessionId, COOKIE_OPTS)
      .setCookie('csrf_token', csrfToken, CSRF_COOKIE_OPTS)
      .send({
        id: newSession.userId,
        email: newSession.email,
        tenantId: newSession.tenantId,
        tenantName: newSession.tenantName,
        role: newSession.role,
      });
  });
}

/**
 * Protected member + invite management routes.
 * Must be registered under the session-middleware-protected scope.
 */
export async function memberRoutes(fastify: FastifyInstance) {
  // ─── POST /auth/invite ───────────────────────────────────────
  fastify.post('/auth/invite', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = req.session;
    if (!hasMinRole(session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin or owner required' });
    }
    const { email, role } = (req.body as any) || {};
    // Any tenant or tenantId field in the request body is strictly ignored; session.tenantId is always used
    if (!email || !isValidRole(role)) {
      return reply.status(400).send({ error: 'Invalid email or role' });
    }

    // Check member limit
    await tenantLimitsService.checkMemberLimit(session.tenantId);

    const token = await authService.createInvite(session.tenantId, session.userId, email, role as TenantRole);

    await auditLogService.log({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: 'member.invite',
      entityType: 'member',
      entityId: email,
      afterState: { email, role },
    });

    return reply.status(201).send({ success: true, token });
  });

  // ─── GET /members ────────────────────────────────────────────
  fastify.get('/members', async (req: FastifyRequest, reply: FastifyReply) => {
    const session = req.session;
    if (!hasMinRole(session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    return authService.listMembers(session.tenantId);
  });

  // ─── PATCH /members/:userId/role ─────────────────────────────
  fastify.patch('/members/:userId/role', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = req.session;
    if (!hasMinRole(session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { userId } = req.params as { userId: string };
    const { role } = (req.body as any) || {};
    if (userId === session.userId) {
      return reply.status(400).send({ error: 'Cannot change your own role' });
    }
    await authService.changeRole(session.tenantId, userId, role as TenantRole);

    await auditLogService.log({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: 'member.role_change',
      entityType: 'member',
      entityId: userId,
      afterState: { role },
    });

    return { success: true };
  });

  // ─── DELETE /members/:userId ─────────────────────────────────
  fastify.delete('/members/:userId', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = req.session;
    if (!hasMinRole(session.role, 'admin')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden' });
    }
    const { userId } = req.params as { userId: string };
    if (userId === session.userId) {
      return reply.status(400).send({ error: 'Cannot remove yourself' });
    }
    await authService.removeMember(session.tenantId, userId);

    await auditLogService.log({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: 'member.remove',
      entityType: 'member',
      entityId: userId,
    });

    return { success: true };
  });
}
