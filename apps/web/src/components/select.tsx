import React from 'react';
import type { SelectProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';

export function SelectComponent({
  label,
  valueKey,
  options = [],
  placeholder = '-- Select --',
  helpText,
  disabled,
  clearable,
  onChangeAction,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
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

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : undefined;

  return (
    <div
      className="form-group"
      style={{
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
      }}
    >
      {label && <label className="form-label">{label}</label>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <select
          className="form-select"
          value={value}
          disabled={disabled}
          onChange={handleChange}
        >
          <option value="">{placeholder || '-- Select --'}</option>
          {parsedOptions.map((opt, idx) => (
            <option key={idx} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {clearable && value !== '' && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--font-size-xs)' }}
            onClick={() => {
              if (runtime) {
                runtime.setKey(valueKey, '');
                if (onChangeAction && onChangeAction.length > 0) {
                  runtime.runActionChain(onChangeAction, {
                    state: { ...runtime.state, [valueKey]: '' },
                  });
                }
              }
            }}
          >
            Clear
          </button>
        )}
      </div>
      {helpText && (
        <small
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)',
            marginTop: 'var(--space-1)',
            display: 'block',
          }}
        >
          {helpText}
        </small>
      )}
    </div>
  );
}
