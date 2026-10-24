/**
 * What every connection kind (WebSocket, MQTT, simulator…) provides to the live hub: start,
 * stop, and incoming messages. Adapters know nothing about tags, tenants or browsers.
 */
import type { ConnectionState } from '@config-platform/schema';

export interface AdapterMessage {
  /** Raw payload as received */
  payload: string | Buffer;
  /** MQTT topic (other kinds leave it empty) */
  topic?: string;
}

export interface AdapterEvents {
  onMessage: (message: AdapterMessage) => void;
  /** State changes; `error` says why, in plain words */
  onState: (state: ConnectionState, error?: string) => void;
  /** Connected, but part of it doesn't work (cleared when the connection restarts) */
  onWarning: (warning: string) => void;
}

export interface LiveAdapter {
  /** Connects and keeps the connection up (reconnecting on its own) until stop() */
  start(): void;
  stop(): Promise<void>;
}

/**
 * Settings as stored, with secrets decrypted for the adapter's use only. Kept loose here: each
 * adapter reads its own kind's settings (validated by the schema when saved).
 */
export type AdapterSettings = Record<string, any>;

/** Which connection the adapter runs for (HTTP push receives at /api/live/push/<connectionId>) */
export interface AdapterContext {
  connectionId: string;
}

export type AdapterFactory = (settings: AdapterSettings, events: AdapterEvents, context: AdapterContext) => LiveAdapter;
