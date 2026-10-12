import React, { useState } from 'react';
import type { TabsProps } from '@config-platform/schema';

export const TabsComponent: React.FC<Omit<TabsProps, 'variant' | 'size'> & { variant?: TabsProps['variant']; size?: TabsProps['size']; children?: React.ReactNode }> = ({
  tabs = [],
  defaultTab,
  variant = 'line',
  size = 'md',
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  children,
}) => {
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return defaultTab || tabs[0]?.id || '0';
  });

  const childrenArray = React.Children.toArray(children);
  const activeIndex = tabs.findIndex((t, idx) => t.id === activeTabId || String(idx) === activeTabId);

  const sizePadding =
    size === 'sm'
      ? 'var(--spacing-1) var(--spacing-2)'
      : size === 'lg'
      ? 'var(--spacing-3) var(--spacing-5)'
      : 'var(--spacing-2) var(--spacing-3)';

  const fontSize =
    size === 'sm'
      ? 'var(--font-size-xs)'
      : size === 'lg'
      ? 'var(--font-size-md)'
      : 'var(--font-size-sm)';

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className="tabs-container"
      data-testid="tabs-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
        gap: 'var(--spacing-3)',
      }}
    >
      {/* Tab Navigation Headers */}
      <div
        style={{
          display: 'flex',
          borderBottom:
            variant === 'line'
              ? 'var(--border-width-sm) solid var(--border)'
              : 'none',
          gap: variant === 'pills' ? 'var(--spacing-2)' : 'var(--spacing-1)',
        }}
        role="tablist"
      >
        {tabs.map((tab, idx) => {
          const tabKey = tab.id || String(idx);
          const isActive = tabKey === activeTabId || (activeIndex === -1 && idx === 0);

          let tabStyle: React.CSSProperties = {
            fontSize,
            padding: sizePadding,
            cursor: 'pointer',
            fontWeight: isActive ? 600 : 500,
            transition: 'all 0.15s ease',
          };

          if (variant === 'pills') {
            tabStyle = {
              ...tabStyle,
              border: 'none',
              borderRadius: 'var(--radius-control)',
              backgroundColor: isActive ? 'var(--accent)' : 'var(--surface-subtle)',
              color: isActive ? 'var(--accent-contrast)' : 'var(--text-muted)',
            };
          } else if (variant === 'enclosed') {
            tabStyle = {
              ...tabStyle,
              backgroundColor: isActive ? 'var(--surface)' : 'var(--surface-subtle)',
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderBottom: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 'var(--radius-control) var(--radius-control) 0 0',
            };
          } else {
            // line
            tabStyle = {
              ...tabStyle,
              background: 'transparent',
              border: 'none',
              borderBottom: isActive
                ? 'var(--border-width-md) solid var(--accent)'
                : 'var(--border-width-md) solid transparent',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            };
          }

          return (
            <button
              key={tabKey}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tabKey)}
              style={tabStyle}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content Panel */}
      <div role="tabpanel" style={{ width: '100%' }}>
        {childrenArray[activeIndex >= 0 ? activeIndex : 0] || null}
      </div>
    </div>
  );
};
