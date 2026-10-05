import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

export interface StateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: Record<string, any>;
  onSave: (newState: Record<string, any>) => void;
}

export const StateEditorModal: React.FC<StateEditorModalProps> = ({
  isOpen,
  onClose,
  state = {},
  onSave,
}) => {
  const [entries, setEntries] = useState<Array<{ key: string; value: string }>>(() => {
    return Object.entries(state).map(([k, v]) => ({
      key: k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
    }));
  });

  if (!isOpen) return null;

  const handleAdd = () => {
    setEntries([...entries, { key: '', value: '' }]);
  };

  const handleRemove = (idx: number) => {
    setEntries(entries.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const nextState: Record<string, any> = {};
    for (const entry of entries) {
      const trimmedKey = entry.key.trim();
      if (trimmedKey) {
        let parsedVal: any = entry.value;
        try {
          parsedVal = JSON.parse(entry.value);
        } catch {
          parsedVal = entry.value;
        }
        nextState[trimmedKey] = parsedVal;
      }
    }
    onSave(nextState);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
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
        padding: 'var(--space-5)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          width: '100%',
          maxWidth: '500px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          border: 'var(--border-width) solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderBottom: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text)' }}>Page State Editor</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost"
            style={{ padding: 'var(--space-1)', display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--muted)', margin: 0 }}>
            Define initial state variables accessible in expressions as <code>state.&lt;key&gt;</code>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {entries.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Key (e.g. selectedId)"
                  className="form-input"
                  value={entry.key}
                  onChange={(e) => {
                    const next = [...entries];
                    next[idx].key = e.target.value;
                    setEntries(next);
                  }}
                  style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}
                />
                <input
                  type="text"
                  placeholder="Initial Value"
                  className="form-input"
                  value={entry.value}
                  onChange={(e) => {
                    const next = [...entries];
                    next[idx].value = e.target.value;
                    setEntries(next);
                  }}
                  style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}
                />
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 'var(--space-1)', color: 'var(--danger)' }}
                  aria-label="Remove Key"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAdd}
            style={{ alignSelf: 'flex-start', fontSize: 'var(--font-size-sm)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Plus size={14} /> Add Variable
          </button>
        </div>

        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 'var(--font-size-sm)' }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} style={{ fontSize: 'var(--font-size-sm)' }}>
            Save State
          </button>
        </div>
      </div>
    </div>
  );
};
