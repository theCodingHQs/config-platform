/**
 * Starts every stand-in source for the machine monitoring demo, the process area and order desk
 * feeds (on the MQTT broker), and the edge agent and the HTTP pusher when `setup` has saved their
 * tokens. Ctrl+C stops everything.
 *
 *   pnpm --filter @config-platform/demo-sources start
 */
import { DEMO_MACHINES, SOURCE_LABELS, topicLine } from './catalog.js';
import { GATEWAY_TOKEN, MODBUS_BASE, MQTT_PASSWORD, MQTT_USER, PORTS, readState, REST_API_KEY } from './demo-config.js';
import { Plant } from './plant/plant.js';
import { startWebSocketGateway } from './sources/websocket-gateway.js';
import { startMqttBroker } from './sources/mqtt-broker.js';
import { startOpcUaServer } from './sources/opcua-server.js';
import { startModbusDevice } from './sources/modbus-device.js';
import { startRestApi } from './sources/rest-api.js';
import { startHttpPusher } from './sources/http-pusher.js';
import { startEdgeAgent } from './agent/run-edge-agent.js';
import { orderDeskFeed, processFeed } from './sources/site-feeds.js';

const codesFor = (...sources: string[]) => DEMO_MACHINES.filter((m) => sources.includes(m.source)).map((m) => m.code);

async function main() {
  const plant = new Plant();
  plant.start();
  const stops: Array<() => Promise<void>> = [];
  const started = (what: string, where: string) => console.log(`  ✓ ${what.padEnd(26)} ${where}`);

  console.log('Demo sources');
  stops.push(await startOpcUaServer(plant, PORTS.opcua, codesFor('opcua')));
  started('OPC UA server', `opc.tcp://localhost:${PORTS.opcua}/demo`);
  stops.push(startModbusDevice(plant, PORTS.modbus, MODBUS_BASE));
  started('Modbus TCP device', `localhost:${PORTS.modbus} (unit 1)`);
  stops.push(await startMqttBroker(plant, { port: PORTS.mqtt, username: MQTT_USER, password: MQTT_PASSWORD, machines: Object.fromEntries(DEMO_MACHINES.filter((m) => m.source === 'mqtt').map((m) => [m.code, topicLine(m)])), feeds: [processFeed, orderDeskFeed] }));
  started('MQTT broker', `mqtt://localhost:${PORTS.mqtt}`);
  started('Process area feed', 'MQTT site/process/state');
  started('Order desk feed', 'MQTT site/orders/#');
  stops.push(startWebSocketGateway(plant, PORTS.websocket, GATEWAY_TOKEN));
  started('WebSocket gateway', `ws://localhost:${PORTS.websocket}`);
  stops.push(startRestApi(plant, PORTS.http, REST_API_KEY));
  started('REST API (for polling)', `http://localhost:${PORTS.http}/api/machines/<code>`);

  const state = readState();
  const pushed = DEMO_MACHINES.find((m) => m.source === 'http-push');
  if (state?.push && pushed) {
    stops.push(startHttpPusher(plant, pushed.code, { platformUrl: state.platformUrl, ...state.push }));
    started('HTTP pusher', `→ ${state.platformUrl}/api/live/push/${state.push.connectionId}`);
  }
  if (state?.agent) {
    stops.push(startEdgeAgent(state.platformUrl, state.agent.token));
    started('Edge agent', `→ ${state.platformUrl}`);
  }
  if (!state) console.log('\n  Run "setup" first to also start the HTTP pusher and the edge agent.');

  console.log('\nWhich machine each source feeds:');
  for (const m of DEMO_MACHINES) console.log(`  ${m.code}  ${m.name.padEnd(22)} ${SOURCE_LABELS[m.source]}`);
  console.log('\nPress Ctrl+C to stop.');

  const shutdown = async () => {
    plant.stop();
    await Promise.allSettled(stops.map((stop) => stop()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(`Demo sources failed to start: ${err.message}`);
  if (err.code === 'EADDRINUSE') console.error('A port is taken: set DEMO_WS_PORT, DEMO_MQTT_PORT, DEMO_OPCUA_PORT, DEMO_MODBUS_PORT or DEMO_HTTP_PORT.');
  process.exit(1);
});
