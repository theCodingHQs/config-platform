import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { EmailDeliverySettingsInputSchema } from '@config-platform/schema';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole } from '../auth/auth-types.js';
import { auditLogService } from '../audit/audit-service.js';
import { workspaceMailer } from '../email/workspace-mailer.js';
import { reportScheduleService, ReportScheduleError } from './report-schedule-service.js';
import { testRecipient } from '../platform/platform-routes.js';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: err.issues.map((i) => i.message).join('; ') });
  }
  if (err instanceof ReportScheduleError) {
    return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message });
  }
  throw err;
}

const forbidden = (reply: FastifyReply, message: string) =>
  reply.status(403).send({ statusCode: 403, error: 'Forbidden', message });

export async function reportScheduleRoutes(fastify: FastifyInstance) {
  // ─── Scheduled report emails (builders and above) ─────────────────────────

  fastify.get('/report-schedules', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) return forbidden(reply, 'Builder role or higher required');
    return reportScheduleService.list(req.session.tenantId);
  });

  fastify.post('/report-schedules', { preHandler: csrfCheckHook }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, email, role } = req.session;
    if (!hasMinRole(role, 'builder')) return forbidden(reply, 'Builder role or higher required to schedule reports');
    try {
      return reply.status(201).send(await reportScheduleService.create(tenantId, { userId, email, role }, req.body));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.put('/report-schedules/:id', { preHandler: csrfCheckHook }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, email, role } = req.session;
    if (!hasMinRole(role, 'builder')) return forbidden(reply, 'Builder role or higher required to schedule reports');
    try {
      return await reportScheduleService.update(tenantId, (req.params as { id: string }).id, { userId, email, role }, req.body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.delete('/report-schedules/:id', { preHandler: csrfCheckHook }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, email, role } = req.session;
    if (!hasMinRole(role, 'builder')) return forbidden(reply, 'Builder role or higher required');
    try {
      await reportScheduleService.remove(tenantId, (req.params as { id: string }).id, { userId, email });
      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post(
    '/report-schedules/:id/send-now',
    { preHandler: csrfCheckHook, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'builder')) return forbidden(reply, 'Builder role or higher required');
      try {
        return await reportScheduleService.sendNow(tenantId, (req.params as { id: string }).id);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ─── How this workspace sends email (admins and owners) ───────────────────

  fastify.get('/workspace/email-settings', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) return forbidden(reply, 'Builder role or higher required');
    return workspaceMailer.getSettings(req.session.tenantId);
  });

  fastify.put('/workspace/email-settings', { preHandler: csrfCheckHook }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId, email, role } = req.session;
    if (!hasMinRole(role, 'admin')) return forbidden(reply, 'Admin role or higher required to change email settings');
    const parsed = EmailDeliverySettingsInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const before = await workspaceMailer.getSettings(tenantId);
    const saved = await workspaceMailer.saveSettings(tenantId, parsed.data);
    await auditLogService.log({
      tenantId, userId, userEmail: email,
      action: 'workspace.email_settings.update', entityType: 'workspace', entityId: tenantId,
      beforeState: before, afterState: saved, // never includes the password
    });
    return saved;
  });

  /** Sends a test message (to the typed address, else the signed-in admin) with the saved settings. */
  fastify.post(
    '/workspace/email-settings/test',
    { preHandler: csrfCheckHook, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, role } = req.session;
      if (!hasMinRole(role, 'admin')) return forbidden(reply, 'Admin role or higher required');
      const to = testRecipient(req);
      if (!to) return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Enter a valid email address to send the test to' });
      try {
        const sent = await workspaceMailer.send(tenantId, {
          to: [to],
          subject: 'Test email: your report emails are set up',
          text: 'This is a test message. If you can read it, scheduled reports from this workspace will reach their recipients.',
          html: '<p style="font-family:Arial,Helvetica,sans-serif">This is a test message. If you can read it, scheduled reports from this workspace will reach their recipients.</p>',
        });
        return { sentTo: to, from: sent.from, via: sent.via };
      } catch (err: any) {
        return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: `The test email could not be sent: ${err?.message || err}` });
      }
    }
  );
}
