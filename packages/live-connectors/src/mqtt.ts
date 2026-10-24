/** MQTT source: a broker the factory's machines and gateways publish to. */
import mqtt from 'mqtt';
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';
import { describeConnectionError } from './connection-errors.js';

export function createMqttAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const url = String(settings.url);
  const topics = settings.topics as string[];
  const qos = (settings.qos ?? 0) as 0 | 1 | 2;
  let client: mqtt.MqttClient | null = null;

  return {
    start() {
      events.onState('connecting');
      client = mqtt.connect(url, {
        username: settings.username || undefined,
        password: settings.password || undefined,
        clientId: settings.clientId || `config-platform-${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 5000,
        connectTimeout: 10_000,
      });
      client.on('connect', () => {
        events.onState('connected');
        client?.subscribe(topics, { qos }, (err) => {
          if (err) events.onState('error', `Subscribing to the topics failed: ${err.message}`);
        });
      });
      client.on('message', (topic, payload) => events.onMessage({ payload, topic }));
      client.on('reconnect', () => events.onState('connecting'));
      client.on('offline', () => events.onState('disconnected'));
      client.on('error', (err) => events.onState('error', describeConnectionError(err, url)));
    },
    async stop() {
      await client?.endAsync(true).catch(() => undefined);
      client = null;
    },
  };
}
