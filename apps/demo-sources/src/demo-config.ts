/**
 * Where the stand-in sources listen, the secrets they expect, and what `setup` saved for `start`
 * (the HTTP push token and the edge agent token are shown only once by the app, so they're kept
 * in .demo-state.json next to this package; it is git-ignored).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};

export const PORTS = {
  websocket: num('DEMO_WS_PORT', 8765),
  mqtt: num('DEMO_MQTT_PORT', 1883),
  opcua: num('DEMO_OPCUA_PORT', 4840),
  modbus: num('DEMO_MODBUS_PORT', 5020),
  http: num('DEMO_HTTP_PORT', 8780),
};

/** Host the app (or the edge agent) reaches the sources on */
export const SOURCE_HOST = process.env.DEMO_SOURCE_HOST || '127.0.0.1';

/** Secrets the stand-ins check, as a real gateway or vendor API would */
export const GATEWAY_TOKEN = 'demo-gateway-token';
export const REST_API_KEY = 'demo-api-key';
export const MQTT_USER = 'demo';
export const MQTT_PASSWORD = 'demo-mqtt-password';

/** Modbus: each machine's registers start here (unit 1) */
export const MODBUS_BASE: Record<string, number> = { m03: 0, m02: 100 };

export interface DemoState {
  platformUrl: string;
  push?: { connectionId: string; token: string };
  agent?: { id: string; token: string };
}

const STATE_FILE = fileURLToPath(new URL('../.demo-state.json', import.meta.url));

export function readState(): DemoState | null {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as DemoState;
}

export function writeState(state: DemoState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}
