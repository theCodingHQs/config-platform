/**
 * The agent's one connection to the app: outbound WebSocket, reconnecting with backoff, answering
 * pings. Messages to the app sent while it's down are dropped (the latest values follow soon).
 */
import os from 'node:os';
import WebSocket from 'ws';
import { Backoff } from '@config-platform/live-connectors';
import type { AgentToServer, ServerToAgent } from '@config-platform/schema';
import { log } from './log.js';

export interface AgentLinkOptions {
  url: string;
  token: string;
  version: string;
  onMessage: (message: ServerToAgent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class AgentLink {
  private ws: WebSocket | null = null;
  private readonly backoff = new Backoff();
  private retry: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly options: AgentLinkOptions) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close(1000, 'Agent stopping');
  }

  send(message: AgentToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.options.url, { headers: { Authorization: `Bearer ${this.options.token}` }, handshakeTimeout: 15_000 });
    this.ws = ws;
    ws.on('open', () => {
      this.backoff.reset();
      log.info(`Connected to ${new URL(this.options.url).host}`);
      this.send({ type: 'hello', version: this.options.version, hostname: os.hostname() });
      this.options.onOpen?.();
    });
    ws.on('message', (data) => {
      let message: ServerToAgent;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.type === 'ping') this.send({ type: 'pong' });
      else this.options.onMessage(message);
    });
    ws.on('unexpected-response', (_req, res) => {
      log.warn(res.statusCode === 401 ? 'The app refused the agent token. Create a new token in Studio → Live → Edge agents.' : `The app answered ${res.statusCode}`);
      ws.terminate();
    });
    ws.on('error', (err) => log.warn(`Connection to the app failed: ${err.message}`));
    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.options.onClose?.();
      if (this.stopped) return;
      if (code === 4409) log.warn(`Another copy of this agent connected (${reason.toString()}). Only one may run with this token.`);
      const delay = this.backoff.nextDelayMs();
      log.info(`Reconnecting in ${Math.round(delay / 1000)} s`);
      this.retry = setTimeout(() => this.connect(), delay);
    });
  }
}
