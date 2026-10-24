/**
 * HTTP push source: devices and systems POST messages to /api/live/push/<connection id> with the
 * connection's token. The adapter only registers where those requests are delivered; the route
 * checks the token against the stored hash.
 */
import crypto from 'node:crypto';
import type { AdapterContext, AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';

interface PushTarget {
  tokenHash: string;
  events: AdapterEvents;
}

const targets = new Map<string, PushTarget>();

export const hashPushToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

export function newPushToken(): { token: string; tokenHash: string } {
  const token = `lp_${crypto.randomBytes(24).toString('base64url')}`;
  return { token, tokenHash: hashPushToken(token) };
}

export type PushResult = 'accepted' | 'unknown' | 'forbidden';

/** Delivers a pushed message; unknown = no such (running) connection, forbidden = wrong token */
export function deliverPush(connectionId: string, token: string, payload: string, topic?: string): PushResult {
  const target = targets.get(connectionId);
  if (!target) return 'unknown';
  const given = Buffer.from(hashPushToken(token), 'hex');
  const expected = Buffer.from(target.tokenHash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return 'forbidden';
  target.events.onMessage({ payload, topic });
  return 'accepted';
}

export function createHttpPushAdapter(settings: AdapterSettings, events: AdapterEvents, context: AdapterContext): LiveAdapter {
  return {
    start() {
      if (!settings.tokenHash) {
        events.onState('error', 'This connection has no token yet. Generate one on its settings.');
        return;
      }
      targets.set(context.connectionId, { tokenHash: String(settings.tokenHash), events });
      // Nothing to connect to: it is ready as soon as it listens
      events.onState('connected');
    },
    async stop() {
      if (targets.get(context.connectionId)?.events === events) targets.delete(context.connectionId);
    },
  };
}
