import React from 'react';
import type { SelectProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';

export function SelectComponent({
  label,
  valueKey,
  options = [],
  onChangeAction,
}: SelectProps) {
  const runtime = usePageRuntime();
  const value = runtime ? runtime.state[valueKey] ?? '' : '';

  const parsedOptions = Array.isArray(options) ? options : [];

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextVal = e.target.value;
    if (runtime) {
      runtime.setKey(valueKey, nextVal);
      if (onChangeAction && onChangeAction.length > 0) {
        runtime.runActionChain(onChangeAction, {
          state: { ...runtime.state, [valueKey]: nextVal },
        });
      }
    }
  };

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      {label && <label className="form-label" style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13 }}>{label}</label>}
      <select
        className="form-select"
        value={value}
        onChange={handleChange}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          fontSize: 14,
          background: 'var(--surface)',
          color: 'var(--text)',
          outline: 'none',
        }}
      >
        <option value="">-- Select --</option>
        {parsedOptions.map((opt, idx) => (
          <option key={idx} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
