/**
 * The leader's side of edge agents. A connection that runs on an agent is "attached" here instead
 * of starting a connector: the agent is sent the connections it should run, and what it reports
 * (messages, states, warnings) goes into the same pipeline as a connection run on the server.
 */
import type { AgentConnectionConfig, AgentToServer, ServerToAgent } from '@config-platform/schema';
import type { AdapterEvents, AdapterFactory } from '@config-platform/live-connectors';

interface Attached {
  connectionId: string;
  agentId: string;
  kind: string;
  /** Settings with secrets: sent only to the agent that runs the connection */
  settings: Record<string, unknown>;
  events: AdapterEvents;
}

export const AGENT_OFFLINE = "The edge agent that runs this connection is offline. Check that it's running and can reach the app.";

export class AgentHub {
  private readonly attached = new Map<string, Attached>();
  private readonly online = new Set<string>();
  private send: (agentId: string, message: ServerToAgent) => void = () => undefined;

  /** How messages reach agents (directly, or through the server an agent is connected to) */
  setSender(send: (agentId: string, message: ServerToAgent) => void): void {
    this.send = send;
  }

  /** The connector factory used for connections that run on `agentId` */
  proxyFor(agentId: string, kind: string): AdapterFactory {
    return (settings, events, context) => ({
      start: () => this.attach({ connectionId: context.connectionId, agentId, kind, settings, events }),
      stop: async () => this.detach(context.connectionId),
    });
  }

  isOnline(agentId: string): boolean {
    return this.online.has(agentId);
  }

  agentOnline(agentId: string): void {
    this.online.add(agentId);
    for (const a of this.ofAgent(agentId)) a.events.onState('connecting');
    this.pushConfig(agentId);
  }

  agentOffline(agentId: string): void {
    this.online.delete(agentId);
    for (const a of this.ofAgent(agentId)) a.events.onState('disconnected', AGENT_OFFLINE);
  }

  /** What an agent reported. Only about its own connections: anything else is ignored. */
  fromAgent(agentId: string, message: AgentToServer): void {
    if (message.type === 'hello') return this.agentOnline(agentId);
    if (message.type === 'pong') return;
    const a = this.attached.get(message.connectionId);
    if (!a || a.agentId !== agentId) return;
    switch (message.type) {
      case 'message':
        a.events.onMessage({ payload: message.encoding === 'base64' ? Buffer.from(message.payload, 'base64') : message.payload, topic: message.topic });
        return;
      case 'state':
        a.events.onState(message.state, message.error);
        return;
      case 'warning':
        a.events.onWarning(message.warning);
        return;
    }
  }

  /** Connections an agent should run now */
  configFor(agentId: string): AgentConnectionConfig[] {
    return this.ofAgent(agentId).map((a) => ({ id: a.connectionId, kind: a.kind, settings: a.settings }));
  }

  /** The leader stopped: forget everything (the new leader rebuilds it) */
  clear(): void {
    this.attached.clear();
    this.online.clear();
  }

  private attach(a: Attached): void {
    this.attached.set(a.connectionId, a);
    if (this.online.has(a.agentId)) {
      a.events.onState('connecting');
      this.pushConfig(a.agentId);
    } else {
      a.events.onState('disconnected', AGENT_OFFLINE);
    }
  }

  private detach(connectionId: string): void {
    const a = this.attached.get(connectionId);
    if (!a) return;
    this.attached.delete(connectionId);
    if (this.online.has(a.agentId)) this.pushConfig(a.agentId);
  }

  private pushConfig(agentId: string): void {
    this.send(agentId, { type: 'config', connections: this.configFor(agentId) });
  }

  private ofAgent(agentId: string): Attached[] {
    return [...this.attached.values()].filter((a) => a.agentId === agentId);
  }
}

export const agentHub = new AgentHub();
