import React from 'react';
import type { InputProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';
import { DynamicIcon } from './dynamic-icon';
import { DateInput } from './date-input';

export function InputComponent({
  label,
  valueKey,
  placeholder,
  type = 'text',
  helpText,
  required,
  disabled,
  prefixIcon,
  onChangeAction,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}: InputProps) {
  const runtime = usePageRuntime();
  const value = runtime ? runtime.state[valueKey] ?? '' : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value);

  const setValue = (rawVal: string) => {
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
      {label && (
        <label
          className="form-label"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          <span>{label}</span>
          {required && <span style={{ color: 'var(--danger)' }}>*</span>}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {prefixIcon && (
          <div
            style={{
              position: 'absolute',
              left: 'var(--space-3)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <DynamicIcon name={prefixIcon} size={16} />
          </div>
        )}
        {type === 'date' ? (
          // Typed or picked in the viewer's date format; page state holds "YYYY-MM-DD"
          <DateInput
            aria-label={label || placeholder}
            value={value || undefined}
            disabled={disabled}
            onChange={(date) => setValue(date ?? '')}
            inputStyle={prefixIcon ? { paddingLeft: 'calc(var(--space-3) + 22px)' } : undefined}
          />
        ) : (
          <input
            type={type}
            className="form-input"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            required={required}
            onChange={handleChange}
            style={{
              paddingLeft: prefixIcon ? 'calc(var(--space-3) + 22px)' : undefined,
            }}
          />
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
