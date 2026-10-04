/**
 * Fastify plugin: session middleware.
 *
 * Reads the httpOnly `sid` cookie, resolves the session from the DB,
 * and decorates the request with `req.session`. Returns 401 if no
 * valid session is found.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService, SESSION_COOKIE } from './auth-service.js';
import type { SessionPayload } from './auth-types.js';

// Augment Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload;
  }
}

/**
 * Decorates the root Fastify instance with `req.session`.
 * Must be called once on the root instance (in buildServer) before any plugins.
 */
export function decorateSession(fastify: FastifyInstance) {
  if (!fastify.hasRequestDecorator('session')) {
    fastify.decorateRequest('session', null as unknown as SessionPayload);
  }
}

/**
 * Attaches the session resolution hook directly to a Fastify instance.
 * Must be called on the protected scope so all child plugins inherit the hook.
 */
export function registerSessionHook(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = req.cookies as Record<string, string> | undefined;
    const sessionId = cookies?.[SESSION_COOKIE];
    if (!sessionId) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    }

    const session = await authService.resolveSession(sessionId);
    if (!session) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Session expired or invalid' });
    }

    req.session = session;
  });
}

/**
 * Plugin that adds the session-resolution preHandler to a scoped sub-app.
 */
export async function sessionMiddlewarePlugin(fastify: FastifyInstance) {
  registerSessionHook(fastify);
}

/**
 * CSRF protection hook for state-changing routes.
 *
 * Uses double-submit cookie pattern:
 * - Server sets a csrf cookie on GET /auth/csrf
 * - Client must echo it back in x-csrf-token header on POST/PUT/PATCH/DELETE
 */
export function csrfCheckHook(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    done();
    return;
  }

  const cookies = req.cookies as Record<string, string>;
  const cookieToken = cookies?.['csrf_token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'CSRF token mismatch',
    });
    return;
  }

  done();
}
