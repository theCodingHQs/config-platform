/** The adapter for each connection kind. A new kind = its adapter file + one line here. */
import type { LiveConnectionKind } from '@config-platform/schema';
import type { AdapterFactory } from './adapter-types.js';
import { createWebSocketAdapter } from './websocket-adapter.js';
import { createMqttAdapter } from './mqtt-adapter.js';
import { createOpcUaAdapter } from './opcua-adapter.js';
import { createModbusAdapter } from './modbus-adapter.js';
import { createHttpPushAdapter } from './http-push-adapter.js';
import { createHttpPollAdapter } from './http-poll-adapter.js';
import { createSimulatorAdapter } from './simulator-adapter.js';

export const ADAPTERS: Record<LiveConnectionKind, AdapterFactory> = {
  websocket: createWebSocketAdapter,
  mqtt: createMqttAdapter,
  opcua: createOpcUaAdapter,
  modbus: createModbusAdapter,
  'http-push': createHttpPushAdapter,
  'http-poll': createHttpPollAdapter,
  simulator: createSimulatorAdapter,
};

export type { AdapterEvents, AdapterMessage, LiveAdapter } from './adapter-types.js';
