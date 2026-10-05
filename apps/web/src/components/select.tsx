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
    <div className="form-group" style={{ marginBottom: 'var(--spacing-3)' }}>
      {label && <label className="form-label">{label}</label>}
      <select
        className="form-select"
        value={value}
        onChange={handleChange}
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
