/** Reads a received payload as the connection's format says, giving tag rules their `message`. */
import type { MessageFormat } from '@config-platform/schema';

export type DecodeResult = { ok: true; message: unknown } | { ok: false; error: string };

export function decodeMessage(payload: string | Buffer, format: MessageFormat): DecodeResult {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8');
  switch (format) {
    case 'json':
      try {
        return { ok: true, message: JSON.parse(text) };
      } catch {
        return { ok: false, error: `Not JSON: ${text.slice(0, 80)}` };
      }
    case 'number': {
      const n = Number(text.trim());
      return Number.isFinite(n) ? { ok: true, message: n } : { ok: false, error: `Not a number: ${text.slice(0, 80)}` };
    }
    case 'text':
      return { ok: true, message: text };
  }
}

/**
 * Whether an MQTT topic matches a filter: + is one level, # is the rest.
 * factory/+/status matches factory/line1/status; factory/# matches everything under factory.
 */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
