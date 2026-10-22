/**
 * Scheduled report emails: saving schedules, and building + sending a report when it's due.
 * A schedule sends with the permissions of the person who created it, checked again at every
 * send, so someone who loses access can't keep receiving data through an old schedule.
 */
import crypto from 'node:crypto';
import {
  ReportScheduleInputSchema,
  computeNextRun,
  describeScheduleTiming,
  formatPlainDate,
  plainDateInTimeZone,
  resolveRelativeDate,
  resolveWeekStartDay,
  type ReportSchedule,
  type ReportScheduleInput,
} from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { hasMinRole, isValidRole, type TenantRole } from '../auth/auth-types.js';
import { permissionService } from '../permissions/permission-service.js';
import { exportTemplateService } from '../records/export/export-template-service.js';
import { auditLogService } from '../audit/audit-service.js';
import { workspaceMailer } from '../email/workspace-mailer.js';
import { renderReportFile } from './report-file.js';

/** Attachments above this size are refused by many mail servers */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** A send that hasn't finished after this long is treated as crashed and may run again */
const STALE_RUN_MINUTES = 15;

export class ReportScheduleError extends Error {
  constructor(message: string, public statusCode = 422) {
    super(message);
  }
}

interface ScheduleRow {
  id: string;
  tenant_id: string;
  template_id: string;
  template_name: string | null;
  name: string | null;
  config: Omit<ReportScheduleInput, 'templateId' | 'name' | 'enabled'>;
  enabled: boolean;
  created_by: string | null;
  created_by_email: string | null;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_status: 'sent' | 'failed' | null;
  last_error: string | null;
}

const SELECT_SCHEDULE = `
  SELECT s.*, t.name AS template_name, u.email AS created_by_email
  FROM public.report_schedule s
  LEFT JOIN public.export_template t ON t.id = s.template_id
  LEFT JOIN public.app_user u ON u.id = s.created_by`;

function toSchedule(r: ScheduleRow): ReportSchedule {
  return {
    id: r.id,
    templateId: r.template_id,
    templateName: r.template_name || 'Deleted report',
    name: r.name || undefined,
    timing: r.config.timing,
    recipients: r.config.recipients,
    subject: r.config.subject,
    message: r.config.message,
    parameters: r.config.parameters || {},
    enabled: r.enabled,
    createdBy: r.created_by,
    createdByEmail: r.created_by_email,
    nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastStatus: r.last_status,
    lastError: r.last_error,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

class ReportScheduleService {
  private async workspaceClock(tenantId: string) {
    const res = await pool.query<{ timezone: string | null; date_settings: any; name: string }>(
      'SELECT timezone, date_settings, name FROM public.tenant WHERE id = $1',
      [tenantId]
    );
    const row = res.rows[0];
    return {
      timeZone: row?.timezone || 'UTC',
      dateFormat: row?.date_settings?.dateFormat,
      weekStart: row?.date_settings?.weekStart,
      workspaceName: row?.name || 'Workspace',
    };
  }

  /** Checks the report exists, its required inputs are filled, and the role may export it */
  private async validate(tenantId: string, input: ReportScheduleInput, role: TenantRole) {
    let template;
    try {
      template = await exportTemplateService.getTemplate(tenantId, input.templateId);
    } catch {
      throw new ReportScheduleError('That report no longer exists', 404);
    }
    const def: any = template.published || template.draft;
    for (const p of def?.parameters || []) {
      const value = input.parameters?.[p.name] ?? input.parameters?.[p.id];
      if (p.required && (value === undefined || value === '') && (p.defaultValue === undefined || p.defaultValue === '')) {
        throw new ReportScheduleError(`Fill in "${p.label || p.name}" for this report`);
      }
    }
    if (!(await permissionService.canExport(tenantId, template.entityId, role))) {
      throw new ReportScheduleError(`Your role can't export the data in "${template.name}"`, 403);
    }
    return template;
  }

  async list(tenantId: string): Promise<ReportSchedule[]> {
    const res = await pool.query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE s.tenant_id = $1 ORDER BY s.created_at`, [tenantId]);
    return res.rows.map(toSchedule);
  }

  async get(tenantId: string, id: string): Promise<ReportSchedule> {
    const res = await pool.query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, id]);
    if (!res.rows[0]) throw new ReportScheduleError('Schedule not found', 404);
    return toSchedule(res.rows[0]);
  }

  async create(tenantId: string, actor: { userId: string; email: string; role: TenantRole }, raw: unknown): Promise<ReportSchedule> {
    const input = ReportScheduleInputSchema.parse(raw);
    await this.validate(tenantId, input, actor.role);
    const { timeZone } = await this.workspaceClock(tenantId);
    const id = `rs_${crypto.randomBytes(6).toString('hex')}`;
    const { templateId, name, enabled, ...config } = input;
    await pool.query(
      `INSERT INTO public.report_schedule (id, tenant_id, template_id, name, config, enabled, created_by, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, tenantId, templateId, name || null, JSON.stringify(config), enabled, actor.userId, enabled ? computeNextRun(input.timing, timeZone, new Date()) : null]
    );
    await auditLogService.log({
      tenantId, userId: actor.userId, userEmail: actor.email,
      action: 'report_schedule.create', entityType: 'report_schedule', entityId: id, afterState: input,
    });
    return this.get(tenantId, id);
  }

  /** Whoever edits a schedule becomes its sender (it then runs with their permissions). */
  async update(tenantId: string, id: string, actor: { userId: string; email: string; role: TenantRole }, raw: unknown): Promise<ReportSchedule> {
    const before = await this.get(tenantId, id);
    const input = ReportScheduleInputSchema.parse(raw);
    await this.validate(tenantId, input, actor.role);
    const { timeZone } = await this.workspaceClock(tenantId);
    const { templateId, name, enabled, ...config } = input;
    await pool.query(
      `UPDATE public.report_schedule
       SET template_id = $3, name = $4, config = $5, enabled = $6, created_by = $7, next_run_at = $8, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, templateId, name || null, JSON.stringify(config), enabled, actor.userId, enabled ? computeNextRun(input.timing, timeZone, new Date()) : null]
    );
    await auditLogService.log({
      tenantId, userId: actor.userId, userEmail: actor.email,
      action: 'report_schedule.update', entityType: 'report_schedule', entityId: id, beforeState: before, afterState: input,
    });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string, actor: { userId: string; email: string }): Promise<void> {
    const before = await this.get(tenantId, id);
    await pool.query('DELETE FROM public.report_schedule WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    await auditLogService.log({
      tenantId, userId: actor.userId, userEmail: actor.email,
      action: 'report_schedule.delete', entityType: 'report_schedule', entityId: id, beforeState: before,
    });
  }

  /** Marks a schedule as sending; false when another send of it is already under way. */
  private async claim(id: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE public.report_schedule SET running_since = NOW()
       WHERE id = $1 AND (running_since IS NULL OR running_since < NOW() - INTERVAL '${STALE_RUN_MINUTES} minutes')`,
      [id]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** "Send now" from the screen: sends immediately without moving the regular schedule. */
  async sendNow(tenantId: string, id: string): Promise<ReportSchedule> {
    await this.get(tenantId, id);
    if (!(await this.claim(id))) throw new ReportScheduleError('This report is being sent right now', 409);
    await this.runClaimed(id, false);
    return this.get(tenantId, id);
  }

  /** Sends every schedule that is due (called by the scheduler every minute). */
  async runDue(limit = 5): Promise<number> {
    const due = await pool.query<{ id: string }>(
      `UPDATE public.report_schedule SET running_since = NOW()
       WHERE id IN (
         SELECT id FROM public.report_schedule
         WHERE enabled AND next_run_at <= NOW()
           AND (running_since IS NULL OR running_since < NOW() - INTERVAL '${STALE_RUN_MINUTES} minutes')
         ORDER BY next_run_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [limit]
    );
    for (const { id } of due.rows) {
      await this.runClaimed(id, true);
    }
    return due.rows.length;
  }

  private async runClaimed(id: string, advance: boolean): Promise<void> {
    const res = await pool.query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE s.id = $1`, [id]);
    const row = res.rows[0];
    if (!row) return;
    const clock = await this.workspaceClock(row.tenant_id);
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      await this.sendReport(row, clock);
    } catch (err: any) {
      status = 'failed';
      error = String(err?.message || err).slice(0, 1000);
    }
    // Missed sends (server was down) are not repeated: the next one is the first future time
    const nextRun = advance && row.enabled ? computeNextRun(row.config.timing, clock.timeZone, new Date()) : row.next_run_at;
    await pool.query(
      `UPDATE public.report_schedule
       SET running_since = NULL, last_run_at = NOW(), last_status = $2, last_error = $3, next_run_at = $4
       WHERE id = $1`,
      [id, status, error, nextRun]
    );
  }

  private async sendReport(row: ScheduleRow, clock: Awaited<ReturnType<ReportScheduleService['workspaceClock']>>) {
    if (!row.created_by) throw new Error('The person who set up this schedule was removed. Open it and save it again to send it as yourself.');
    const member = await pool.query<{ role: string; email: string }>(
      `SELECT m.role, u.email FROM public.tenant_member m JOIN public.app_user u ON u.id = m.user_id
       WHERE m.tenant_id = $1 AND m.user_id = $2`,
      [row.tenant_id, row.created_by]
    );
    const sender = member.rows[0];
    if (!sender || !isValidRole(sender.role) || !hasMinRole(sender.role, 'builder')) {
      throw new Error(`${row.created_by_email || 'The person who set up this schedule'} can no longer send reports from this workspace. Someone with Builder access needs to open the schedule and save it again.`);
    }
    const template = await exportTemplateService.getTemplate(row.tenant_id, row.template_id);

    const today = plainDateInTimeZone(new Date(), clock.timeZone);
    const weekStartDay = resolveWeekStartDay(clock.weekStart);
    const parameters = Object.fromEntries(
      Object.entries(row.config.parameters || {}).map(([k, v]) => [k, resolveRelativeDate(v, today, weekStartDay)])
    );

    const file = await renderReportFile({
      tenantId: row.tenant_id,
      userId: row.created_by,
      userEmail: sender.email,
      userRole: sender.role as TenantRole,
      entityId: template.entityId,
      templateId: template.id,
      format: 'xlsx',
      parameters,
    });
    if (file.content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`The report is ${(file.content.length / 1024 / 1024).toFixed(1)} MB, too large to email (limit ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB). Add filters to make it smaller.`);
    }

    const dateLabel = formatPlainDate(today, { dateFormat: !clock.dateFormat || clock.dateFormat === 'auto' ? 'D MMM YYYY' : clock.dateFormat });
    const subject = row.config.subject?.trim() || `${template.name} – ${dateLabel}`;
    const intro = row.config.message?.trim() || `Please find the ${template.name} attached.`;
    const footer = `Sent automatically by ${clock.workspaceName} (${describeScheduleTiming(row.config.timing).toLowerCase()}). Set up by ${sender.email}.`;

    await workspaceMailer.send(row.tenant_id, {
      to: row.config.recipients,
      replyTo: sender.email,
      subject,
      text: `${intro}\n\n${file.filename} is attached.\n\n--\n${footer}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p style="white-space:pre-line">${escapeHtml(intro)}</p>
<p><strong>${escapeHtml(file.filename)}</strong> is attached.</p>
<p style="color:#888;font-size:12px;border-top:1px solid #eee;padding-top:8px">${escapeHtml(footer)}</p>
</div>`,
      attachments: [file],
    });
  }
}

export const reportScheduleService = new ReportScheduleService();
