import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { auditLogService } from '../audit/audit-service.js';
import { platformSettings, PlatformSettingsError } from './platform-settings.js';

/** Platform setup: server-wide settings, for platform owners only (whatever their workspace role). */
export async function platformRoutes(fastify: FastifyInstance) {
  const requireOwner = async (req: FastifyRequest, reply: FastifyReply) => {
    // Checked against the database, not just the session, so a removed owner loses access at once
    if (!(await platformSettings.isPlatformAdmin(req.session.userId))) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only platform owners can open Platform setup' });
    }
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ZodError) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: err.issues.map((i) => i.message).join('; ') });
    }
    if (err instanceof PlatformSettingsError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message });
    }
    throw err;
  };
  const audit = (req: FastifyRequest, action: string, afterState: unknown) =>
    auditLogService.log({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action,
      entityType: 'platform',
      entityId: 'platform',
      afterState,
    });

  fastify.get('/platform/settings', { preHandler: requireOwner }, async () => platformSettings.view());

  fastify.put('/platform/settings', { preHandler: [csrfCheckHook, requireOwner] }, async (req, reply) => {
    try {
      const view = await platformSettings.save((req.body as any) || {}, req.session.userId);
      await audit(req, 'platform.settings.update', { ...view, platformAdmins: undefined }); // never contains secrets
      return view;
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Sends a test message to the signed-in owner through the platform's email service. */
  fastify.post(
    '/platform/settings/test-email',
    { preHandler: [csrfCheckHook, requireOwner], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      try {
        const sent = await platformSettings.send({
          to: [req.session.email],
          subject: 'Test email: the platform can send email',
          text: 'This is a test message from Platform setup. Invites, confirmations and report emails will be sent this way.',
          html: '<p style="font-family:Arial,Helvetica,sans-serif">This is a test message from Platform setup. Invites, confirmations and report emails will be sent this way.</p>',
        });
        if (!sent) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Choose an email service and save it first.' });
        return { sentTo: req.session.email, from: sent.from, via: sent.via };
      } catch (err: any) {
        return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: `The test email could not be sent: ${err?.message || err}` });
      }
    }
  );

  fastify.post('/platform/admins', { preHandler: [csrfCheckHook, requireOwner] }, async (req, reply) => {
    const email = String((req.body as any)?.email || '').trim();
    if (!email) return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Enter an email address' });
    try {
      await platformSettings.addAdmin(email);
      await audit(req, 'platform.admin.add', { email });
      return (await platformSettings.view()).platformAdmins;
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.delete('/platform/admins/:userId', { preHandler: [csrfCheckHook, requireOwner] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    try {
      await platformSettings.removeAdmin(userId);
      await audit(req, 'platform.admin.remove', { userId });
      return (await platformSettings.view()).platformAdmins;
    } catch (err) {
      return fail(reply, err);
    }
  });
}
