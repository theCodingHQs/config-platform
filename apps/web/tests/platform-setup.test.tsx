import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { PlatformSettingsView } from '@config-platform/schema';
import { AppBarProvider } from '../src/context/app-bar-context';
import { AuthContext } from '../src/context/auth-context';
import * as apiClient from '../src/api/client';
import { PlatformSetup } from '../src/studio/PlatformSetup';

const me = { id: 'u1', email: 'owner@factoryapps.io', tenantId: 't1', role: 'owner' as const, isPlatformAdmin: true };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user: me, loading: false, login: vi.fn(), signup: vi.fn(), acceptInvite: vi.fn(), logout: vi.fn(), refetchUser: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthContext.Provider value={auth as any}>
          <AppBarProvider>
            <PlatformSetup />
          </AppBarProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseView: PlatformSettingsView = {
  email: { source: 'default', provider: 'none', hasResendApiKey: false, fromAddress: '', fromName: '' },
  signupMode: { value: 'invite_only', source: 'default' },
  publicUrl: { value: 'http://localhost:3000', source: 'default' },
  encryptionKey: 'file',
  platformAdmins: [{ id: 'u1', email: 'owner@factoryapps.io' }],
};

afterEach(() => vi.restoreAllMocks());

describe('Platform setup screen', () => {
  it('sets up Resend: the key is sent once and then only shown as saved', async () => {
    vi.spyOn(apiClient, 'fetchPlatformSettings').mockResolvedValue(baseView);
    const update = vi.spyOn(apiClient, 'updatePlatformSettings').mockImplementation(async (input: any) => ({
      ...baseView,
      email: { source: 'saved', provider: 'resend', hasResendApiKey: true, fromAddress: input.email.fromAddress, fromName: input.email.fromName },
    }));

    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Resend/ }));
    fireEvent.change(screen.getByLabelText('Resend API key'), { target: { value: 're_live_123' } });
    fireEvent.change(screen.getByLabelText('Send from (email address)'), { target: { value: 'noreply@factoryapps.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save email service' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({
      email: { provider: 'resend', resendApiKey: 're_live_123', fromAddress: 'noreply@factoryapps.io', fromName: '' },
    });
    await waitFor(() => expect((screen.getByLabelText('Resend API key') as HTMLInputElement).value).toBe(''));
    expect(screen.getByLabelText('Resend API key').getAttribute('placeholder')).toBe('Saved (type to replace)');
    expect(screen.getByRole('button', { name: /Send me a test email/ })).toBeTruthy();
  });

  it('shows settings from the server configuration as locked', async () => {
    vi.spyOn(apiClient, 'fetchPlatformSettings').mockResolvedValue({
      ...baseView,
      email: { source: 'env', provider: 'resend', hasResendApiKey: true, fromAddress: 'noreply@saas.io', fromName: '' },
      publicUrl: { value: 'https://app.saas.io', source: 'env' },
    });
    renderPage();
    expect(await screen.findByText(/RESEND_API_KEY/)).toBeTruthy();
    expect(screen.getByText(/PUBLIC_URL/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save email service' })).toBeNull();
    expect(screen.queryByLabelText('Website address')).toBeNull();
    // Sign-ups are not set by the server, so they stay editable
    expect(screen.getByRole('radio', { name: /Invited people only/ })).toBeTruthy();
  });

  it('changes who can sign up and the website address', async () => {
    vi.spyOn(apiClient, 'fetchPlatformSettings').mockResolvedValue(baseView);
    const update = vi.spyOn(apiClient, 'updatePlatformSettings').mockResolvedValue(baseView);
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Anyone/ }));
    fireEvent.change(screen.getByLabelText('Website address'), { target: { value: 'https://apps.acme.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ signupMode: 'open', publicUrl: 'https://apps.acme.com/' }));
  });

  it('adds another platform owner; the only owner cannot be removed', async () => {
    vi.spyOn(apiClient, 'fetchPlatformSettings').mockResolvedValue(baseView);
    const add = vi.spyOn(apiClient, 'addPlatformAdmin').mockResolvedValue([
      { id: 'u1', email: 'owner@factoryapps.io' },
      { id: 'u2', email: 'ops@factoryapps.io' },
    ]);
    renderPage();
    expect(await screen.findByText('(you)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove owner@/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Email of the new platform owner'), { target: { value: 'ops@factoryapps.io' } });
    fireEvent.click(screen.getByRole('button', { name: /Add owner/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('ops@factoryapps.io'));
    expect(await screen.findByText('ops@factoryapps.io')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove ops@factoryapps.io' })).toBeTruthy();
  });
});
