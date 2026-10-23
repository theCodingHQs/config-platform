import React, { useEffect, useRef, useState } from 'react';
import { verifyEmail } from '../api/client';
import { AuthNotice, AuthShell, goToLogin } from './auth-shell';

/** /verify-email?token=…: reached from the "Confirm your email address" email. */
export function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'failed'; message: string }>(
    token ? { status: 'working' } : { status: 'failed', message: 'This link is incomplete. Open it again from the email.' },
  );
  const sent = useRef(false);

  useEffect(() => {
    // Once only (React may run effects twice in development)
    if (!token || sent.current) return;
    sent.current = true;
    verifyEmail(token)
      .then((r) => setState({ status: 'done', email: r.email }))
      .catch((err: Error) => setState({ status: 'failed', message: err.message || 'This link could not be used.' }));
  }, [token]);

  return (
    <AuthShell title="Confirm your email">
      {state.status === 'working' && <p style={{ margin: 0, textAlign: 'center', color: 'var(--text-muted)' }}>Confirming…</p>}
      {state.status === 'done' && <AuthNotice tone="success">{state.email} is confirmed. You can sign in now.</AuthNotice>}
      {state.status === 'failed' && <AuthNotice tone="danger">{state.message}</AuthNotice>}
      {state.status !== 'working' && (
        <button type="button" className="btn btn-primary" onClick={goToLogin}>Continue to sign in</button>
      )}
    </AuthShell>
  );
}
