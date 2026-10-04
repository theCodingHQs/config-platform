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
        gap: '0.75rem',
      }}
    >
      {/* Tab Navigation Headers */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border, #e5e7eb)',
          gap: '0.5rem',
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
                borderBottom: isActive ? '2px solid var(--accent, #4f46e5)' : '2px solid transparent',
                color: isActive ? 'var(--accent, #4f46e5)' : 'var(--text-muted, #6b7280)',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.875rem',
                padding: '0.5rem 0.75rem',
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
