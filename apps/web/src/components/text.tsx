import React from 'react';
import type { TextProps } from '@config-platform/schema';

export const TextComponent: React.FC<TextProps> = ({
  value,
  variant = 'body',
  align = 'left',
  weight,
  color = 'default',
  truncate = false,
  noWrap = false,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const colorMap: Record<string, string | undefined> = {
    default: undefined,
    muted: 'var(--text-muted)',
    primary: 'var(--primary)',
    success: 'var(--success)',
    danger: 'var(--danger)',
    warning: 'var(--warning)',
  };

  const weightMap: Record<string, number | undefined> = {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  };

  const style: React.CSSProperties = {
    margin: 0,
    textAlign: align,
    fontWeight: weight ? weightMap[weight] : undefined,
    color: colorMap[color],
    overflow: truncate ? 'hidden' : undefined,
    textOverflow: truncate ? 'ellipsis' : undefined,
    whiteSpace: noWrap || truncate ? 'nowrap' : undefined,
    flex: flex !== undefined ? flex : undefined,
    width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
    minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
    maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
    alignSelf,
  };

  switch (variant) {
    case 'h1':
      return <h1 style={style}>{value}</h1>;
    case 'h2':
      return <h2 style={style}>{value}</h2>;
    case 'h3':
      return <h3 style={style}>{value}</h3>;
    case 'caption':
      return (
        <small
          style={{
            ...style,
            color: style.color || 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          {value}
        </small>
      );
    case 'muted':
      return (
        <p
          style={{
            ...style,
            color: style.color || 'var(--text-muted)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {value}
        </p>
      );
    case 'body':
    default:
      return (
        <p style={{ ...style, fontSize: 'var(--font-size-md)' }}>
          {value}
        </p>
      );
  }
};
