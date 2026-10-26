/**
 * One live connection per demo machine, each of a different kind. Every one maps its own message
 * shape to the same five tags (machines.<code>.status/speed/temperature/count/power), which is
 * what each kind's tag rules show off:
 *   OPC UA      one value per node                      value message.speed
 *   Modbus      numbers in registers, status as a code  value message.status_code == 1 ? "running" : …
 *   MQTT        one topic per kind of data              topic plant/+/m04/status
 *   WebSocket   a stream for several machines           when message.machine == "m05"
 *   HTTP poll   a nested JSON reply                     value message.metrics.speed
 *   HTTP push   whatever the device sends               value message.count
 *   Simulator   made-up data, shaped with expressions   value message.status == "running" ? message.speed : 0
 */
import { DEMO_MACHINES, SOURCE_LABELS, type DemoMachine, type SourceKind } from '../catalog.js';
import { GATEWAY_TOKEN, MODBUS_BASE, MQTT_PASSWORD, MQTT_USER, PORTS, REST_API_KEY, SOURCE_HOST } from '../demo-config.js';
import { REGISTER_MAP } from '../sources/modbus-registers.js';
import { opcuaNodeId } from '../sources/opcua-nodes.js';

type Rule = { tag: string; value: string; type?: 'number' | 'text'; unit?: string; label?: string; when?: string; topic?: string; staleAfterSec?: number };

const READINGS = [
  { key: 'status', type: 'text', label: 'Status' },
  { key: 'speed', type: 'number', unit: 'parts/min', label: 'Speed' },
  { key: 'temperature', type: 'number', unit: '°C', label: 'Temperature' },
  { key: 'count', type: 'number', unit: 'parts', label: 'Part count' },
  { key: 'power', type: 'number', unit: 'kW', label: 'Power' },
] as const;
type ReadingKey = (typeof READINGS)[number]['key'];

/** The five tags of a machine; `value` says where each reading is in this kind's messages */
function machineTags(m: DemoMachine, value: (key: ReadingKey) => string, extra: (key: ReadingKey) => Partial<Rule> = () => ({})): Rule[] {
  return READINGS.map((r) => ({
    tag: `machines.${m.code}.${r.key}`,
    value: value(r.key),
    type: r.type,
    ...('unit' in r ? { unit: r.unit } : {}),
    label: `${m.name} ${r.label.toLowerCase()}`,
    staleAfterSec: 15,
    ...extra(r.key),
  }));
}

const STATUS_FROM_CODE = 'message.status_code == 1 ? "running" : message.status_code == 2 ? "idle" : message.status_code == 3 ? "alarm" : "stopped"';

function modbusSettings(m: DemoMachine) {
  return {
    host: SOURCE_HOST,
    port: PORTS.modbus,
    unitId: 1,
    intervalMs: 1000,
    points: REGISTER_MAP.map((p) => ({ key: p.key, area: 'holding', address: MODBUS_BASE[m.code] + p.offset, type: p.type, wordOrder: 'big', scale: p.scale })),
  };
}
// float32 registers give 6.670000076293945 for 6.67
const modbusTags = (m: DemoMachine) => machineTags(m, (k) => (k === 'status' ? STATUS_FROM_CODE : k === 'power' ? 'round(message.power, 2)' : `message.${k}`));

const OPCUA_VARIABLE: Record<ReadingKey, string> = { status: 'Status', speed: 'Speed', temperature: 'Temperature', count: 'PartCount', power: 'Power' };

/** What a connection to each kind looks like (name, kind, settings, tags), by the machine it feeds */
const BUILDERS: Record<SourceKind, (m: DemoMachine) => { kind: string; settings: Record<string, unknown>; tags: Rule[]; viaAgent?: boolean }> = {
  opcua: (m) => ({
    kind: 'opcua',
    settings: {
      endpointUrl: `opc.tcp://${SOURCE_HOST}:${PORTS.opcua}/demo`,
      securityMode: 'None',
      securityPolicy: 'None',
      samplingMs: 1000,
      nodes: READINGS.map((r) => ({ key: r.key, nodeId: opcuaNodeId(m.code, OPCUA_VARIABLE[r.key]) })),
    },
    tags: machineTags(m, (k) => `message.${k}`),
  }),
  modbus: (m) => ({ kind: 'modbus', settings: modbusSettings(m), tags: modbusTags(m) }),
  'agent-modbus': (m) => ({ kind: 'modbus', settings: modbusSettings(m), tags: modbusTags(m), viaAgent: true }),
  mqtt: (m) => ({
    kind: 'mqtt',
    settings: { url: `mqtt://${SOURCE_HOST}:${PORTS.mqtt}`, username: MQTT_USER, password: MQTT_PASSWORD, topics: [`plant/+/${m.code}/#`], qos: 0, format: 'json' },
    tags: machineTags(
      m,
      (k) => (k === 'status' ? 'message.state' : `message.${k}`),
      (k) => ({ topic: `plant/+/${m.code}/${k === 'status' ? 'status' : 'telemetry'}` }),
    ),
  }),
  websocket: (m) => ({
    kind: 'websocket',
    settings: {
      url: `ws://${SOURCE_HOST}:${PORTS.websocket}`,
      headers: [{ name: 'Authorization', value: `Bearer ${GATEWAY_TOKEN}` }],
      subscribeMessage: JSON.stringify({ subscribe: [m.code] }),
      format: 'json',
    },
    tags: machineTags(m, (k) => `message.data.${k}`, () => ({ when: `message.machine == "${m.code}"` })),
  }),
  'http-poll': (m) => ({
    kind: 'http-poll',
    settings: { url: `http://${SOURCE_HOST}:${PORTS.http}/api/machines/${m.code}`, headers: [{ name: 'X-Api-Key', value: REST_API_KEY }], intervalSec: 2, format: 'json' },
    tags: machineTags(m, (k) => (k === 'status' ? 'message.state.status' : `message.metrics.${k}`)),
  }),
  'http-push': (m) => ({ kind: 'http-push', settings: { format: 'json' }, tags: machineTags(m, (k) => `message.${k}`) }),
  simulator: (m) => {
    const statusCycle = [...Array(6).fill('running'), 'idle', ...Array(4).fill('running'), 'alarm'];
    return {
      kind: 'simulator',
      settings: {
        intervalMs: 1000,
        signals: [
          { key: 'status', pattern: 'cycle', values: statusCycle, period: 20 },
          { key: 'speed', pattern: 'random', min: m.ratedSpeed * 0.85, max: m.ratedSpeed * 1.05 },
          { key: 'count', pattern: 'counter', min: 0, period: m.ratedSpeed / 60 },
          { key: 'temperature', pattern: 'wave', min: m.baseTemperature + 26, max: m.baseTemperature + 34, period: 120 },
          { key: 'power', pattern: 'random', min: 5, max: 7 },
        ],
      },
      tags: machineTags(m, (k) =>
        k === 'speed' ? 'message.status == "running" ? message.speed : 0' : k === 'count' ? 'floor(message.count)' : k === 'power' ? 'message.status == "running" ? message.power : 0.8' : `message.${k}`,
      ),
    };
  },
};

export const connectionName = (m: DemoMachine) => `${m.name} · ${SOURCE_LABELS[m.source]}`;

export interface ConnectionPlan {
  machine: DemoMachine;
  input: { name: string; kind: string; enabled: boolean; settings: Record<string, unknown>; tags: Rule[]; agentId: string | null };
}

export function connectionPlans(agentId: string | null): ConnectionPlan[] {
  return DEMO_MACHINES.map((m) => {
    const { viaAgent, ...built } = BUILDERS[m.source](m);
    return { machine: m, input: { name: connectionName(m), enabled: true, ...built, agentId: viaAgent ? agentId : null } };
  });
}

