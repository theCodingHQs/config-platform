import React from 'react';
import type { TextProps } from '@config-platform/schema';

export const TextComponent: React.FC<TextProps> = ({ value, variant = 'body' }) => {
  switch (variant) {
    case 'h1':
      return <h1>{value}</h1>;
    case 'h2':
      return <h2>{value}</h2>;
    case 'h3':
      return <h3>{value}</h3>;
    case 'caption':
      return <small style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>{value}</small>;
    case 'muted':
      return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{value}</p>;
    case 'body':
    default:
      return <p style={{ fontSize: 'var(--font-size-md)' }}>{value}</p>;
  }
};
