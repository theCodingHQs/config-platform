import React from 'react';
import type { ModalProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';
import { useOptionalMetadata } from '../context/metadata-context';
import { X } from 'lucide-react';
import { DynamicIcon } from './dynamic-icon';
import { contentLayout } from './content-layout';

export function ModalComponent({
  title = 'Modal',
  subtitle,
  icon,
  entityId,
  openStateKey,
  size = 'md',
  showCloseButton = true,
  direction,
  gap,
  align,
  justify,
  wrap,
  children,
}: ModalProps & { children?: React.ReactNode }) {
  const runtime = usePageRuntime();
  const metadata = useOptionalMetadata();
  const body = contentLayout({ direction, gap, align, justify, wrap });
  const entity = entityId && metadata ? metadata.resolveEntity(entityId) : undefined;
  const effectiveIcon =
    icon ||
    entity?.icon ||
    (title?.toLowerCase().includes('user') ? 'User' : 'Database');
  const effectiveSubtitle =
    subtitle ||
    (entity
      ? title?.toLowerCase().includes('edit')
        ? `Update the ${entity.label?.toLowerCase() || entity.name}'s information below.`
        : `Fill in the details below to add a new ${entity.label?.toLowerCase() || entity.name}.`
      : title?.toLowerCase().includes('edit')
      ? 'Update the record details and information below.'
      : title?.toLowerCase().includes('create') || title?.toLowerCase().includes('new')
      ? 'Fill in the information below to create a new record.'
      : undefined);
  const isOpen = runtime ? Boolean(runtime.state[openStateKey]) : false;

  const sizeMaxWidthMap: Record<string, number | string> = {
    sm: 440,
    md: 580,
    lg: 760,
    xl: 960,
    full: '95vw',
  };

  if (!isOpen) {
    return null;
  }

  const handleClose = () => {
    if (runtime) {
      runtime.setKey(openStateKey, false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="modal-overlay"
      className="runtime-modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-bg)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-5)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        data-testid="modal-container"
        className="runtime-modal"
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-surface)',
          boxShadow: 'var(--shadow-xl)',
          width: '100%',
          maxWidth: sizeMaxWidthMap[size] || 580,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: 'var(--border-width-sm) solid var(--border)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: 'var(--border-width-sm) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {effectiveIcon && (
              <div
                style={{
                  width: 'var(--control-height-lg)',
                  height: 'var(--control-height-lg)',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--primary-subtle)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <DynamicIcon name={effectiveIcon} size={22} color="var(--primary)" />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-lg)',
                  fontWeight: 600,
                  color: 'var(--text)',
                  lineHeight: 1.3,
                }}
              >
                {title}
              </h3>
              {effectiveSubtitle && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--text-muted)',
                    lineHeight: 1.4,
                  }}
                >
                  {effectiveSubtitle}
                </p>
              )}
            </div>
          </div>

          {showCloseButton && (
            <button
              onClick={handleClose}
              aria-label="Close modal"
              className="btn btn-ghost"
              style={{
                padding: 'var(--space-1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-control)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div
          data-testid="modal-body"
          className={body.className}
          style={{
            padding: 'var(--space-6)',
            overflowY: 'auto',
            maxHeight: 'calc(85vh - 120px)',
            ...body.style,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
