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
        padding: 'var(--space-6)',
        backgroundColor: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--surface)',
          border: 'var(--border-width) solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
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
              borderRadius: 'var(--radius-md)',
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
              marginBottom: 'var(--space-1)',
            }}
          >
            Workspace Invitation
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-sm)' }}>
            {inviteInfo
              ? `You've been invited to join ${inviteInfo.tenantName}`
              : 'Accept invitation to join workspace'}
          </p>
        </div>

        {/* Content Body */}
        <div style={{ padding: 'var(--space-6)' }}>
          {loadingInfo ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6) 0', color: 'var(--muted)' }}>
              <p style={{ fontSize: 'var(--font-size-sm)' }}>Verifying invitation...</p>
            </div>
          ) : infoError ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 'var(--control-height-lg)',
                  height: 'var(--control-height-lg)',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--danger-subtle)',
                  color: 'var(--danger)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <AlertCircle size={24} />
              </div>
              <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                Invalid or Expired Invitation
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
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
                  textDecoration: 'none',
                }}
              >
                Return to Login
              </a>
            </div>
          ) : success ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 'var(--control-height-lg)',
                  height: 'var(--control-height-lg)',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--success-subtle)',
                  color: 'var(--success)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <CheckCircle2 size={24} />
              </div>
              <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                Invitation Accepted!
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-sm)' }}>
                Redirecting you to the workspace...
              </p>
            </div>
          ) : (
            <>
              {/* Invite Summary Card */}
              {inviteInfo && (
                <div
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    border: 'var(--border-width) solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-4)',
                    marginBottom: 'var(--space-5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <Building size={15} style={{ color: 'var(--muted)' }} />
                    <span style={{ color: 'var(--muted)' }}>Workspace:</span>
                    <strong style={{ color: 'var(--text)' }}>{inviteInfo.tenantName}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <Shield size={15} style={{ color: 'var(--muted)' }} />
                    <span style={{ color: 'var(--muted)' }}>Role:</span>
                    <span className="badge badge-accent">
                      {inviteInfo.role}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <Mail size={15} style={{ color: 'var(--muted)' }} />
                    <span style={{ color: 'var(--muted)' }}>Account:</span>
                    <span style={{ color: 'var(--text)' }}>{inviteInfo.email}</span>
                  </div>
                </div>
              )}

              {submitError && (
                <div
                  style={{
                    backgroundColor: 'var(--danger-subtle)',
                    border: 'var(--border-width) solid var(--danger)',
                    borderRadius: 'var(--radius-md)',
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
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {!inviteInfo && (
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
                      Invitation Token
                    </label>
                    <div style={{ position: 'relative' }}>
                      <KeyRound
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
                        placeholder="Paste invite token..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        required
                        className="form-input"
                        style={{
                          width: '100%',
                          paddingLeft: 'var(--space-8)',
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
                    {inviteInfo?.userExists
                      ? 'Account Password (Verify to join)'
                      : 'Create Password (min 8 characters)'}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock
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
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="form-input"
                      style={{
                        width: '100%',
                        paddingLeft: 'var(--space-8)',
                      }}
                    />
                  </div>
                  {inviteInfo?.userExists ? (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted)', marginTop: 'var(--space-1)', display: 'block' }}>
                      Enter your existing password to associate your account with this workspace.
                    </span>
                  ) : (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted)', marginTop: 'var(--space-1)', display: 'block' }}>
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
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    marginTop: 'var(--space-2)',
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
