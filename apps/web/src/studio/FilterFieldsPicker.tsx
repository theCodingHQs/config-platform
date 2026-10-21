import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface FilterFieldOption {
  id: string;
  label: string;
  name: string;
}

export interface FilterFieldsPickerProps {
  /** Selected field ids (or names, for filters keyed by name). */
  value: string[];
  options: FilterFieldOption[];
  onChange: (fields: string[]) => void;
  ariaLabel: string;
}

/**
 * Picks one or more fields for a filter condition. With several fields the condition
 * matches when any of them matches (e.g. one search box over name and work center).
 */
export const FilterFieldsPicker: React.FC<FilterFieldsPickerProps> = ({ value, options, onChange, ariaLabel }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const optionFor = (field: string) => options.find((o) => o.id === field) ?? options.find((o) => o.name === field);
  const summary = value.length === 0
    ? 'Select Field'
    : value.map((f) => optionFor(f)?.label ?? `${f} (unknown field)`).join(' or ');

  const toggle = (option: FilterFieldOption) => {
    const selected = value.some((f) => optionFor(f)?.id === option.id);
    onChange(selected ? value.filter((f) => optionFor(f)?.id !== option.id) : [...value, option.id]);
  };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '35%' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="form-select"
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        title={summary}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          fontSize: 'var(--font-size-xs)',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-1)',
          backgroundImage: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <ChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div
          id={listId}
          role="group"
          aria-label={`${ariaLabel} options`}
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-1))',
            left: 0,
            minWidth: '100%',
            maxHeight: '240px',
            overflowY: 'auto',
            zIndex: 10,
            background: 'var(--surface)',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-control)',
            boxShadow: 'var(--shadow-lg)',
            padding: 'var(--space-1)',
          }}
        >
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted)', padding: 'var(--space-1) var(--space-2)' }}>
            Matches if any selected field matches
          </div>
          {options.map((option) => (
            <label
              key={option.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-1) var(--space-2)',
                fontSize: 'var(--font-size-xs)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={value.some((f) => optionFor(f)?.id === option.id)}
                onChange={() => toggle(option)}
              />
              {option.label} ({option.name})
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
