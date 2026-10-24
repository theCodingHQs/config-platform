/**
 * Edge agent settings (Studio → Live → Edge agents). Admins and owners only: an agent's token
 * lets a program inside the factory receive connection settings, passwords included.
 */
import type { FastifyInstance } from 'fastify';
import { LiveAgentInputSchema } from '@config-platform/schema';
import { csrfCheckHook } from '../../auth/session-middleware.js';
import { auditLogService } from '../../audit/audit-service.js';
import { guarded, idOf } from '../live-route-guard.js';
import { LiveSettingsError } from '../live-errors.js';
import { agentRepository, newAgentToken } from './agent-repository.js';

function parseName(body: unknown): string {
  const parsed = LiveAgentInputSchema.safeParse(body);
  if (!parsed.success) throw new LiveSettingsError(parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data.name;
}

const view = ({ tenantId: _t, ...agent }: Awaited<ReturnType<typeof agentRepository.get>> & object) => agent;

export async function agentRoutes(fastify: FastifyInstance) {
  // Builders see agents to choose where a connection runs; admins manage them
  fastify.get('/live/agents', guarded('builder', async (req) => (await agentRepository.list(req.session.tenantId)).map(view)));

  fastify.post('/live/agents', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const { token, tokenHash } = newAgentToken();
    const agent = await agentRepository.create(tenantId, userId, parseName(req.body), tokenHash);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.agent.create', entityType: 'live_agent', entityId: agent.id, afterState: view(agent) });
    // The token is shown this once; only its hash is kept
    return reply.status(201).send({ ...view(agent), token });
  }));

  fastify.put('/live/agents/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req) => {
    const agent = await agentRepository.rename(req.session.tenantId, idOf(req), parseName(req.body));
    if (!agent) throw new LiveSettingsError('Edge agent not found', 404);
    return view(agent);
  }));

  fastify.post('/live/agents/:id/token', { preHandler: csrfCheckHook }, guarded('admin', async (req) => {
    const { tenantId, userId, email } = req.session;
    const { token, tokenHash } = newAgentToken();
    if (!(await agentRepository.setToken(tenantId, idOf(req), tokenHash))) throw new LiveSettingsError('Edge agent not found', 404);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.agent.token', entityType: 'live_agent', entityId: idOf(req) });
    return { token };
  }));

  fastify.delete('/live/agents/:id', { preHandler: csrfCheckHook }, guarded('admin', async (req, reply) => {
    const { tenantId, userId, email } = req.session;
    const inUse = await agentRepository.connectionCount(tenantId, idOf(req));
    if (inUse > 0) throw new LiveSettingsError(`${inUse} connection${inUse === 1 ? ' runs' : 's run'} on this agent. Move ${inUse === 1 ? 'it' : 'them'} to another agent or the app server first.`, 409);
    if (!(await agentRepository.remove(tenantId, idOf(req)))) throw new LiveSettingsError('Edge agent not found', 404);
    await auditLogService.log({ tenantId, userId, userEmail: email, action: 'live.agent.delete', entityType: 'live_agent', entityId: idOf(req) });
    return reply.status(204).send();
  }));
}
