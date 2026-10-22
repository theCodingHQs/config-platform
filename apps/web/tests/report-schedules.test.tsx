import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppBarProvider } from '../src/context/app-bar-context';
import { AuthContext } from '../src/context/auth-context';
import * as apiClient from '../src/api/client';
import { ReportSchedules, parseRecipients } from '../src/studio/ReportSchedules';
import { EmailSettingsPanel } from '../src/studio/EmailSettingsPanel';

const builder = { id: 'u1', email: 'builder@acme.com', tenantId: 't1', role: 'builder' as const };

function renderWithProviders(ui: React.ReactNode, user: any = builder) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user, loading: false, login: vi.fn(), signup: vi.fn(), acceptInvite: vi.fn(), logout: vi.fn(), refetchUser: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthContext.Provider value={auth as any}>
          <AppBarProvider>{ui}</AppBarProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const productionReport = {
  id: 'et_1',
  name: 'Production report',
  entityId: 'e1',
  version: 1,
  draft: { kind: 'grid', parameters: [{ id: 'p_month', name: 'month', label: 'Month', type: 'date', required: false }] },
};

afterEach(() => vi.restoreAllMocks());

describe('Report emails', () => {
  it('splits recipients typed with commas, semicolons or new lines', () => {
    expect(parseRecipients('a@x.com, b@y.com;c@z.com\n a@x.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('schedules a report weekly, with the month following the calendar', async () => {
    vi.spyOn(apiClient, 'listReportSchedules').mockResolvedValue([]);
    vi.spyOn(apiClient, 'listExportTemplates').mockResolvedValue([productionReport] as any);
    vi.spyOn(apiClient, 'fetchEmailSettings').mockResolvedValue({ mode: 'platform', platformConfigured: true, platformFromAddress: 'reports@platform.com' });
    vi.spyOn(apiClient, 'fetchWorkspaceDateSettings').mockResolvedValue({ dateFormat: 'auto', timeFormat: 'auto', weekStart: 'auto', timeZone: 'Asia/Kolkata' });
    const save = vi.spyOn(apiClient, 'saveReportSchedule').mockImplementation(async (input) => ({
      ...input, id: 'rs_1', templateName: 'Production report', createdBy: 'u1', createdByEmail: builder.email,
      nextRunAt: '2026-10-26T01:30:00.000Z', lastRunAt: null, lastStatus: null, lastError: null,
    }) as any);

    renderWithProviders(<ReportSchedules />);
    const newButton = await screen.findByRole('button', { name: /New schedule/ });
    await waitFor(() => expect((newButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newButton);
    const dialog = await screen.findByRole('dialog', { name: 'New report email' });
    expect(await within(dialog).findByText(/Asia\/Kolkata/)).toBeTruthy();

    // A date input defaults to following the calendar
    expect((within(dialog).getByLabelText('Month (optional)') as HTMLSelectElement).value).toBe('@this_month_start');

    fireEvent.change(within(dialog).getByLabelText('Send to'), { target: { value: 'plant@acme.com; qa@acme.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      templateId: 'et_1',
      timing: { frequency: 'weekly', weekday: 1, timeOfDay: '07:00' },
      recipients: ['plant@acme.com', 'qa@acme.com'],
      parameters: { month: '@this_month_start' },
    });
  });

  it('lists schedules with their last result, and warns when email only goes to the log', async () => {
    vi.spyOn(apiClient, 'listReportSchedules').mockResolvedValue([
      {
        id: 'rs_1', templateId: 'et_1', templateName: 'Production report', timing: { frequency: 'weekdays', timeOfDay: '08:00' },
        recipients: ['a@acme.com', 'b@acme.com', 'c@acme.com'], parameters: {}, enabled: true, createdBy: 'u1', createdByEmail: builder.email,
        nextRunAt: '2026-10-23T02:30:00.000Z', lastRunAt: '2026-10-22T02:30:00.000Z', lastStatus: 'failed', lastError: 'Mailbox unavailable',
      },
    ] as any);
    vi.spyOn(apiClient, 'listExportTemplates').mockResolvedValue([productionReport] as any);
    vi.spyOn(apiClient, 'fetchEmailSettings').mockResolvedValue({ mode: 'platform', platformConfigured: false, platformFromAddress: null });
    const sendNow = vi.spyOn(apiClient, 'sendReportScheduleNow').mockResolvedValue({} as any);

    renderWithProviders(<ReportSchedules />);
    expect(await screen.findByText('Monday to Friday at 08:00')).toBeTruthy();
    expect(screen.getByText('+1 more')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Mailbox unavailable')).toBeTruthy();
    expect(await screen.findByText(/isn't set up on this server yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Send now/ }));
    await waitFor(() => expect(sendNow).toHaveBeenCalledWith('rs_1'));
  });
});

describe('Settings → Email', () => {
  it('admins switch to their own mail server; a saved password is never shown', async () => {
    vi.spyOn(apiClient, 'fetchEmailSettings').mockResolvedValue({ mode: 'platform', platformConfigured: true, platformFromAddress: 'reports@platform.com' });
    const update = vi.spyOn(apiClient, 'updateEmailSettings').mockImplementation(async (input: any) => ({
      mode: input.mode,
      smtp: { ...input.smtp, password: undefined, hasPassword: true },
      platformConfigured: true,
      platformFromAddress: 'reports@platform.com',
    }) as any);

    renderWithProviders(<EmailSettingsPanel canEdit />, { ...builder, role: 'admin' });
    expect(await screen.findByText('reports@platform.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Your own email account/ }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'm365' } });
    fireEvent.change(screen.getByLabelText('Send from (email address)'), { target: { value: 'reports@acme.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({
      mode: 'smtp',
      smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls', username: 'reports@acme.com', password: 'S3cret!', fromAddress: 'reports@acme.com', fromName: '' },
    });
    await waitFor(() => expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(''));
    expect(screen.getByLabelText('Password').getAttribute('placeholder')).toBe('Saved (type to replace)');
  });

  it('non-admins only see the settings', async () => {
    vi.spyOn(apiClient, 'fetchEmailSettings').mockResolvedValue({ mode: 'platform', platformConfigured: true, platformFromAddress: null });
    renderWithProviders(<EmailSettingsPanel canEdit={false} />);
    expect(await screen.findByText(/Only admins and owners/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save email settings' })).toBeNull();
  });
});
