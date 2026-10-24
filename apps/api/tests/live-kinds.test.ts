import { describe, it, expect, vi } from 'vitest';
import { LiveConnectionInputSchema } from '@config-platform/schema';
import { decodeRegisters, registerCount, plainOpcUaValue } from '@config-platform/live-connectors';
import { createHttpPushAdapter, deliverPush, newPushToken } from '../src/live/adapters/http-push-adapter.js';
import { encryptSettings, decryptSettings, redactSettings } from '../src/live/connection-secrets.js';

describe('Modbus registers', () => {
  it('reads 16-bit values, signed and scaled', () => {
    expect(decodeRegisters([1234], 'uint16')).toBe(1234);
    expect(decodeRegisters([0xffff], 'int16')).toBe(-1);
    expect(decodeRegisters([215], 'uint16', 'big', 0.1)).toBe(21.5);
    expect(decodeRegisters([1], 'bool')).toBe(true);
  });

  it('reads 32-bit values in either word order', () => {
    // 100000 = 0x0001_86A0
    expect(decodeRegisters([0x0001, 0x86a0], 'uint32')).toBe(100000);
    expect(decodeRegisters([0x86a0, 0x0001], 'uint32', 'little')).toBe(100000);
    expect(decodeRegisters([0xffff, 0xfffe], 'int32')).toBe(-2);
    // 21.5 as a float = 0x41AC_0000
    expect(decodeRegisters([0x41ac, 0x0000], 'float32')).toBe(21.5);
    expect(registerCount('float32')).toBe(2);
    expect(registerCount('int16')).toBe(1);
  });
});

describe('OPC UA values', () => {
  it('turns OPC UA values into plain JSON', () => {
    expect(plainOpcUaValue(41.5)).toBe(41.5);
    expect(plainOpcUaValue(new Date('2026-10-24T06:00:00Z'))).toBe('2026-10-24T06:00:00.000Z');
    expect(plainOpcUaValue(BigInt(12))).toBe(12);
    expect(plainOpcUaValue({ text: 'Running', locale: 'en' })).toBe('Running');
    expect(plainOpcUaValue(new Float32Array([1, 2]))).toEqual([1, 2]);
    expect(plainOpcUaValue(undefined)).toBe(null);
  });
});

describe('HTTP push', () => {
  it('accepts messages only with the right token, and only while the connection runs', async () => {
    const { token, tokenHash } = newPushToken();
    expect(token).toMatch(/^lp_/);
    const events = { onMessage: vi.fn(), onState: vi.fn() };
    const adapter = createHttpPushAdapter({ tokenHash, format: 'json' }, events, { connectionId: 'lc_push' });
    expect(deliverPush('lc_push', token, '{"a":1}')).toBe('unknown');
    adapter.start();
    expect(events.onState).toHaveBeenCalledWith('connected');
    expect(deliverPush('lc_push', 'wrong', '{"a":1}')).toBe('forbidden');
    expect(deliverPush('lc_push', token, '{"a":1}', 'line1/status')).toBe('accepted');
    expect(events.onMessage).toHaveBeenCalledWith({ payload: '{"a":1}', topic: 'line1/status' });
    await adapter.stop();
    expect(deliverPush('lc_push', token, '{"a":1}')).toBe('unknown');
  });

  it('a push connection without a token says so', () => {
    const events = { onMessage: vi.fn(), onState: vi.fn() };
    createHttpPushAdapter({ format: 'json' }, events, { connectionId: 'lc_none' }).start();
    expect(events.onState).toHaveBeenCalledWith('error', expect.stringMatching(/no token/));
  });
});

describe('settings of the new kinds', () => {
  const base = { name: 'x', tags: [] };
  const ok = (input: unknown) => LiveConnectionInputSchema.safeParse(input).success;

  it('accepts OPC UA, Modbus, HTTP push and HTTP polling settings, and refuses wrong addresses', () => {
    expect(ok({ ...base, kind: 'opcua', settings: { endpointUrl: 'opc.tcp://plc:4840', nodes: [{ key: 'speed', nodeId: 'ns=2;s=Line1.Speed' }] } })).toBe(true);
    expect(ok({ ...base, kind: 'opcua', settings: { endpointUrl: 'http://plc', nodes: [{ key: 's', nodeId: 'i=1' }] } })).toBe(false);
    expect(ok({ ...base, kind: 'modbus', settings: { host: '192.168.1.20', points: [{ key: 'temp', address: 100, type: 'float32', scale: 0.1 }] } })).toBe(true);
    expect(ok({ ...base, kind: 'modbus', settings: { host: '192.168.1.20', points: [] } })).toBe(false);
    expect(ok({ ...base, kind: 'http-push', settings: {} })).toBe(true);
    expect(ok({ ...base, kind: 'http-poll', settings: { url: 'https://mes.local/api/status', intervalSec: 5 } })).toBe(true);
    expect(ok({ ...base, kind: 'http-poll', settings: { url: 'ftp://mes.local' } })).toBe(false);
  });

  it('keeps the OPC UA password and polling tokens secret, and the push token only as a hash', () => {
    const opc = encryptSettings('opcua', { endpointUrl: 'opc.tcp://p:4840', username: 'u', password: 'pw' });
    expect(JSON.stringify(opc)).not.toContain('"pw"');
    expect(decryptSettings('opcua', opc).password).toBe('pw');
    expect(redactSettings('opcua', opc)).toMatchObject({ hasPassword: true });

    const poll = encryptSettings('http-poll', { url: 'https://m', headers: [{ name: 'Authorization', value: 'Bearer z' }] });
    expect(redactSettings('http-poll', poll).headers).toEqual([{ name: 'Authorization', hasValue: true }]);

    // The browser can't set the hash; saving keeps the server's one; the screen only learns it exists
    const push = encryptSettings('http-push', { format: 'json', tokenHash: 'evil' }, { tokenHash: 'h1' });
    expect(push).toEqual({ format: 'json', tokenHash: 'h1' });
    expect(redactSettings('http-push', push)).toEqual({ format: 'json', hasToken: true });
  });
});
