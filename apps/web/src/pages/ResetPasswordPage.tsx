import React, { useEffect, useState } from 'react';
import { fetchResetPasswordInfo, resetPassword } from '../api/client';
import { AuthNotice, AuthShell, goToLogin } from './auth-shell';

/** /reset-password?token=…: reached from the "Reset your password" email. */
export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [email, setEmail] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(token ? null : 'This link is incomplete. Open it again from the email, or ask for a new one.');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchResetPasswordInfo(token)
      .then((info) => setEmail(info.email))
      .catch((err: Error) => setLinkError(err.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'The password could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const label: React.CSSProperties = { display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' };

  return (
    <AuthShell title="Choose a new password">
      {linkError ? (
        <>
          <AuthNotice tone="danger">{linkError}</AuthNotice>
          <button type="button" className="btn btn-primary" onClick={goToLogin}>Back to sign in</button>
        </>
      ) : done ? (
        <>
          <AuthNotice tone="success">Your password is changed. Sign in with the new one; you were signed out on your other devices.</AuthNotice>
          <button type="button" className="btn btn-primary" onClick={goToLogin}>Sign in</button>
        </>
      ) : !email ? (
        <p style={{ margin: 0, textAlign: 'center', color: 'var(--text-muted)' }}>Checking the link…</p>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
            For <strong style={{ color: 'var(--text)' }}>{email}</strong>
          </p>
          <div>
            <label style={label} htmlFor="reset-password">New password</label>
            <input id="reset-password" type="password" className="form-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>At least 10 characters.</p>
          </div>
          <div>
            <label style={label} htmlFor="reset-confirm">Type it again</label>
            <input id="reset-confirm" type="password" className="form-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save new password'}</button>
        </form>
      )}
    </AuthShell>
  );
}
