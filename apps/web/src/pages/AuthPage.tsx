import React, { useState } from 'react';
import {
  Zap,
  Lock,
  Mail,
  Building,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../context/auth-context';
import { forgotPassword } from '../api/client';

export function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        if (password.length < 10) {
          throw new Error('Password must be at least 10 characters long');
        }
        await signup(email.trim(), password, tenantName.trim() || undefined);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        backgroundColor: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: 'var(--surface)',
          border: 'var(--border-width) solid var(--border)',
          borderRadius: 'var(--radius-surface)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header / Brand Banner */}
        <div
          style={{
            padding: 'var(--space-6) var(--space-6) var(--space-4)',
            textAlign: 'center',
            borderBottom: 'var(--border-width) solid var(--border)',
            backgroundColor: 'var(--surface-2)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 'var(--control-height-md)',
              height: 'var(--control-height-md)',
              borderRadius: 'var(--radius-control)',
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <Zap size={24} />
          </div>
          <h1
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              marginBottom: 'var(--space-1)',
            }}
          >
            ConfigPlatform
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--muted)' }}>
            Dynamic Schema Engine, Studio & Page Runtime
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: 'var(--border-width) solid var(--border)',
            backgroundColor: 'var(--surface)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setForgotOpen(false);
              setError(null);
            }}
            style={{
              flex: 1,
              padding: 'var(--space-3)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: mode === 'login' ? 'var(--accent)' : 'var(--muted)',
              borderBottom: mode === 'login' ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setForgotOpen(false);
              setError(null);
            }}
            style={{
              flex: 1,
              padding: 'var(--space-3)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: mode === 'signup' ? 'var(--accent)' : 'var(--muted)',
              borderBottom: mode === 'signup' ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            Create Account
          </button>
        </div>

        {/* Form Body */}
        <div style={{ padding: 'var(--space-6)' }}>
          {error && (
            <div
              style={{
                backgroundColor: 'var(--danger-subtle)',
                border: 'var(--border-width) solid var(--danger)',
                borderRadius: 'var(--radius-surface)',
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                color: 'var(--danger)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {forgotOpen ? (
            <ForgotPasswordForm initialEmail={email} onBack={() => setForgotOpen(false)} />
          ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {mode === 'signup' && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    marginBottom: 'var(--space-1)',
                    color: 'var(--text)',
                  }}
                >
                  Workspace / Organization Name
                </label>
                <div style={{ position: 'relative' }}>
                  <Building
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--muted)',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Acme Corporation"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    className="form-input"
                    style={{
                      width: '100%',
                      paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                    }}
                  />
                </div>
              </div>
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  marginBottom: 'var(--space-1)',
                  color: 'var(--text)',
                }}
              >
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 'var(--space-3)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  style={{
                    width: '100%',
                    paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                  }}
                  required
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                <label
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Password
                </label>
                {mode === 'signup' && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted)' }}>Min. 10 characters</span>
                )}
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setForgotOpen(true);
                    }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--accent)' }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 'var(--space-3)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                  style={{
                    width: '100%',
                    paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                  }}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-2)',
              }}
            >
              {loading ? (
                'Processing...'
              ) : mode === 'login' ? (
                <>
                  Sign In <ArrowRight size={16} />
                </>
              ) : (
                <>
                  Create Account & Tenant <ShieldCheck size={16} />
                </>
              )}
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Forgot password?": asks for the email and sends a one-time link to choose a new password. */
function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await forgotPassword(email.trim());
      setSentTo(email.trim());
    } catch (err: any) {
      setError(err.message || 'The link could not be sent. Try again in a few minutes.');
    } finally {
      setSending(false);
    }
  };

  if (sentTo) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div role="status" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-control)', fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--success-subtle)', color: 'var(--success)' }}>
          If <strong>{sentTo}</strong> has an account, we've emailed it a link to choose a new password. It works once, for one hour.
          Check the spam folder if it doesn't arrive in a few minutes.
        </div>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        Enter your email and we'll send you a link to choose a new password.
      </p>
      <div>
        <label htmlFor="forgot-email" style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
          Email Address
        </label>
        <div style={{ position: 'relative' }}>
          <Mail size={16} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            id="forgot-email"
            type="email"
            className="form-input"
            value={email}
            placeholder="name@company.com"
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
            required
            autoFocus
          />
        </div>
      </div>
      {error && (
        <div role="alert" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-control)', fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--danger-subtle)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={sending}>
        {sending ? 'Sending…' : 'Send reset link'}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}
