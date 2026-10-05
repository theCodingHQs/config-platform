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
        border: 'var(--border-width-sm) solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            padding: 'var(--spacing-3) var(--spacing-5)',
            borderBottom: 'var(--border-width-sm) solid var(--border)',
            backgroundColor: 'var(--surface-2)',
          }}
        >
          {title && <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text)' }}>{title}</h3>}
          {subtitle && (
            <p style={{ margin: 'var(--spacing-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div style={{ padding: 'var(--spacing-5)', flex: 1 }}>{children}</div>
    </div>
  );
};
