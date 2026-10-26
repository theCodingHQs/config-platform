/**
 * An MQTT broker with a machine publishing to it, as an IoT gateway or sensor would:
 *   plant/<line>/<machine>/telemetry   {"speed":38.2,"temperature":61.4,"count":1200,"power":18.3}  every second
 *   plant/<line>/<machine>/status      {"state":"running"}   retained, only when it changes
 * The broker wants a user name and password, like a real one.
 */
import net from 'node:net';
import { Aedes } from 'aedes';
import type { Plant } from '../plant/plant.js';

export interface MqttDemo {
  port: number;
  username: string;
  password: string;
  /** machine code → line part of the topic */
  machines: Record<string, string>;
}

export async function startMqttBroker(plant: Plant, demo: MqttDemo): Promise<() => Promise<void>> {
  const broker = await Aedes.createBroker({
    authenticate: (_client, username, password, done) => done(null, username === demo.username && String(password ?? '') === demo.password),
  });
  const server = net.createServer(broker.handle);
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(demo.port, resolve));

  const publish = (topic: string, body: unknown, retain = false) =>
    broker.publish({ cmd: 'publish', topic, payload: Buffer.from(JSON.stringify(body)), qos: 0, retain, dup: false }, () => {});
  const lastStatus = new Map<string, string>();
  const off = plant.onTick((code, { status, ...telemetry }) => {
    const line = demo.machines[code];
    if (!line) return;
    publish(`plant/${line}/${code}/telemetry`, telemetry);
    if (lastStatus.get(code) !== status) publish(`plant/${line}/${code}/status`, { state: status }, true);
    lastStatus.set(code, status);
  });

  return async () => {
    off();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
