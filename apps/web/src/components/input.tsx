import React from 'react';
import type { InputProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';

export function InputComponent({
  label,
  valueKey,
  placeholder,
  type = 'text',
  onChangeAction,
}: InputProps) {
  const runtime = usePageRuntime();
  const value = runtime ? runtime.state[valueKey] ?? '' : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const nextVal = type === 'number' ? (rawVal === '' ? '' : Number(rawVal)) : rawVal;

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
      <input
        type={type}
        className="form-input"
        placeholder={placeholder}
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
      />
    </div>
  );
}
