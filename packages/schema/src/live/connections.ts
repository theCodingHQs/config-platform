/**
 * Live connections: where live data comes from (a machine gateway's WebSocket, an MQTT broker,
 * the built-in simulator…) and how its messages become tags.
 *
 * Every kind produces the same thing — messages, mapped to tags by the connection's tag rules —
 * so pages and visuals never depend on the kind. New kinds (OPC UA, Modbus, HTTP) add a settings
 * schema here and an adapter on the server; nothing else changes.
 */
import { z } from 'zod';
import { TagNameSchema, TAG_VALUE_TYPES } from './tags.js';
import { PageRoleSchema } from '../page.js';

export const LIVE_CONNECTION_KINDS = ['websocket', 'mqtt', 'opcua', 'modbus', 'http-push', 'http-poll', 'simulator'] as const;
export type LiveConnectionKind = (typeof LIVE_CONNECTION_KINDS)[number];

/** How a message's bytes are read before tag rules see it as `message` */
export const MessageFormatSchema = z.enum(['json', 'text', 'number']);
export type MessageFormat = z.infer<typeof MessageFormatSchema>;

/**
 * A secret (password, token) as sent from the settings screen: a new value, or omitted to keep
 * the saved one. It is stored encrypted and never sent back.
 */
const SecretInputSchema = z.string().max(4096).optional();

const HeaderSchema = z.object({
  name: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9-]+$/, 'Header names use letters, numbers and -'),
  /** Write-only, like a password (tokens often go in headers) */
  value: SecretInputSchema,
});

export const WebSocketSettingsSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter the address, e.g. wss://gateway.factory.local/stream')
    .refine((u) => /^wss?:\/\//i.test(u), 'The address must start with ws:// or wss://'),
  headers: z.array(HeaderSchema).max(20).optional().default([]),
  /** Sent after connecting, e.g. a subscription request; may be JSON or plain text */
  subscribeMessage: z.string().max(10_000).optional(),
  format: MessageFormatSchema.default('json'),
});

export const MqttSettingsSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter the broker address, e.g. mqtts://broker.factory.local:8883')
    .refine((u) => /^(mqtts?|wss?):\/\//i.test(u), 'The address must start with mqtt://, mqtts://, ws:// or wss://'),
  username: z.string().trim().max(200).optional().default(''),
  password: SecretInputSchema,
  clientId: z.string().trim().max(120).optional(),
  /** Topic filters; + matches one level, # the rest: factory/line1/+/status */
  topics: z.array(z.string().trim().min(1).max(500)).min(1, 'Add at least one topic').max(100),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  format: MessageFormatSchema.default('json'),
});

/** OPC UA: the standard of modern PLCs and SCADA systems; values arrive as they change. */
export const OpcUaSettingsSchema = z.object({
  endpointUrl: z
    .string()
    .trim()
    .refine((u) => /^opc\.tcp:\/\/[^\s/]+/i.test(u), 'The address must start with opc.tcp://, e.g. opc.tcp://plc-line1.local:4840'),
  securityMode: z.enum(['None', 'Sign', 'SignAndEncrypt']).default('None'),
  securityPolicy: z.enum(['None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss']).default('None'),
  username: z.string().trim().max(200).optional().default(''),
  password: SecretInputSchema,
  /** Values to watch: a name for the message, and the node, e.g. ns=2;s=Line1.Speed */
  nodes: z
    .array(z.object({ key: z.string().trim().min(1).max(60).regex(/^[A-Za-z_]\w*$/, 'Use letters, numbers and _'), nodeId: z.string().trim().min(1).max(500) }))
    .min(1, 'Add at least one value to watch')
    .max(500),
  samplingMs: z.number().int().min(100).max(60_000).default(1000),
});

export const MODBUS_AREAS = ['holding', 'input', 'coil', 'discrete'] as const;
export const MODBUS_TYPES = ['uint16', 'int16', 'uint32', 'int32', 'float32', 'bool'] as const;

/** Modbus TCP: PLCs, power meters and older equipment; registers read on a timer. */
export const ModbusSettingsSchema = z.object({
  host: z.string().trim().min(1, 'Enter the device address, e.g. 192.168.1.20').max(255),
  port: z.number().int().min(1).max(65535).default(502),
  unitId: z.number().int().min(0).max(255).default(1),
  intervalMs: z.number().int().min(200, 'At most 5 reads a second').max(3_600_000).default(1000),
  points: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60).regex(/^[A-Za-z_]\w*$/, 'Use letters, numbers and _'),
        area: z.enum(MODBUS_AREAS).default('holding'),
        address: z.number().int().min(0).max(65535),
        type: z.enum(MODBUS_TYPES).default('uint16'),
        /** 32-bit values: which register holds the high word */
        wordOrder: z.enum(['big', 'little']).default('big'),
        /** Raw value × scale, e.g. 0.1 for a register holding tenths of a degree */
        scale: z.number().default(1),
      }),
    )
    .min(1, 'Add at least one register to read')
    .max(200),
});

/** HTTP push: devices and systems send messages to the connection's own address with a token. */
export const HttpPushSettingsSchema = z.object({
  format: MessageFormatSchema.default('json'),
});

/** HTTP polling: an MES/ERP or device web API, fetched every few seconds. */
export const HttpPollSettingsSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter the address, e.g. https://mes.factory.local/api/line1/status')
    .refine((u) => /^https?:\/\//i.test(u), 'The address must start with http:// or https://'),
  headers: z.array(HeaderSchema).max(20).optional().default([]),
  intervalSec: z.number().int().min(1, 'At most once a second').max(3600).default(10),
  format: MessageFormatSchema.default('json'),
});

/** Demo data without hardware: each signal changes on its own, as a real line would. */
export const SimulatorSignalSchema = z.object({
  /** Key in the simulated message: { "speed": 41.2, … } */
  key: z.string().trim().min(1).max(60).regex(/^[A-Za-z_]\w*$/, 'Use letters, numbers and _'),
  pattern: z.enum(['wave', 'random', 'counter', 'cycle']),
  /** wave/random: the range · counter: the step per tick */
  min: z.number().default(0),
  max: z.number().default(100),
  /** wave: seconds per full wave · counter: added each tick */
  period: z.number().positive().max(86_400).default(30),
  /** cycle: values taken in turn, e.g. running, running, stopped */
  values: z.array(z.string().max(60)).max(50).optional(),
});

export const SimulatorSettingsSchema = z.object({
  intervalMs: z.number().int().min(100, 'At most 10 messages a second').max(60_000).default(1000),
  signals: z.array(SimulatorSignalSchema).min(1, 'Add at least one signal').max(50),
});

/**
 * How one tag gets its value from messages. `value` and `when` are expressions over `message`
 * (the decoded message) and `topic` (MQTT): value message.speed, when message.line == "L1".
 */
export const TagRuleSchema = z.object({
  tag: TagNameSchema,
  value: z.string().trim().min(1, 'Say where the value is, e.g. message.speed').max(500),
  /** Only messages for which this is true update the tag (optional) */
  when: z.string().trim().max(500).optional(),
  /** MQTT: only messages on topics matching this filter (optional) */
  topic: z.string().trim().max(500).optional(),
  type: z.enum(TAG_VALUE_TYPES).default('number'),
  unit: z.string().trim().max(20).optional(),
  label: z.string().trim().max(120).optional(),
  /** Seconds without an update after which the value is shown as stale (optional) */
  staleAfterSec: z.number().int().positive().max(86_400).optional(),
});
export type TagRule = z.infer<typeof TagRuleSchema>;

const base = {
  name: z.string().trim().min(1, 'Give the connection a name').max(120),
  enabled: z.boolean().default(true),
  tags: z.array(TagRuleSchema).max(500).default([]),
  /** Roles that may see this connection's tags; empty = everyone in the workspace */
  viewRoles: z.array(PageRoleSchema).max(5).default([]),
  /** Runs on this edge agent (inside the factory network); null = on the app server */
  agentId: z.string().min(1).nullable().optional().default(null),
};

export const LiveConnectionInputSchema = z
  .discriminatedUnion('kind', [
    z.object({ ...base, kind: z.literal('websocket'), settings: WebSocketSettingsSchema }),
    z.object({ ...base, kind: z.literal('mqtt'), settings: MqttSettingsSchema }),
    z.object({ ...base, kind: z.literal('opcua'), settings: OpcUaSettingsSchema }),
    z.object({ ...base, kind: z.literal('modbus'), settings: ModbusSettingsSchema }),
    z.object({ ...base, kind: z.literal('http-push'), settings: HttpPushSettingsSchema }),
    z.object({ ...base, kind: z.literal('http-poll'), settings: HttpPollSettingsSchema }),
    z.object({ ...base, kind: z.literal('simulator'), settings: SimulatorSettingsSchema }),
  ])
  .superRefine((input, ctx) => {
    if (input.kind === 'http-push' && input.agentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agentId'], message: "HTTP push is received by the app itself, so it can't run on an edge agent" });
    }
    const seen = new Set<string>();
    input.tags.forEach((rule, i) => {
      if (seen.has(rule.tag)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags', i, 'tag'], message: `Tag "${rule.tag}" is listed twice` });
      }
      seen.add(rule.tag);
    });
  });
export type LiveConnectionInput = z.infer<typeof LiveConnectionInputSchema>;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'disabled';

export interface LiveConnectionStatus {
  state: ConnectionState;
  /** Why it isn't connected, in plain words */
  error?: string;
  /** Connected, but something needs attention (e.g. one OPC UA value can't be watched) */
  warning?: string;
  /** Last message received (ISO) */
  lastMessageAt?: string;
  messagesReceived: number;
}

/**
 * A saved connection as the settings screen sees it: secrets are replaced by whether one is
 * saved (hasPassword, header hasValue), never their value.
 */
export interface LiveConnection {
  id: string;
  name: string;
  kind: LiveConnectionKind;
  enabled: boolean;
  settings: Record<string, any>;
  tags: TagRule[];
  viewRoles: Array<z.infer<typeof PageRoleSchema>>;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  status?: LiveConnectionStatus;
}
