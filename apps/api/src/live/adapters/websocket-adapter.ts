/** WebSocket source: a machine gateway, Node-RED, a SCADA/MES system streaming messages. */
import WebSocket from 'ws';
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';
import { Backoff } from './backoff.js';
import { describeConnectionError } from './connection-errors.js';

export function createWebSocketAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const url = String(settings.url);
  const headers = Object.fromEntries(((settings.headers ?? []) as Array<{ name: string; value?: string }>).map((h) => [h.name, h.value ?? '']));
  const backoff = new Backoff();
  let socket: WebSocket | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, backoff.nextDelayMs());
  };

  const connect = () => {
    if (stopped) return;
    events.onState('connecting');
    const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000 });
    socket = ws;
    ws.on('open', () => {
      backoff.reset();
      events.onState('connected');
      if (settings.subscribeMessage) ws.send(String(settings.subscribeMessage));
    });
    ws.on('message', (data, isBinary) => {
      events.onMessage({ payload: isBinary ? (data as Buffer) : data.toString() });
    });
    ws.on('unexpected-response', (_req, res) => {
      events.onState('error', describeConnectionError({ message: `${res.statusCode} ${res.statusMessage ?? ''}` }, url));
      ws.terminate();
    });
    ws.on('error', (err) => events.onState('error', describeConnectionError(err, url)));
    ws.on('close', () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      events.onState('disconnected');
      scheduleReconnect();
    });
  };

  return {
    start: connect,
    async stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.terminate();
      socket = null;
    },
  };
}
