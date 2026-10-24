/**
 * Edge agents: a small program inside the factory network that runs live connections there and
 * connects out to the app (no inbound ports). A connection runs on the app server or on an agent.
 */
import { z } from 'zod';
import type { ConnectionState } from './connections.js';

export const LiveAgentInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the agent a name, e.g. Plant 2 gateway PC').max(120),
});
export type LiveAgentInput = z.infer<typeof LiveAgentInputSchema>;

export interface LiveAgent {
  id: string;
  name: string;
  online: boolean;
  /** When it was last connected (ISO) */
  lastSeenAt: string | null;
  /** What the agent reported about itself when it connected */
  version: string | null;
  hostname: string | null;
  createdAt: string;
}

/** A connection as the agent runs it: settings with secrets, sent only to its own agent */
export interface AgentConnectionConfig {
  id: string;
  kind: string;
  settings: Record<string, unknown>;
}

/** Agent → server */
export type AgentToServer =
  | { type: 'hello'; version: string; hostname: string }
  | { type: 'message'; connectionId: string; payload: string; encoding: 'utf8' | 'base64'; topic?: string }
  | { type: 'state'; connectionId: string; state: ConnectionState; error?: string }
  | { type: 'warning'; connectionId: string; warning: string }
  | { type: 'pong' };

/** Server → agent */
export type ServerToAgent =
  /** Every connection the agent should run now (replaces the previous list) */
  | { type: 'config'; connections: AgentConnectionConfig[] }
  | { type: 'ping' };

/** Where agents connect: GET /api/live/agent (WebSocket), with Authorization: Bearer <agent token> */
export const AGENT_SOCKET_PATH = '/api/live/agent';
