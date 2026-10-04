import React, { useState, useEffect } from 'react';
import {
  Zap,
  Lock,
  Mail,
  Building,
  ArrowRight,
  Shield,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../context/auth-context';
import { fetchInviteInfo, type InviteInfo } from '../api/client';

export function AcceptInvitePage() {
  const { acceptInvite } = useAuth();

  // Extract token from URL
  const queryParams = new URLSearchParams(window.location.search);
  const initialToken = queryParams.get('token') || '';

  const [token, setToken] = useState(initialToken);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(Boolean(initialToken));
  const [infoError, setInfoError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadingInfo(false);
      return;
    }

    let isMounted = true;
    setLoadingInfo(true);
    setInfoError(null);

    fetchInviteInfo(token)
      .then((info) => {
        if (isMounted) {
          setInviteInfo(info);
          setLoadingInfo(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setInfoError(err.message || 'Invitation is invalid, expired, or already used.');
          setLoadingInfo(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setSubmitError('Invite token is required.');
      return;
    }
    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const email = inviteInfo ? inviteInfo.email : '';
      await acceptInvite(token.trim(), email, password);
      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to accept invitation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        backgroundColor: 'var(--bg)',
        backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(99, 102, 241, 0.08) 0%, transparent 60%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '2rem 2rem 1.5rem',
            textAlign: 'center',
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent)',
              marginBottom: '1rem',
            }}
          >
            <Zap size={24} />
          </div>
          <h1
            style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              marginBottom: '0.25rem',
            }}
          >
            Workspace Invitation
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {inviteInfo
              ? `You've been invited to join ${inviteInfo.tenantName}`
              : 'Accept invitation to join workspace'}
          </p>
        </div>

        {/* Content Body */}
        <div style={{ padding: '2rem' }}>
          {loadingInfo ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '0.875rem' }}>Verifying invitation...</p>
            </div>
          ) : infoError ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  marginBottom: '1rem',
                }}
              >
                <AlertCircle size={24} />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Invalid or Expired Invitation
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                {infoError}
              </p>
              <a
                href="/"
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  padding: '0.625rem',
                  textDecoration: 'none',
                }}
              >
                Return to Login
              </a>
            </div>
          ) : success ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  color: '#22c55e',
                  marginBottom: '1rem',
                }}
              >
                <CheckCircle2 size={24} />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Invitation Accepted!
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Redirecting you to the workspace...
              </p>
            </div>
          ) : (
            <>
              {/* Invite Summary Card */}
              {inviteInfo && (
                <div
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md, 8px)',
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <Building size={15} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>Workspace:</span>
                    <strong style={{ color: 'var(--text)' }}>{inviteInfo.tenantName}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <Shield size={15} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>Role:</span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '0.125rem 0.375rem',
                        borderRadius: '4px',
                        backgroundColor: 'var(--accent-subtle)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent)',
                      }}
                    >
                      {inviteInfo.role}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <Mail size={15} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>Account:</span>
                    <span style={{ color: 'var(--text)' }}>{inviteInfo.email}</span>
                  </div>
                </div>
              )}

              {submitError && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-md, 8px)',
                    padding: '0.75rem 1rem',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: '#ef4444',
                    fontSize: '0.875rem',
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {!inviteInfo && (
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        marginBottom: '0.375rem',
                        color: 'var(--text)',
                      }}
                    >
                      Invitation Token
                    </label>
                    <div style={{ position: 'relative' }}>
                      <KeyRound
                        size={16}
                        style={{
                          position: 'absolute',
                          left: '0.75rem',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-muted)',
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Paste invite token..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        required
                        className="form-input"
                        style={{
                          width: '100%',
                          padding: '0.625rem 0.875rem 0.625rem 2.5rem',
                          backgroundColor: 'var(--surface-subtle)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md, 8px)',
                          fontSize: '0.875rem',
                          height: '42px',
                        }}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      marginBottom: '0.375rem',
                      color: 'var(--text)',
                    }}
                  >
                    {inviteInfo?.userExists
                      ? 'Account Password (Verify to join)'
                      : 'Create Password (min 8 characters)'}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock
                      size={16}
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                      }}
                    />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="form-input"
                      style={{
                        width: '100%',
                        padding: '0.625rem 0.875rem 0.625rem 2.5rem',
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md, 8px)',
                        fontSize: '0.875rem',
                        height: '42px',
                      }}
                    />
                  </div>
                  {inviteInfo?.userExists ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                      Enter your existing password to associate your account with this workspace.
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                      Choose a secure password for your new workspace account.
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.6875rem 1rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    borderRadius: 'var(--radius-md, 8px)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    marginTop: '0.5rem',
                  }}
                >
                  {submitting ? (
                    'Accepting Invitation...'
                  ) : inviteInfo?.userExists ? (
                    <>
                      <UserCheck size={16} /> Join Workspace
                    </>
                  ) : (
                    <>
                      Accept & Set Password <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
