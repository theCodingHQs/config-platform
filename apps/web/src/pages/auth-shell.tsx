import React from 'react';
import { Zap } from 'lucide-react';

/** The centred card used by the pages people reach from emailed links (reset password, confirm email). */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', backgroundColor: 'var(--bg)' }}>
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: 'var(--surface)',
          border: 'var(--border-width) solid var(--border)',
          borderRadius: 'var(--radius-surface)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <Zap size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Message box: success / problem, matching the login page's error style. */
export function AuthNotice({ tone, children }: { tone: 'success' | 'danger'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-control)',
        fontSize: 'var(--font-size-sm)',
        backgroundColor: tone === 'danger' ? 'var(--danger-subtle)' : 'var(--success-subtle)',
        color: tone === 'danger' ? 'var(--danger)' : 'var(--success)',
      }}
    >
      {children}
    </div>
  );
}

/** Leaves an emailed-link page for the login screen (or the app, when already logged in). */
export function goToLogin() {
  window.location.assign('/');
}
