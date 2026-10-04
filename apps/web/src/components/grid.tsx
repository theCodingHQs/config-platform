import React from 'react';
import type { GridProps } from '@config-platform/schema';

export const GridComponent: React.FC<Partial<GridProps> & { children?: React.ReactNode }> = ({
  columns = 2,
  gap = 16,
  responsiveCollapse = true,
  children,
}) => {
  const gapValue = typeof gap === 'number' ? `${gap}px` : gap;

  return (
    <div
      className={`layout-grid${responsiveCollapse ? ' responsive-collapse' : ''}`}
      data-testid="layout-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: gapValue,
        width: '100%',
      }}
    >
      {children}
    </div>
  );
};
