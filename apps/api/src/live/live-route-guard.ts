/** Role check + error handling shared by the live settings routes */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasMinRole, type TenantRole } from '../auth/auth-types.js';
import { LiveSettingsError } from './live-errors.js';

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Runs a handler for `minRole` and above, turning LiveSettingsError into its status code */
export const guarded = (minRole: TenantRole, handler: Handler): Handler => async (req, reply) => {
  if (!hasMinRole(req.session.role, minRole)) {
    const who = minRole === 'admin' ? 'Admins and owners' : 'Builders, admins and owners';
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: `${who} can do this` });
  }
  try {
    return await handler(req, reply);
  } catch (err) {
    if (err instanceof LiveSettingsError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message });
    }
    throw err;
  }
};

export const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;
