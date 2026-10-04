import React from 'react';
import type { CardProps } from '@config-platform/schema';

export const CardComponent: React.FC<CardProps & { children?: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => {
  return (
    <div
      className="card-container"
      data-testid="card-container"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius, 8px)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          {title && <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>{title}</h3>}
          {subtitle && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div style={{ padding: '1.25rem', flex: 1 }}>{children}</div>
    </div>
  );
};
