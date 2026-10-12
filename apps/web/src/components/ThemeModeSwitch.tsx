import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../context/theme-context';
import type { ThemePreference } from '@config-platform/schema';

export const ThemeModeSwitch: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
    { value: 'system', label: 'System', icon: <Monitor size={14} /> },
    { value: 'light', label: 'Light', icon: <Sun size={14} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
  ];

  return (
    <div
      role="group"
      aria-label="Theme mode switcher"
      data-testid="theme-mode-switch"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: 'var(--surface-2)',
        borderRadius: 'var(--radius-control)',
        padding: 'var(--spacing-1)',
        gap: 'var(--spacing-1)',
        border: 'var(--border-width-sm) solid var(--border)',
      }}
    >
      {options.map((opt) => {
        const isActive = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`theme-option-${opt.value}`}
            onClick={() => setTheme(opt.value)}
            title={`Switch to ${opt.label} mode`}
            aria-pressed={isActive}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)',
              padding: compact ? 'var(--spacing-1)' : 'var(--spacing-1) var(--spacing-2)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              backgroundColor: isActive ? 'var(--surface)' : 'transparent',
              border: isActive ? 'var(--border-width-sm) solid var(--border)' : 'var(--border-width-sm) solid transparent',
              borderRadius: 'var(--radius-control)',
              cursor: 'pointer',
              transition: 'all 0.15s ease-in-out',
              lineHeight: 1,
            }}
          >
            {opt.icon}
            {!compact && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
};
