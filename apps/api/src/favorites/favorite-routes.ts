/** Favorite pages: each person's own shortcuts, shown in the sidebar. Any role can keep them. */
import type { FastifyInstance } from 'fastify';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { guarded, idOf } from '../live/live-route-guard.js';
import { favoriteService } from './favorite-service.js';

export async function favoriteRoutes(fastify: FastifyInstance) {
  fastify.get('/favorites', guarded('viewer', async (req) => favoriteService.list(req.session.tenantId, req.session.userId)));

  fastify.post('/favorites', { preHandler: csrfCheckHook }, guarded('viewer', async (req, reply) => {
    const { favorite, created } = await favoriteService.add(req.session.tenantId, req.session.userId, req.body);
    return reply.status(created ? 201 : 200).send(favorite);
  }));

  fastify.put('/favorites/:id', { preHandler: csrfCheckHook }, guarded('viewer', async (req) =>
    favoriteService.rename(req.session.tenantId, req.session.userId, idOf(req), req.body)));

  fastify.delete('/favorites/:id', { preHandler: csrfCheckHook }, guarded('viewer', async (req, reply) => {
    await favoriteService.remove(req.session.tenantId, req.session.userId, idOf(req));
    return reply.status(204).send();
  }));
}
