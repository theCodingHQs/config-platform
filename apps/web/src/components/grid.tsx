import React from 'react';
import type { GridProps } from '@config-platform/schema';

export const GridComponent: React.FC<Partial<GridProps> & { children?: React.ReactNode }> = ({
  columns = 2,
  gap = 16,
  responsiveCollapse = true,
  align,
  minColWidth,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  children,
}) => {
  const gapValue = typeof gap === 'number' ? `${gap}px` : gap;
  const minColWidthValue =
    typeof minColWidth === 'number' ? `${minColWidth}px` : minColWidth;

  const templateColumns = minColWidthValue
    ? `repeat(auto-fit, minmax(${minColWidthValue}, 1fr))`
    : `repeat(${columns}, minmax(0, 1fr))`;

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className={`layout-grid${responsiveCollapse ? ' responsive-collapse' : ''}`}
      data-testid="layout-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: templateColumns,
        gap: gapValue,
        alignItems: align,
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
};
