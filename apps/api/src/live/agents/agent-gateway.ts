/**
 * Edge agents connected to this server. Knows sockets, not connections: what agents say is handed
 * to the cluster (which passes it to the leader), and messages for an agent are sent here if this
 * server holds its socket.
 */
import type { AgentToServer, ServerToAgent } from '@config-platform/schema';

export interface AgentSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

interface Handlers {
  message: (agentId: string, message: AgentToServer) => void;
  offline: (agentId: string) => void;
}

export class AgentGateway {
  private readonly sockets = new Map<string, AgentSocket>();
  /** Each agent's hello, to introduce it again to a new leader */
  private readonly hellos = new Map<string, Extract<AgentToServer, { type: 'hello' }>>();
  private handlers: Handlers = { message: () => undefined, offline: () => undefined };

  setHandlers(handlers: Handlers): void {
    this.handlers = handlers;
  }

  /** One socket per agent: a newer connection of the same agent replaces the older one */
  connected(agentId: string, socket: AgentSocket): void {
    const old = this.sockets.get(agentId);
    this.sockets.set(agentId, socket);
    old?.close(4409, 'Replaced by a newer connection of the same agent');
  }

  received(agentId: string, socket: AgentSocket, message: AgentToServer): void {
    if (this.sockets.get(agentId) !== socket) return;
    if (message.type === 'hello') this.hellos.set(agentId, message);
    this.handlers.message(agentId, message);
  }

  disconnected(agentId: string, socket: AgentSocket): void {
    if (this.sockets.get(agentId) !== socket) return;
    this.sockets.delete(agentId);
    this.hellos.delete(agentId);
    this.handlers.offline(agentId);
  }

  /** True when this server holds the agent's socket (and sent it the message) */
  send(agentId: string, message: ServerToAgent): boolean {
    const socket = this.sockets.get(agentId);
    if (!socket) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  /** Agents connected here, with their hellos (for a new leader) */
  connectedHellos(): Array<[string, Extract<AgentToServer, { type: 'hello' }>]> {
    return [...this.hellos.entries()];
  }
}

export const agentGateway = new AgentGateway();
