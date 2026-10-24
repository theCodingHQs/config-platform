/**
 * The adapter for each connection kind: the shared connectors (also used by the edge agent),
 * plus HTTP push, which only the app server can receive.
 */
import type { LiveConnectionKind } from '@config-platform/schema';
import { CONNECTORS, type AdapterFactory } from '@config-platform/live-connectors';
import { createHttpPushAdapter } from './http-push-adapter.js';

export const ADAPTERS: Record<LiveConnectionKind, AdapterFactory> = {
  ...CONNECTORS,
  'http-push': createHttpPushAdapter,
};

export type { AdapterEvents, AdapterMessage, LiveAdapter } from '@config-platform/live-connectors';
