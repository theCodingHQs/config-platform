import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthContext } from '../src/context/auth-context';
import * as apiClient from '../src/api/client';
import { AuthPage } from '../src/pages/AuthPage';
import { ResetPasswordPage } from '../src/pages/ResetPasswordPage';
import { VerifyEmailPage } from '../src/pages/VerifyEmailPage';

const auth = { user: null, loading: false, login: vi.fn(), signup: vi.fn(), acceptInvite: vi.fn(), logout: vi.fn(), refetchUser: vi.fn() };

function at(url: string) {
  window.history.pushState({}, '', url);
}

afterEach(() => {
  vi.restoreAllMocks();
  at('/');
});

describe('Forgot password', () => {
  it('the sign-in page sends a reset link and says so without revealing whether the account exists', async () => {
    const forgot = vi.spyOn(apiClient, 'forgotPassword').mockResolvedValue({ success: true });
    render(
      <AuthContext.Provider value={auth as any}>
        <AuthPage />
      </AuthContext.Provider>,
    );
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'ravi@acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    // The typed email carries over
    expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe('ravi@acme.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(forgot).toHaveBeenCalledWith('ravi@acme.com'));
    expect(await screen.findByText(/has an account, we've emailed it a link/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy();
  });

  it('the emailed link asks for the new password twice, then sends people to sign in', async () => {
    at('/reset-password?token=abc123');
    vi.spyOn(apiClient, 'fetchResetPasswordInfo').mockResolvedValue({ email: 'ravi@acme.com' });
    const reset = vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({ success: true, email: 'ravi@acme.com' });
    render(<ResetPasswordPage />);

    expect(await screen.findByText('ravi@acme.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Factory-Pass-2026' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'Factory-Pass-2025' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/don't match/)).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'Factory-Pass-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('abc123', 'Factory-Pass-2026'));
    expect(await screen.findByText(/Your password is changed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('an expired or used link explains what to do', async () => {
    at('/reset-password?token=old');
    vi.spyOn(apiClient, 'fetchResetPasswordInfo').mockRejectedValue(new Error('This link has expired or was already used. Ask for a new one from the login page.'));
    render(<ResetPasswordPage />);
    expect(await screen.findByText(/expired or was already used/)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});

describe('Confirm email link', () => {
  it('confirms the address once and offers to sign in', async () => {
    at('/verify-email?token=v1');
    const verify = vi.spyOn(apiClient, 'verifyEmail').mockResolvedValue({ success: true, email: 'ravi@acme.com' });
    render(<VerifyEmailPage />);
    expect(await screen.findByText('ravi@acme.com is confirmed. You can sign in now.')).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Continue to sign in' })).toBeTruthy();
  });
});
