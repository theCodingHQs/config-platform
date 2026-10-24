/**
 * Connectors to machines and systems, shared by the app server and the edge agent. Each turns
 * one kind of source into the same thing: messages, and connection states.
 */
import type { LiveConnectionKind } from '@config-platform/schema';
import type { AdapterFactory } from './adapter-types.js';
import { createWebSocketAdapter } from './websocket.js';
import { createMqttAdapter } from './mqtt.js';
import { createOpcUaAdapter } from './opcua.js';
import { createModbusAdapter } from './modbus.js';
import { createHttpPollAdapter } from './http-poll.js';
import { createSimulatorAdapter } from './simulator.js';

/** Kinds that connect out to a source (HTTP push is received by the app server itself) */
export type ConnectorKind = Exclude<LiveConnectionKind, 'http-push'>;

export const CONNECTORS: Record<ConnectorKind, AdapterFactory> = {
  websocket: createWebSocketAdapter,
  mqtt: createMqttAdapter,
  opcua: createOpcUaAdapter,
  modbus: createModbusAdapter,
  'http-poll': createHttpPollAdapter,
  simulator: createSimulatorAdapter,
};

export * from './adapter-types.js';
export { Backoff } from './backoff.js';
export { describeConnectionError } from './connection-errors.js';
export { decodeRegisters, registerCount, type ModbusType } from './modbus-decode.js';
export { plainOpcUaValue } from './opcua.js';
export { simulatedValue } from './simulator.js';
