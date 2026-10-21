import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DateDisplayPrefs } from '@config-platform/schema';
import { DateInput, type DateInputKind } from '../src/components/date-input';
import { DateDisplayProvider } from '../src/context/date-display-context';
import { DatePreferencesButton } from '../src/components/date-preferences-dialog';
import { AppBarProvider } from '../src/context/app-bar-context';
import * as apiClient from '../src/api/client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ kind = 'day', prefs, initial }: { kind?: DateInputKind; prefs: DateDisplayPrefs; initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <DateDisplayProvider value={prefs}>
      <DateInput aria-label="When" kind={kind} value={value} onChange={setValue} />
      <output data-testid="stored">{value ?? ''}</output>
    </DateDisplayProvider>
  );
}

const stored = () => screen.getByTestId('stored').textContent;

describe('DateInput: dates in the viewer format, values in ISO', () => {
  it('shows and reads dates in the chosen format; storage stays YYYY-MM-DD', () => {
    render(<Harness prefs={{ dateFormat: 'DD/MM/YYYY', locale: 'en-GB' }} initial="2026-10-01" />);
    const input = screen.getByLabelText('When') as HTMLInputElement;
    expect(input.value).toBe('01/10/2026');
    expect(input.placeholder).toBe('DD/MM/YYYY');

    fireEvent.change(input, { target: { value: '05/11/2026' } });
    fireEvent.blur(input);
    expect(stored()).toBe('2026-11-05');

    // Impossible dates are flagged, not saved
    fireEvent.change(input, { target: { value: '31/02/2026' } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(stored()).toBe('2026-11-05');

    // Clearing the text clears the value
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(stored()).toBe('');
  });

  it('a US viewer types month first for the same stored day', () => {
    render(<Harness prefs={{ dateFormat: 'MM/DD/YYYY', locale: 'en-US' }} />);
    const input = screen.getByLabelText('When');
    fireEvent.change(input, { target: { value: '11/05/2026' } });
    fireEvent.blur(input);
    expect(stored()).toBe('2026-11-05');
  });

  it('calendar: picks a day, starts weeks on the chosen day, Today and Clear', () => {
    render(<Harness prefs={{ dateFormat: 'YYYY-MM-DD', locale: 'en-GB', weekStart: 'sunday' }} initial="2026-10-01" />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    const calendar = screen.getByRole('dialog', { name: 'Choose date' });
    expect(within(calendar).getByText('October 2026')).toBeInTheDocument();
    const headers = within(calendar).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[0]).toBe('Sun');
    expect(within(calendar).getByRole('gridcell', { name: '1 Oct 2026' })).toHaveAttribute('aria-selected', 'true');

    // Keyboard: arrows move the focused day, Enter/click selects
    fireEvent.keyDown(calendar, { key: 'ArrowRight' });
    fireEvent.click(within(calendar).getByRole('gridcell', { name: '2 Oct 2026' }));
    expect(stored()).toBe('2026-10-02');

    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next month' }));
    expect(within(screen.getByRole('dialog')).getByText('November 2026')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }));
    expect(stored()).toBe('');
  });

  it('month fields pick a month and store the 1st', () => {
    render(<Harness kind="month" prefs={{ locale: 'en-US' }} initial="2026-10-01" />);
    const input = screen.getByLabelText('When') as HTMLInputElement;
    expect(input.value).toBe('Oct 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('gridcell', { name: 'Dec' }));
    expect(stored()).toBe('2026-12-01');

    fireEvent.change(input, { target: { value: '03/2027' } });
    fireEvent.blur(input);
    expect(stored()).toBe('2027-03-01');
    fireEvent.change(input, { target: { value: 'August 2027' } });
    fireEvent.blur(input);
    expect(stored()).toBe('2027-08-01');
  });

  it('date & time is entered in the viewer time zone and stored as the exact moment', () => {
    render(<Harness kind="datetime" prefs={{ dateFormat: 'DD/MM/YYYY', timeFormat: '24h', locale: 'en-GB', timeZone: 'Asia/Kolkata' }} initial="2026-10-22T08:35:00.000Z" />);
    const date = screen.getByLabelText('When') as HTMLInputElement;
    const time = screen.getByLabelText('Time') as HTMLInputElement;
    // 08:35 UTC is 14:05 in India
    expect(date.value).toBe('22/10/2026');
    expect(time.value).toBe('14:05');

    fireEvent.change(time, { target: { value: '6:30 pm' } });
    fireEvent.blur(time);
    expect(stored()).toBe('2026-10-22T13:00:00.000Z');
  });
});

describe('Date & time preferences dialog', () => {
  it('lists workspace defaults and saves only the choices the user made', async () => {
    vi.spyOn(apiClient, 'fetchWorkspaceDateSettings').mockResolvedValue({ dateFormat: 'DD/MM/YYYY', timeFormat: 'auto', weekStart: 'auto', timeZone: 'Asia/Kolkata' });
    vi.spyOn(apiClient, 'fetchMe').mockResolvedValue({ id: 'u', email: 'a@b.c', tenantId: 't', role: 'viewer', datePreferences: {} });
    const save = vi.spyOn(apiClient, 'updateMyDatePreferences').mockImplementation(async (p) => p);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AppBarProvider>
          <DatePreferencesButton />
        </AppBarProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Date & time preferences' }));
    const dialog = screen.getByRole('dialog', { name: 'Date & time preferences' });
    const format = within(dialog).getByLabelText('Date format') as HTMLSelectElement;
    await waitFor(() => expect(format.options[0].textContent).toMatch(/^Workspace default \(Day \/ Month \/ Year/));
    expect(format.value).toBe('');

    fireEvent.change(format, { target: { value: 'YYYY-MM-DD' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ dateFormat: 'YYYY-MM-DD' }));
    await waitFor(() => expect(screen.getByTestId('app-status-notification')).toHaveTextContent(/preferences are saved/));
  });
});
