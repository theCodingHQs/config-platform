/**
 * Messages between the browser and the server on the live socket (/api/live/socket).
 * The browser says which tags it wants; the server sends their values as they change.
 */
import type { TagValue } from './tags.js';
import type { LiveConnectionStatus } from './connections.js';

export type LiveClientMessage =
  /** Tags (or groups, e.g. "line1") this page uses; replaces the previous list */
  | { type: 'subscribe'; tags: string[] }
  | { type: 'ping' };

export type LiveServerMessage =
  /** Current values of every subscribed tag, sent after each subscribe */
  | { type: 'snapshot'; values: Record<string, TagValue> }
  /** Values that changed since the last message (batched, at most a few times a second) */
  | { type: 'values'; values: Record<string, TagValue> }
  /** Connection states, by connection id (only the ones the viewer can see) */
  | { type: 'status'; connections: Record<string, LiveConnectionStatus & { name: string }> }
  | { type: 'pong' }
  | { type: 'error'; message: string };

/** How often the server sends batched changes at most (ms) */
export const LIVE_BATCH_MS = 200;
