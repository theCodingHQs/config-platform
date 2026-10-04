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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius, 8px)',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.4), 0 10px 10px -5px rgba(0,0,0,0.2)',
          width: '100%',
          maxWidth: 500,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Page State Editor</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost"
            style={{ padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Define initial state variables accessible in expressions as <code>state.&lt;key&gt;</code>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                  style={{ flex: 1, fontSize: 13 }}
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
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--danger)' }}
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
            style={{ alignSelf: 'flex-start', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={14} /> Add Variable
          </button>
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 13 }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} style={{ fontSize: 13 }}>
            Save State
          </button>
        </div>
      </div>
    </div>
  );
};
