/**
 * Edge agents across servers: an agent may be connected to any server, but only the leader's
 * AgentHub acts on what it says. This relays agent traffic between the server holding the
 * socket and the leader, over the bus.
 */
import type { AgentToServer, ServerToAgent } from '@config-platform/schema';
import type { AgentGateway } from '../agents/agent-gateway.js';
import type { AgentHub } from '../agents/agent-hub.js';
import type { LiveBus, LiveBusEvent } from './live-bus.js';

export class AgentRelay {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly hub: AgentHub,
    private readonly bus: LiveBus,
    private readonly isLeader: () => boolean,
  ) {
    gateway.setHandlers({
      message: (agentId, message) => (this.isLeader() ? hub.fromAgent(agentId, message) : bus.publish({ t: 'agent-in', agentId, message })),
      offline: (agentId) => (this.isLeader() ? hub.agentOffline(agentId) : bus.publish({ t: 'agent-offline', agentId })),
    });
    hub.setSender((agentId, message: ServerToAgent) => {
      if (!gateway.send(agentId, message)) bus.publish({ t: 'agent-out', agentId, message });
    });
  }

  /** This server became (or stopped being) the leader */
  leaderChanged(isLeader: boolean): void {
    if (!isLeader) {
      this.hub.clear();
      return;
    }
    // Agents connected here count as online for the new leader
    for (const [agentId, hello] of this.gateway.connectedHellos()) this.hub.fromAgent(agentId, hello);
  }

  /** Bus events about agents; returns false for other events */
  handle(event: LiveBusEvent): boolean {
    switch (event.t) {
      case 'agent-in':
        if (this.isLeader()) this.hub.fromAgent(event.agentId, event.message as AgentToServer);
        return true;
      case 'agent-offline':
        if (this.isLeader()) this.hub.agentOffline(event.agentId);
        return true;
      case 'agent-out':
        this.gateway.send(event.agentId, event.message as ServerToAgent);
        return true;
      case 'leader':
        // Introduce this server's agents to the new leader
        if (!this.isLeader()) for (const [agentId, message] of this.gateway.connectedHellos()) this.bus.publish({ t: 'agent-in', agentId, message });
        return false; // the cluster acts on it too
      default:
        return false;
    }
  }
}
