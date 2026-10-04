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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
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
          borderRadius: 'var(--radius, 8px)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
          width: '100%',
          maxWidth: 550,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{title}</h3>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            className="btn btn-ghost"
            style={{
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
