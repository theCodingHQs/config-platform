/**
 * Modbus TCP source: reads the configured registers and coils on a timer and sends them as one
 * JSON message, e.g. { "speed": 41.5, "temperature": 61.2, "running": true }.
 */
import ModbusModule from 'modbus-serial';
import type { ModbusRTU as ModbusClient } from 'modbus-serial/ModbusRTU.js';

// At runtime the default export is the client class; its type file describes it as a module
const ModbusRTU = ModbusModule as unknown as typeof ModbusClient;
type ModbusRTU = ModbusClient;
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';
import { Backoff } from './backoff.js';
import { describeConnectionError } from './connection-errors.js';
import { decodeRegisters, registerCount, type ModbusType } from './modbus-decode.js';

interface Point {
  key: string;
  area: 'holding' | 'input' | 'coil' | 'discrete';
  address: number;
  type: ModbusType;
  wordOrder: 'big' | 'little';
  scale: number;
}

async function readPoint(client: ModbusRTU, p: Point): Promise<number | boolean> {
  switch (p.area) {
    case 'coil':
      return (await client.readCoils(p.address, 1)).data[0];
    case 'discrete':
      return (await client.readDiscreteInputs(p.address, 1)).data[0];
    case 'input':
      return decodeRegisters((await client.readInputRegisters(p.address, registerCount(p.type))).data, p.type, p.wordOrder, p.scale);
    case 'holding':
      return decodeRegisters((await client.readHoldingRegisters(p.address, registerCount(p.type))).data, p.type, p.wordOrder, p.scale);
  }
}

export function createModbusAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const address = `modbus://${settings.host}:${settings.port ?? 502}`;
  const points = settings.points as Point[];
  const backoff = new Backoff();
  let client: ModbusRTU | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  /** False after a failed read, so the next good one shows Connected again */
  let healthy = false;

  const schedule = (ms: number, run: () => void) => {
    if (stopped) return;
    timer = setTimeout(run, ms);
  };

  const connect = async () => {
    if (stopped) return;
    events.onState('connecting');
    client = new ModbusRTU();
    try {
      await client.connectTCP(String(settings.host), { port: Number(settings.port ?? 502) });
      client.setID(Number(settings.unitId ?? 1));
      client.setTimeout(5000);
      backoff.reset();
      healthy = true;
      events.onState('connected');
      poll();
    } catch (err) {
      events.onState('error', describeConnectionError(err, address));
      client.close(() => undefined);
      client = null;
      schedule(backoff.nextDelayMs(), () => void connect());
    }
  };

  const poll = async () => {
    if (stopped || !client) return;
    const message: Record<string, number | boolean> = {};
    try {
      for (const p of points) message[p.key] = await readPoint(client, p);
      if (!healthy) {
        healthy = true;
        events.onState('connected');
      }
      events.onMessage({ payload: JSON.stringify(message) });
      schedule(Number(settings.intervalMs) || 1000, () => void poll());
    } catch (err: any) {
      // A refused read (wrong address) keeps the connection; a dropped one reconnects
      const lost = !client.isOpen;
      healthy = false;
      events.onState(lost ? 'disconnected' : 'error', lost ? undefined : `Reading the device failed: ${err?.message || err}`);
      if (lost) {
        client = null;
        schedule(backoff.nextDelayMs(), () => void connect());
      } else {
        schedule(Math.max(5000, Number(settings.intervalMs) || 1000), () => void poll());
      }
    }
  };

  return {
    start: () => void connect(),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await new Promise<void>((resolve) => (client ? client.close(() => resolve()) : resolve()));
      client = null;
    },
  };
}
