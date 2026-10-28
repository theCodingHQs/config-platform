import React, { useRef } from "react";
import { Palette, SquareRoundCorner, Type, LayoutPanelLeft } from "lucide-react";

export type ThemeTabId = "colors" | "shape" | "spacing" | "layout";

export const THEME_TABS: ReadonlyArray<{ id: ThemeTabId; label: string; icon: React.ReactNode }> = [
  { id: "colors", label: "Colors", icon: <Palette size={15} /> },
  { id: "shape", label: "Shape", icon: <SquareRoundCorner size={15} /> },
  { id: "spacing", label: "Spacing & Text", icon: <Type size={15} /> },
  { id: "layout", label: "Layout", icon: <LayoutPanelLeft size={15} /> },
];

export const THEME_TAB_IDS: readonly ThemeTabId[] = THEME_TABS.map((t) => t.id);

export const themeTabId = (id: ThemeTabId) => `theme-tab-${id}`;
export const themePanelId = (id: ThemeTabId) => `theme-panel-${id}`;

/**
 * Tab bar for the Theme Studio settings (WAI-ARIA tabs: arrow keys, Home/End).
 * `invalid` marks tabs holding a value that blocks saving, so a disabled Save button is
 * never unexplained while that tab is hidden.
 */
export function ThemeSettingsTabs({
  active,
  onChange,
  invalid,
}: {
  active: ThemeTabId;
  onChange: (id: ThemeTabId) => void;
  invalid: Partial<Record<ThemeTabId, boolean>>;
}) {
  const refs = useRef<Partial<Record<ThemeTabId, HTMLButtonElement | null>>>({});

  const focusTab = (index: number) => {
    const tab = THEME_TABS[(index + THEME_TABS.length) % THEME_TABS.length];
    onChange(tab.id);
    refs.current[tab.id]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: THEME_TABS.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusTab(moves[event.key]);
    }
  };

  return (
    <div role="tablist" aria-label="Theme settings" className="theme-tabs">
      {THEME_TABS.map((tab, index) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={themeTabId(tab.id)}
            aria-selected={isActive}
            aria-controls={themePanelId(tab.id)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`theme-tab${isActive ? " active" : ""}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {invalid[tab.id] && (
              <span className="theme-tab-error" title="This tab has a value that needs fixing" aria-label="has an error" />
            )}
          </button>
        );
      })}
    </div>
  );
}
