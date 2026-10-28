import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SLOW_MS, useServerHealth } from '../src/status/use-server-health';

afterEach(() => vi.unstubAllGlobals());

/** The health check answers after `ms`, or fails */
function stubHealth(answer: 'ok' | 'fail', ms = 0) {
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('fetch', vi.fn(async () => {
    now += ms;
    if (answer === 'fail') throw new TypeError('Failed to fetch');
    return new Response('{"status":"ok"}', { status: 200 });
  }));
}

describe('server health check', () => {
  it('is ok when the server answers quickly, with how long it took', async () => {
    stubHealth('ok', 40);
    const { result } = renderHook(() => useServerHealth(true, true));
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.latencyMs).toBe(40);
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
  });

  it('is slow past the limit, and unreachable when it doesn\'t answer', async () => {
    stubHealth('ok', SLOW_MS + 1);
    const slow = renderHook(() => useServerHealth(true, true));
    await waitFor(() => expect(slow.result.current.state).toBe('slow'));
    slow.unmount();

    stubHealth('fail');
    const down = renderHook(() => useServerHealth(true, true));
    await waitFor(() => expect(down.result.current.state).toBe('down'));
    expect(down.result.current.latencyMs).toBeNull();
  });

  it('checks nothing when no one is signed in', () => {
    stubHealth('ok');
    const { result } = renderHook(() => useServerHealth(false, true));
    expect(result.current.state).toBe('checking');
    expect(fetch).not.toHaveBeenCalled();
  });
});
