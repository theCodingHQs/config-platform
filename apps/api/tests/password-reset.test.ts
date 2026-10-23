import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { authService } from '../src/auth/auth-service.js';
import { defaultEmailVerifier } from '../src/auth/email-verifier.js';

describe('Forgot password', () => {
  let server: FastifyInstance;
  const email = `reset_${crypto.randomBytes(4).toString('hex')}@example.com`;
  const oldPassword = 'Old-Factory-Pass-1';
  const newPassword = 'New-Factory-Pass-2';
  let userId: string;
  let tenantId: string;
  let csrf: { token: string; cookie: string };
  const savedEnv = { resend: process.env.RESEND_API_KEY, smtp: process.env.SMTP_URL };

  beforeAll(async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_URL;
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    const session = await authService.signup(email, oldPassword, 'Reset Test');
    userId = session.userId;
    tenantId = session.tenantId;
    const res = await server.inject({ method: 'GET', url: '/api/auth/csrf' });
    csrf = { token: res.json().csrfToken, cookie: res.cookies.find((c) => c.name === 'csrf_token')!.value };
  }, 120000);

  afterAll(async () => {
    if (savedEnv.resend !== undefined) process.env.RESEND_API_KEY = savedEnv.resend;
    if (savedEnv.smtp !== undefined) process.env.SMTP_URL = savedEnv.smtp;
    await server.close();
    await pool.query('DELETE FROM public.app_session WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM public.tenant_member WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM public.app_user WHERE id = $1', [userId]);
    await pool.query('DELETE FROM public.tenant WHERE id = $1', [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const post = (url: string, payload: any, cookie = '') =>
    server.inject({
      method: 'POST',
      url: `/api${url}`,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.token, cookie: `csrf_token=${csrf.cookie}${cookie ? `; ${cookie}` : ''}` },
      payload,
    });
  const login = (password: string) => post('/auth/login', { email, password });

  it('answers the same whether or not the account exists, and only emails real accounts', async () => {
    defaultEmailVerifier.lastSentEmail = null;
    const unknown = await post('/auth/forgot-password', { email: 'nobody-here@example.com' });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ success: true });
    expect(defaultEmailVerifier.lastSentEmail).toBeNull();

    const known = await post('/auth/forgot-password', { email: email.toUpperCase() });
    expect(known.json()).toEqual({ success: true });
    expect(defaultEmailVerifier.lastSentEmail).toMatchObject({ email, type: 'password_reset' });
    expect(defaultEmailVerifier.lastSentEmail!.link).toMatch(/\/reset-password\?token=[0-9a-f]{64}$/);

    // Only a hash of the code is stored
    const stored = await pool.query('SELECT token FROM public.password_reset_token WHERE user_id = $1', [userId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token).not.toBe(defaultEmailVerifier.lastSentEmail!.token);
  }, 60000);

  it('the link sets a new password once, and logs the account out everywhere', async () => {
    const token = defaultEmailVerifier.lastSentEmail!.token;
    const loggedIn = await login(oldPassword);
    const sid = loggedIn.cookies.find((c) => c.name === 'sid')!.value;

    const info = await server.inject({ method: 'GET', url: `/api/auth/reset-password-info?token=${token}` });
    expect(info.json()).toEqual({ email });

    const weak = await post('/auth/reset-password', { token, password: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().message).toMatch(/at least 10 characters/);

    const done = await post('/auth/reset-password', { token, password: newPassword });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ success: true, email });

    // The old session is gone, the old password no longer works, the new one does
    expect((await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `sid=${sid}` } })).statusCode).toBe(401);
    expect((await login(oldPassword)).statusCode).toBe(401);
    expect((await login(newPassword)).statusCode).toBe(200);

    // The link can't be used again
    const again = await post('/auth/reset-password', { token, password: 'Another-Pass-3' });
    expect(again.statusCode).toBe(400);
    expect(again.json().message).toMatch(/expired or was already used/);
  }, 60000);

  it('links stop working after an hour, and a new link replaces the old one', async () => {
    await post('/auth/forgot-password', { email });
    const first = defaultEmailVerifier.lastSentEmail!.token;
    await authService.requestPasswordReset(email);
    const second = defaultEmailVerifier.lastSentEmail!.token;
    expect((await server.inject({ method: 'GET', url: `/api/auth/reset-password-info?token=${first}` })).statusCode).toBe(400);

    await pool.query(`UPDATE public.password_reset_token SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [userId]);
    const expired = await server.inject({ method: 'GET', url: `/api/auth/reset-password-info?token=${second}` });
    expect(expired.statusCode).toBe(400);
    expect(expired.json().message).toMatch(/expired or was already used/);
  }, 60000);
});
