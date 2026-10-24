/**
 * The server's live cluster. By default servers share live data through Postgres (any number of
 * servers, no extra infrastructure); LIVE_CLUSTER=off runs this server on its own.
 */
import { directPool, pool } from '../../db/pool.js';
import { liveHub } from '../live-hub.js';
import { ruleEngine } from '../rules/rule-engine-instance.js';
import { connectionRepository } from '../connection-repository.js';
import { ruleRepository } from '../rules/rule-repository.js';
import { MemoryBusHub, PgBusTransport } from './bus-transport.js';
import { PgLeaderLock, SoloLeaderLock } from './leader-lock.js';
import { LiveBus } from './live-bus.js';
import { LiveCluster } from './live-cluster.js';
import { AgentRelay } from './agent-relay.js';
import { agentGateway } from '../agents/agent-gateway.js';
import { agentHub } from '../agents/agent-hub.js';

const solo = process.env.LIVE_CLUSTER === 'off';

export const liveCluster = new LiveCluster(
  liveHub,
  ruleEngine,
  new LiveBus(solo ? new MemoryBusHub().transport() : new PgBusTransport(directPool, pool)),
  solo ? new SoloLeaderLock() : new PgLeaderLock(directPool),
  {
    loadConnection: (tenantId, id) => connectionRepository.get(tenantId, id),
    loadConnectionById: (id) => connectionRepository.getById(id),
    loadRules: (tenantId) => ruleRepository.list(tenantId),
  },
  (isLeader, bus) => new AgentRelay(agentGateway, agentHub, bus, isLeader),
);
