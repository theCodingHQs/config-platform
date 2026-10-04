import React from 'react';
import type { ButtonProps } from '@config-platform/schema';
import { usePageRuntime } from '../context/page-runtime-context';

export const ButtonComponent: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  onClick,
}) => {
  const runtime = usePageRuntime();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick && runtime) {
      runtime.runActionChain(onClick);
    }
  };

  return (
    <button type="button" className={`btn btn-${variant}`} onClick={handleClick}>
      {label}
    </button>
  );
};
