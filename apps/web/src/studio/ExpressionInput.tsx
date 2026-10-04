import React, { useState } from 'react';
import { HelpCircle, Code } from 'lucide-react';

export interface ExpressionInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  scopeHints?: string[];
}

const DEFAULT_SCOPE_HINTS = [
  'state.<key>',
  'params.<key>',
  'row.<field>',
  'ds.<source>',
  'user.name',
  'user.role',
  'concat(a, b)',
  'upper(str)',
  'lower(str)',
  'trim(str)',
  'round(num, 2)',
  'formatDate(val)',
  'formatNumber(num)',
  'coalesce(a, b)',
  'default(val, fallback)',
];

export const ExpressionInput: React.FC<ExpressionInputProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder = 'e.g. {{ state.filterValue }}',
  scopeHints = DEFAULT_SCOPE_HINTS,
}) => {
  const [showHints, setShowHints] = useState(false);

  const handleInsertHint = (hint: string) => {
    let snippet = hint;
    if (hint.includes('(')) {
      snippet = `{{ ${hint} }}`;
    } else {
      snippet = `{{ ${hint} }}`;
    }
    onChange(value ? `${value} ${snippet}` : snippet);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative' }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label htmlFor={id} className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Code size={12} style={{ color: 'var(--text-muted)' }} />
            {label}
          </label>
          <button
            type="button"
            aria-label="Scope Hints"
            onClick={() => setShowHints(!showHints)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: showHints ? 'var(--accent)' : 'var(--text-muted)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <HelpCircle size={14} />
          </button>
        </div>
      )}

      <input
        id={id}
        type="text"
        className="form-input"
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
      />

      {showHints && (
        <div
          data-testid="scope-hints-popover"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius, 6px)',
            padding: '0.5rem',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            maxHeight: '180px',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem', textTransform: 'uppercase' }}>
            Available Scopes & Functions
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {scopeHints.map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => {
                  handleInsertHint(hint);
                  setShowHints(false);
                }}
                style={{
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: '0.6875rem',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
