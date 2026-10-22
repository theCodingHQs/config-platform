import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { platformSettings } from '../src/platform/platform-settings.js';
import { workspaceMailer } from '../src/email/workspace-mailer.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Platform setup (server-wide settings for platform owners)', () => {
  let server: FastifyInstance;
  const tenantId = `plat_${crypto.randomBytes(3).toString('hex')}`;
  const storageKey = `test_${crypto.randomBytes(4).toString('hex')}`;
  let owner: TestSession; // platform owner
  let workspaceOwner: TestSession; // owns a workspace, not the platform
  const ENV_KEYS = ['RESEND_API_KEY', 'SMTP_URL', 'EMAIL_FROM', 'SIGNUP_MODE', 'PUBLIC_URL', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    // This test's settings live in their own row, so parallel test files keep the real ones
    platformSettings.useStorageKeyForTests(storageKey);
    await migrationService.provisionTenant(tenantId, 'Platform Test');
    owner = await createTestSession(tenantId, 'viewer', 'plat_owner');
    workspaceOwner = await createTestSession(tenantId, 'owner', 'plat_wsowner');
    await pool.query('UPDATE public.app_user SET is_platform_admin = TRUE WHERE id = $1', [owner.userId]);
  }, 120000);

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    }
    await server.close();
    await pool.query('DELETE FROM public.platform_setting WHERE key = $1', [storageKey]);
    for (const s of [owner, workspaceOwner]) await cleanupTestUser(s.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const api = (s: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: any) =>
    server.inject({ method, url: `/api${url}`, headers: s.headers, payload });

  it('only platform owners can open it, whatever their workspace role', async () => {
    expect((await api(workspaceOwner, 'GET', '/platform/settings')).statusCode).toBe(403);
    expect((await api(workspaceOwner, 'PUT', '/platform/settings', { signupMode: 'open' })).statusCode).toBe(403);
    const me = JSON.parse((await api(owner, 'GET', '/auth/me')).body);
    expect(me.isPlatformAdmin).toBe(true);
    expect(JSON.parse((await api(workspaceOwner, 'GET', '/auth/me')).body).isPlatformAdmin).toBe(false);

    const view = JSON.parse((await api(owner, 'GET', '/platform/settings')).body);
    expect(view.email).toMatchObject({ source: 'default', provider: 'none' });
    expect(view.platformAdmins.map((a: any) => a.email)).toContain(owner.email);
  });

  it('saves the email service with secrets encrypted and never returned', async () => {
    const res = await api(owner, 'PUT', '/platform/settings', {
      email: {
        provider: 'smtp',
        smtp: { host: '127.0.0.1', port: 1, security: 'none', username: 'mailer', password: 'Sm7p-Secret!' },
        fromAddress: 'noreply@factoryapps.io',
        fromName: 'Factory Apps',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Sm7p-Secret!');
    const view = JSON.parse(res.body);
    expect(view.email).toMatchObject({ source: 'saved', provider: 'smtp', fromAddress: 'noreply@factoryapps.io', smtp: { host: '127.0.0.1', hasPassword: true } });

    const stored = await pool.query('SELECT value::text AS v FROM public.platform_setting WHERE key = $1', [storageKey]);
    expect(stored.rows[0].v).not.toContain('Sm7p-Secret!');

    // Every workspace now sends through it by default
    expect(platformSettings.emailConfigured()).toBe(true);
    expect((await workspaceMailer.getSettings(tenantId)).platformConfigured).toBe(true);

    // Nothing listens on port 1: the test email explains the failure
    const test = await api(owner, 'POST', '/platform/settings/test-email');
    expect(test.statusCode).toBe(502);
    expect(JSON.parse(test.body).message).toMatch(/could not be sent/);

    // Switching to Resend needs its key; saving it keeps the SMTP password stored
    const noKey = await api(owner, 'PUT', '/platform/settings', { email: { provider: 'resend', fromAddress: 'noreply@factoryapps.io' } });
    expect(noKey.statusCode).toBe(422);
    const off = JSON.parse((await api(owner, 'PUT', '/platform/settings', { email: { provider: 'none' } })).body);
    expect(off.email).toMatchObject({ provider: 'none', smtp: { hasPassword: true } });
    expect(platformSettings.emailConfigured()).toBe(false);
  }, 60000);

  it('environment values win and are reported as such', async () => {
    process.env.PUBLIC_URL = 'https://apps.example.com';
    try {
      await api(owner, 'PUT', '/platform/settings', { publicUrl: 'https://factory.example.org' });
      const view = JSON.parse((await api(owner, 'GET', '/platform/settings')).body);
      expect(view.publicUrl).toEqual({ value: 'https://apps.example.com', source: 'env' });
    } finally {
      delete process.env.PUBLIC_URL;
    }
    const view = JSON.parse((await api(owner, 'GET', '/platform/settings')).body);
    expect(view.publicUrl).toEqual({ value: 'https://factory.example.org', source: 'saved' });
    expect((await api(owner, 'PUT', '/platform/settings', { publicUrl: 'factory.example.org' })).statusCode).toBe(422);
  }, 60000);

  it('sign-ups can be limited to invitations', async () => {
    await api(owner, 'PUT', '/platform/settings', { signupMode: 'invite_only' });
    const signup = await server.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { 'x-csrf-token': owner.headers['x-csrf-token'], cookie: owner.headers.cookie.split(';').filter((c: string) => c.includes('csrf')).join(';') },
      payload: { email: `plat_new_${crypto.randomBytes(3).toString('hex')}@example.com`, password: 'Correct-Horse-9', tenantName: 'Nope' },
    });
    expect(signup.statusCode).toBe(403);
    await api(owner, 'PUT', '/platform/settings', { signupMode: 'open' });
    expect(platformSettings.signupMode()).toBe('open');
  }, 60000);

  it('owners can add and remove other owners', async () => {
    const added = await api(owner, 'POST', '/platform/admins', { email: workspaceOwner.email });
    expect(added.statusCode).toBe(200);
    expect(JSON.parse(added.body).map((a: any) => a.email)).toContain(workspaceOwner.email);
    expect((await api(workspaceOwner, 'GET', '/platform/settings')).statusCode).toBe(200);

    expect((await api(owner, 'POST', '/platform/admins', { email: 'nobody@nowhere.example' })).statusCode).toBe(404);

    const removed = await api(owner, 'DELETE', `/platform/admins/${workspaceOwner.userId}`);
    expect(JSON.parse(removed.body).map((a: any) => a.email)).not.toContain(workspaceOwner.email);
    expect((await api(workspaceOwner, 'GET', '/platform/settings')).statusCode).toBe(403);
  }, 60000);
});
