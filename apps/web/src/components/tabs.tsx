import React, { useState } from 'react';
import type { TabsProps } from '@config-platform/schema';

export const TabsComponent: React.FC<TabsProps & { children?: React.ReactNode }> = ({
  tabs = [],
  defaultTab,
  children,
}) => {
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return defaultTab || tabs[0]?.id || '0';
  });

  const childrenArray = React.Children.toArray(children);
  const activeIndex = tabs.findIndex((t, idx) => t.id === activeTabId || String(idx) === activeTabId);

  return (
    <div
      className="tabs-container"
      data-testid="tabs-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        gap: 'var(--spacing-3)',
      }}
    >
      {/* Tab Navigation Headers */}
      <div
        style={{
          display: 'flex',
          borderBottom: 'var(--border-width-sm) solid var(--border)',
          gap: 'var(--spacing-2)',
        }}
        role="tablist"
      >
        {tabs.map((tab, idx) => {
          const tabKey = tab.id || String(idx);
          const isActive = tabKey === activeTabId || (activeIndex === -1 && idx === 0);

          return (
            <button
              key={tabKey}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tabKey)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? 'var(--border-width-md) solid var(--accent)' : 'var(--border-width-md) solid transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 'var(--font-size-sm)',
                padding: 'var(--spacing-2) var(--spacing-3)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
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
