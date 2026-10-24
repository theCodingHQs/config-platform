/**
 * Secrets inside connection settings (MQTT password, WebSocket header values such as tokens):
 * encrypted when stored, decrypted only for the adapter, and never sent to the browser.
 * A secret left empty on save keeps the stored one.
 */
import type { LiveConnectionKind } from '@config-platform/schema';
import { decryptSecret, encryptSecret } from '../utils/secret-box.js';

type Settings = Record<string, any>;

/** Settings as saved: secrets replaced by their encrypted form */
export function encryptSettings(kind: LiveConnectionKind, input: Settings, previous?: Settings): Settings {
  if (kind === 'mqtt') {
    const { password, ...rest } = input;
    const passwordEncrypted = password ? encryptSecret(password) : previous?.passwordEncrypted;
    return { ...rest, ...(passwordEncrypted ? { passwordEncrypted } : {}) };
  }
  if (kind === 'websocket') {
    const before = new Map<string, string | undefined>(((previous?.headers ?? []) as any[]).map((h) => [h.name, h.valueEncrypted]));
    return {
      ...input,
      headers: ((input.headers ?? []) as Array<{ name: string; value?: string }>).map((h) => {
        const valueEncrypted = h.value ? encryptSecret(h.value) : before.get(h.name);
        return { name: h.name, ...(valueEncrypted ? { valueEncrypted } : {}) };
      }),
    };
  }
  return input;
}

/** Settings for the adapter: secrets decrypted */
export function decryptSettings(kind: LiveConnectionKind, stored: Settings): Settings {
  if (kind === 'mqtt') {
    const { passwordEncrypted, ...rest } = stored;
    return { ...rest, ...(passwordEncrypted ? { password: decryptSecret(passwordEncrypted) } : {}) };
  }
  if (kind === 'websocket') {
    return {
      ...stored,
      headers: ((stored.headers ?? []) as any[]).map((h) => ({ name: h.name, value: h.valueEncrypted ? decryptSecret(h.valueEncrypted) : '' })),
    };
  }
  return stored;
}

/** Settings for the screen: only whether each secret is saved */
export function redactSettings(kind: LiveConnectionKind, stored: Settings): Settings {
  if (kind === 'mqtt') {
    const { passwordEncrypted, ...rest } = stored;
    return { ...rest, hasPassword: Boolean(passwordEncrypted) };
  }
  if (kind === 'websocket') {
    return { ...stored, headers: ((stored.headers ?? []) as any[]).map((h) => ({ name: h.name, hasValue: Boolean(h.valueEncrypted) })) };
  }
  return stored;
}
