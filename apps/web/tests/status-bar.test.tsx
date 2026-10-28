import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppBarProvider, STATUS_MESSAGE_DURATION_MS, useStatusNotify } from '../src/context/app-bar-context';

let notify: ReturnType<typeof useStatusNotify>;
function Notifier() {
  notify = useStatusNotify();
  return null;
}

const message = () => screen.queryByTestId('app-status-notification');

describe('status bar messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    render(
      <AppBarProvider>
        <Notifier />
      </AppBarProvider>,
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('clear themselves after their time', () => {
    act(() => notify('success', 'Saved'));
    act(() => vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.success - 1));
    expect(message()).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(message()).toBeNull();
  });

  it('stay while hovered, then carry on with the time they had left', () => {
    act(() => notify('success', 'Saved'));
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(message()!);
    act(() => vi.advanceTimersByTime(60_000));
    expect(message()).toBeTruthy();

    fireEvent.mouseLeave(message()!);
    act(() => vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.success - 3000 - 1));
    expect(message()).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(message()).toBeNull();
  });

  it('stay while the dismiss button has keyboard focus, and go when dismissed', () => {
    act(() => notify('error', 'Delete failed'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(message()).toBeTruthy();
    fireEvent.click(dismiss);
    expect(message()).toBeNull();
  });

  it('a new message that arrives under the pointer waits until it leaves', () => {
    act(() => notify('info', 'First'));
    fireEvent.mouseEnter(message()!);
    act(() => notify('info', 'Second'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(message()?.textContent).toContain('Second');
    fireEvent.mouseLeave(message()!);
    act(() => vi.advanceTimersByTime(STATUS_MESSAGE_DURATION_MS.info));
    expect(message()).toBeNull();
  });
});
