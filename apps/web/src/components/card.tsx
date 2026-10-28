import React from 'react';
import type { CardProps } from '@config-platform/schema';
import { DynamicIcon } from './dynamic-icon';
import { contentLayout } from './content-layout';

export const CardComponent: React.FC<CardProps & { children?: React.ReactNode }> = ({
  title,
  subtitle,
  headerIcon,
  variant = 'default',
  padding = 'md',
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  direction,
  gap,
  align,
  justify,
  wrap,
  children,
}) => {
  const paddingMap = {
    none: '0',
    sm: 'var(--spacing-3)',
    md: 'var(--spacing-5)',
    lg: 'var(--spacing-8)',
  };

  const shadowMap = {
    default: 'var(--shadow-sm)',
    bordered: 'none',
    flat: 'none',
    elevated: 'var(--shadow-lg)',
    plain: 'none',
  };

  const borderMap = {
    default: 'var(--border-width-sm) solid var(--border)',
    bordered: '2px solid var(--border)',
    flat: 'none',
    elevated: 'var(--border-width-sm) solid var(--border)',
    plain: 'none',
  };

  const body = contentLayout({ direction, gap, align, justify, wrap });

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className={`card-container card-${variant}`}
      data-testid="card-container"
      style={{
        backgroundColor:
          variant === 'plain' ? 'transparent' : variant === 'flat' ? 'var(--surface-subtle)' : 'var(--surface)',
        border: borderMap[variant],
        borderRadius: 'var(--radius-surface)',
        overflow: 'hidden',
        boxShadow: shadowMap[variant],
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(title || subtitle || headerIcon) && (
        <div
          style={{
            padding: 'var(--spacing-3) var(--spacing-5)',
            borderBottom: 'var(--border-width-sm) solid var(--border)',
            backgroundColor: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          {headerIcon && (
            <div style={{ color: 'var(--primary)', display: 'inline-flex' }}>
              <DynamicIcon name={headerIcon} size={18} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            {title && (
              <h3
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                style={{
                  margin: 'var(--spacing-1) 0 0',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-muted)',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>
      )}
      <div
        data-testid="card-body"
        className={body.className}
        style={{
          padding: paddingMap[padding],
          flex: 1,
          ...body.style,
        }}
      >
        {children}
      </div>
    </div>
  );
};
