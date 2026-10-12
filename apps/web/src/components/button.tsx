import React from 'react';
import type { ButtonProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';
import { DynamicIcon } from './dynamic-icon';

export const ButtonComponent: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  disabled = false,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  onClick,
}) => {
  const runtime = usePageRuntime();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!disabled && onClick && runtime) {
      runtime.runActionChain(onClick);
    }
  };

  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const iconElement = icon ? (
    <DynamicIcon
      name={icon}
      size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16}
    />
  ) : null;

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (fullWidth ? '100%' : undefined);

  return (
    <button
      type="button"
      className={`btn btn-${variant} ${sizeClass}`.trim()}
      disabled={disabled}
      onClick={handleClick}
      style={{
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        flex: flex !== undefined ? flex : undefined,
        alignSelf,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
      }}
    >
      {iconPosition === 'left' && iconElement}
      <span>{label}</span>
      {iconPosition === 'right' && iconElement}
    </button>
  );
};
