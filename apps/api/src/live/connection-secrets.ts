/**
 * Secrets inside connection settings: encrypted when stored, decrypted only for the adapter, and
 * never sent to the browser. A secret left empty on save keeps the stored one.
 *   password    MQTT, OPC UA                → passwordEncrypted
 *   header values (tokens)  WebSocket, HTTP polling → headers[].valueEncrypted
 *   push token  HTTP push                   → tokenHash (a hash: it can't be shown again, only replaced)
 */
import type { LiveConnectionKind } from '@config-platform/schema';
import { decryptSecret, encryptSecret } from '../utils/secret-box.js';

type Settings = Record<string, any>;

const PASSWORD_KINDS = new Set<LiveConnectionKind>(['mqtt', 'opcua']);
const HEADER_KINDS = new Set<LiveConnectionKind>(['websocket', 'http-poll']);

/** Settings as saved: secrets replaced by their encrypted form */
export function encryptSettings(kind: LiveConnectionKind, input: Settings, previous?: Settings): Settings {
  if (PASSWORD_KINDS.has(kind)) {
    const { password, ...rest } = input;
    const passwordEncrypted = password ? encryptSecret(password) : previous?.passwordEncrypted;
    return { ...rest, ...(passwordEncrypted ? { passwordEncrypted } : {}) };
  }
  if (HEADER_KINDS.has(kind)) {
    const before = new Map<string, string | undefined>(((previous?.headers ?? []) as any[]).map((h) => [h.name, h.valueEncrypted]));
    return {
      ...input,
      headers: ((input.headers ?? []) as Array<{ name: string; value?: string }>).map((h) => {
        const valueEncrypted = h.value ? encryptSecret(h.value) : before.get(h.name);
        return { name: h.name, ...(valueEncrypted ? { valueEncrypted } : {}) };
      }),
    };
  }
  if (kind === 'http-push') {
    // The token is set by the server (newPushToken), never typed in
    const { tokenHash: _ignored, ...rest } = input;
    return { ...rest, ...(previous?.tokenHash ? { tokenHash: previous.tokenHash } : {}) };
  }
  return input;
}

/** Settings for the adapter: secrets decrypted */
export function decryptSettings(kind: LiveConnectionKind, stored: Settings): Settings {
  if (PASSWORD_KINDS.has(kind)) {
    const { passwordEncrypted, ...rest } = stored;
    return { ...rest, ...(passwordEncrypted ? { password: decryptSecret(passwordEncrypted) } : {}) };
  }
  if (HEADER_KINDS.has(kind)) {
    return {
      ...stored,
      headers: ((stored.headers ?? []) as any[]).map((h) => ({ name: h.name, value: h.valueEncrypted ? decryptSecret(h.valueEncrypted) : '' })),
    };
  }
  return stored;
}

/** Settings for the screen: only whether each secret is saved */
export function redactSettings(kind: LiveConnectionKind, stored: Settings): Settings {
  if (PASSWORD_KINDS.has(kind)) {
    const { passwordEncrypted, ...rest } = stored;
    return { ...rest, hasPassword: Boolean(passwordEncrypted) };
  }
  if (HEADER_KINDS.has(kind)) {
    return { ...stored, headers: ((stored.headers ?? []) as any[]).map((h) => ({ name: h.name, hasValue: Boolean(h.valueEncrypted) })) };
  }
  if (kind === 'http-push') {
    const { tokenHash, ...rest } = stored;
    return { ...rest, hasToken: Boolean(tokenHash) };
  }
  return stored;
}
