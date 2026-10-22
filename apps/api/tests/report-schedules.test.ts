import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildServer } from '../src/server.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import { devOutbox } from '../src/email/workspace-mailer.js';
import { reportScheduleService } from '../src/reports/report-schedule-service.js';
import { createTestSession, cleanupTestUser, type TestSession } from './test-session-helper.js';

describe('Scheduled report emails', () => {
  let server: FastifyInstance;
  const tenantId = `rsch_${crypto.randomBytes(3).toString('hex')}`;
  let admin: TestSession;
  let builder: TestSession;
  let viewer: TestSession;
  let templateId: string;
  const savedEnv = { resend: process.env.RESEND_API_KEY, smtp: process.env.SMTP_URL };

  beforeAll(async () => {
    // Nothing is really sent: with no email service configured, messages land in devOutbox
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_URL;
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();
    await migrationService.provisionTenant(tenantId, 'Acme Plant');
    admin = await createTestSession(tenantId, 'admin', 'rsch_admin');
    builder = await createTestSession(tenantId, 'builder', 'rsch_builder');
    viewer = await createTestSession(tenantId, 'viewer', 'rsch_viewer');
    const install = await server.inject({
      method: 'POST', url: '/api/solution-templates/maintenance-log/install', headers: builder.headers, payload: { sampleData: true },
    });
    expect(install.statusCode).toBe(201);
    const templates = JSON.parse((await server.inject({ method: 'GET', url: '/api/export-templates', headers: builder.headers })).body);
    templateId = (Array.isArray(templates) ? templates : templates.data).find((t: any) => t.name === 'Maintenance report').id;
  }, 180000);

  afterAll(async () => {
    if (savedEnv.resend !== undefined) process.env.RESEND_API_KEY = savedEnv.resend;
    if (savedEnv.smtp !== undefined) process.env.SMTP_URL = savedEnv.smtp;
    await server.close();
    for (const s of [admin, builder, viewer]) await cleanupTestUser(s.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${defaultStorageAdapter.getTenantSchemaName(tenantId)}" CASCADE`);
  });

  const api = (session: TestSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: any) =>
    server.inject({ method, url: `/api${url}`, headers: session.headers, payload });
  const weekly = { frequency: 'weekly', weekday: 1, timeOfDay: '07:00' };
  let scheduleId: string;

  it('builders schedule a report; viewers cannot; bad input is explained', async () => {
    expect((await api(viewer, 'POST', '/report-schedules', { templateId, timing: weekly, recipients: ['m@acme.com'] })).statusCode).toBe(403);
    const bad = await api(builder, 'POST', '/report-schedules', { templateId, timing: { frequency: 'weekly', timeOfDay: '07:00' }, recipients: ['nope'] });
    expect(bad.statusCode).toBe(422);
    expect(JSON.parse(bad.body).message).toMatch(/day of the week|valid email/);

    const res = await api(builder, 'POST', '/report-schedules', {
      templateId, timing: weekly, recipients: ['plant.manager@acme.com', 'qa@acme.com'], message: 'Weekly maintenance summary.',
    });
    expect(res.statusCode).toBe(201);
    const schedule = JSON.parse(res.body);
    scheduleId = schedule.id;
    expect(schedule.templateName).toBe('Maintenance report');
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(schedule.createdByEmail).toBe(builder.email);
  });

  it('"Send now" emails the report as an Excel attachment', async () => {
    devOutbox.length = 0;
    const res = await api(builder, 'POST', `/report-schedules/${scheduleId}/send-now`);
    expect(res.statusCode).toBe(200);
    const schedule = JSON.parse(res.body);
    expect(schedule.lastError).toBeNull();
    expect(schedule.lastStatus).toBe('sent');

    expect(devOutbox).toHaveLength(1);
    const mail = devOutbox[0];
    expect(mail.to).toEqual(['plant.manager@acme.com', 'qa@acme.com']);
    expect(mail.subject).toMatch(/^Maintenance report – /);
    expect(mail.from).toMatch(/^"Acme Plant" </);
    expect(mail.replyTo).toBe(builder.email);
    expect(mail.text).toContain('Weekly maintenance summary.');
    const [file] = mail.attachments!;
    expect(file.filename).toMatch(/\.xlsx$/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.content as any);
    const sheet = book.worksheets[0];
    expect(sheet.rowCount).toBeGreaterThanOrEqual(6); // header + 5 sample jobs
  }, 60000);

  it('the scheduler sends due reports and moves on to the next time', async () => {
    devOutbox.length = 0;
    await pool.query(`UPDATE public.report_schedule SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [scheduleId]);
    expect(await reportScheduleService.runDue()).toBeGreaterThanOrEqual(1);
    expect(devOutbox.filter((m) => m.tenantId === tenantId)).toHaveLength(1);
    const after = await reportScheduleService.get(tenantId, scheduleId);
    expect(new Date(after.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(after.lastStatus).toBe('sent');
  }, 60000);

  it('stops sending if the person who set it up loses access, and says why', async () => {
    await pool.query(`UPDATE public.tenant_member SET role = 'viewer' WHERE tenant_id = $1 AND user_id = $2`, [tenantId, builder.userId]);
    try {
      devOutbox.length = 0;
      const res = await api(admin, 'POST', `/report-schedules/${scheduleId}/send-now`);
      const schedule = JSON.parse(res.body);
      expect(schedule.lastStatus).toBe('failed');
      expect(schedule.lastError).toMatch(/can no longer send reports/);
      expect(devOutbox).toHaveLength(0);
    } finally {
      await pool.query(`UPDATE public.tenant_member SET role = 'builder' WHERE tenant_id = $1 AND user_id = $2`, [tenantId, builder.userId]);
    }
  }, 60000);

  it('email settings: built-in by default; admins can use their own mail server; the password is never shown', async () => {
    const initial = JSON.parse((await api(admin, 'GET', '/workspace/email-settings')).body);
    expect(initial).toMatchObject({ mode: 'platform', platformConfigured: false });

    const smtp = { host: '127.0.0.1', port: 1, security: 'none', username: 'reports@acme.com', password: 'S3cret-pass!', fromAddress: 'reports@acme.com', fromName: 'Acme Reports' };
    expect((await api(builder, 'PUT', '/workspace/email-settings', { mode: 'smtp', smtp })).statusCode).toBe(403);
    const saved = await api(admin, 'PUT', '/workspace/email-settings', { mode: 'smtp', smtp });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('S3cret-pass!');
    expect(JSON.parse(saved.body).smtp).toMatchObject({ host: '127.0.0.1', hasPassword: true });

    const stored = await pool.query(`SELECT email_settings::text AS s FROM public.tenant WHERE id = $1`, [tenantId]);
    expect(stored.rows[0].s).not.toContain('S3cret-pass!');

    // Saving again without a password keeps the stored one
    const { password: _omit, ...withoutPassword } = smtp;
    const resaved = JSON.parse((await api(admin, 'PUT', '/workspace/email-settings', { mode: 'smtp', smtp: withoutPassword })).body);
    expect(resaved.smtp.hasPassword).toBe(true);

    // Nothing listens on port 1: the test send explains the failure
    const test = await api(admin, 'POST', '/workspace/email-settings/test');
    expect(test.statusCode).toBe(502);
    expect(JSON.parse(test.body).message).toMatch(/could not be sent/);

    const back = JSON.parse((await api(admin, 'PUT', '/workspace/email-settings', { mode: 'platform' })).body);
    expect(back.mode).toBe('platform');
    devOutbox.length = 0;
    const ok = await api(admin, 'POST', '/workspace/email-settings/test');
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ sentTo: admin.email, via: 'log' });
  }, 60000);

  it('schedules can be paused and deleted', async () => {
    const current = await reportScheduleService.get(tenantId, scheduleId);
    const { id, templateName, createdBy, createdByEmail, nextRunAt, lastRunAt, lastStatus, lastError, ...input } = current;
    const paused = JSON.parse((await api(builder, 'PUT', `/report-schedules/${scheduleId}`, { ...input, enabled: false })).body);
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();
    expect((await api(builder, 'DELETE', `/report-schedules/${scheduleId}`)).statusCode).toBe(204);
    expect(JSON.parse((await api(builder, 'GET', '/report-schedules')).body)).toEqual([]);
  }, 60000);
});
