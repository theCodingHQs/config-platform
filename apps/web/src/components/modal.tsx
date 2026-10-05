import React from 'react';
import type { ModalProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';
import { X } from 'lucide-react';

export function ModalComponent({
  title = 'Modal',
  openStateKey,
  children,
}: ModalProps & { children?: React.ReactNode }) {
  const runtime = usePageRuntime();
  const isOpen = runtime ? Boolean(runtime.state[openStateKey]) : false;

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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--spacing-5)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        data-testid="modal-container"
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: 550,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: 'var(--border-width-sm) solid var(--border)',
        }}
      >
        <div
          style={{
            padding: 'var(--spacing-4) var(--spacing-5)',
            borderBottom: 'var(--border-width-sm) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text)' }}>{title}</h3>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            className="btn btn-ghost"
            style={{
              padding: 'var(--spacing-1)',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 'var(--spacing-5)', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
