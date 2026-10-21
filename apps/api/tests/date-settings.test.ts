import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { catalogMigrations } from '../src/db/catalog-migration-runner.js';
import { exportImportService } from '../src/workspace/export-import-service.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Date settings: workspace defaults and personal preferences', () => {
  let server: FastifyInstance;
  const tenantId = `date_set_${crypto.randomBytes(3).toString('hex')}`;
  let admin: TestSession;
  let viewer: TestSession;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Date Settings Tenant');
    admin = await createTestSession(tenantId, 'admin', 'date_admin');
    viewer = await createTestSession(tenantId, 'viewer', 'date_viewer');
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(admin.userId);
    await cleanupTestUser(viewer.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const call = (session: TestSession, method: 'GET' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
    server.inject({ method, url, headers: session.headers, payload: payload as any });

  it('adds migration 015_date_settings', () => {
    expect(catalogMigrations.find((m) => m.version === 15)?.name).toBe('015_date_settings');
  });

  it('workspace defaults: everyone reads them, only admins change them, values are validated', async () => {
    // Defaults
    expect(JSON.parse((await call(viewer, 'GET', '/api/workspace/date-settings')).body)).toEqual({
      dateFormat: 'auto', timeFormat: 'auto', weekStart: 'auto', timeZone: 'UTC',
    });

    const settings = { dateFormat: 'DD/MM/YYYY', timeFormat: '24h', weekStart: 'monday', timeZone: 'Asia/Kolkata' };
    expect((await call(viewer, 'PUT', '/api/workspace/date-settings', settings)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', '/api/workspace/date-settings', settings)).statusCode).toBe(200);
    expect(JSON.parse((await call(viewer, 'GET', '/api/workspace/date-settings')).body)).toEqual(settings);
    // The workspace time zone is the tenant time zone used by exports ("today", day boundaries)
    expect((await migrationService.getTenantTimezone(tenantId))).toBe('Asia/Kolkata');

    expect((await call(admin, 'PUT', '/api/workspace/date-settings', { ...settings, timeZone: 'Mars/Olympus' })).statusCode).toBe(422);
    expect((await call(admin, 'PUT', '/api/workspace/date-settings', { ...settings, dateFormat: 'DD.MM.YY' })).statusCode).toBe(422);
  });

  it('personal preferences: any role saves its own, returned with the session; empty = workspace default', async () => {
    const mine = { dateFormat: 'MM/DD/YYYY', timeFormat: '12h', timeZone: 'America/New_York' };
    expect((await call(viewer, 'PATCH', '/api/auth/date-preferences', mine)).statusCode).toBe(200);
    expect(JSON.parse((await call(viewer, 'GET', '/api/auth/me')).body).datePreferences).toEqual(mine);

    // Clearing a choice (null) goes back to the workspace default; "auto" zone = this device
    await call(viewer, 'PATCH', '/api/auth/date-preferences', { dateFormat: null, timeZone: 'auto' });
    expect(JSON.parse((await call(viewer, 'GET', '/api/auth/me')).body).datePreferences).toEqual({ timeZone: 'auto' });

    // Other users are not affected; bad values and unknown keys are rejected
    expect(JSON.parse((await call(admin, 'GET', '/api/auth/me')).body).datePreferences).toEqual({});
    expect((await call(viewer, 'PATCH', '/api/auth/date-preferences', { timeZone: 'Nowhere/City' })).statusCode).toBe(422);
    expect((await call(viewer, 'PATCH', '/api/auth/date-preferences', { colour: 'red' })).statusCode).toBe(422);
  });

  it('workspace bundles carry the regional settings to another workspace', async () => {
    const target = `date_imp_${crypto.randomBytes(3).toString('hex')}`;
    await migrationService.provisionTenant(target, 'Date Import Target');
    try {
      await call(admin, 'PUT', '/api/workspace/date-settings', {
        dateFormat: 'D MMM YYYY', timeFormat: '12h', weekStart: 'sunday', timeZone: 'America/Chicago',
      });
      const bundle = await exportImportService.exportBundle(tenantId);
      expect(bundle.regionalSettings).toEqual({ dateFormat: 'D MMM YYYY', timeFormat: '12h', weekStart: 'sunday', timeZone: 'America/Chicago' });

      // An invalid value is reported, nothing is applied
      const bad = await exportImportService.importBundle(target, { ...bundle, regionalSettings: { ...bundle.regionalSettings!, timeZone: 'Atlantis/City' } } as any, false);
      expect((bad as any).conflicts.join(' ')).toMatch(/regional settings/i);
      expect(await migrationService.getTenantTimezone(target)).toBe('UTC');

      await exportImportService.importBundle(target, bundle, false);
      const res = await pool.query('SELECT date_settings, timezone FROM public.tenant WHERE id = $1', [target]);
      expect(res.rows[0].timezone).toBe('America/Chicago');
      expect(res.rows[0].date_settings).toEqual({ dateFormat: 'D MMM YYYY', timeFormat: '12h', weekStart: 'sunday' });

      // Bundles exported before regional settings existed still import (settings unchanged)
      const { regionalSettings: _omit, ...oldBundle } = bundle;
      await exportImportService.importBundle(target, oldBundle as any, false);
      expect(await migrationService.getTenantTimezone(target)).toBe('America/Chicago');
    } finally {
      await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [target]);
      await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(target)}" CASCADE`);
    }
  });
});
