import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  type ThemePreference,
  type WorkspaceThemeConfig,
  generateTokensCss,
} from '@config-platform/schema';
import { apiFetch, fetchWorkspaceTheme } from '../api/client';
import { AuthContext } from './auth-context';

export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (newTheme: ThemePreference) => void;
  workspaceTheme: WorkspaceThemeConfig;
  setWorkspaceTheme: (config: WorkspaceThemeConfig) => void;
  themeEditing: 'enabled' | 'locked';
  refetchWorkspaceTheme: () => Promise<void>;
}

const STORAGE_KEY = 'theme_preference';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'system';
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    return mql && mql.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const defaultWorkspaceTheme: WorkspaceThemeConfig = {
  presetId: 'neutral',
  overrides: {},
};

export const ThemeProvider: React.FC<{
  initialTheme?: ThemePreference;
  initialWorkspaceTheme?: WorkspaceThemeConfig;
  initialThemeEditing?: 'enabled' | 'locked';
  children: React.ReactNode;
}> = ({
  initialTheme,
  initialWorkspaceTheme,
  initialThemeEditing = 'enabled',
  children,
}) => {
  const [theme, setThemeState] = useState<ThemePreference>(() => initialTheme || getInitialTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => resolveSystemTheme() === 'dark');
  const [workspaceTheme, setWorkspaceThemeState] = useState<WorkspaceThemeConfig>(
    () => initialWorkspaceTheme || defaultWorkspaceTheme
  );
  const [themeEditing, setThemeEditing] = useState<'enabled' | 'locked'>(initialThemeEditing);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // Apply workspace theme tokens to DOM style sheet
  const applyWorkspaceThemeToDom = useCallback((config: WorkspaceThemeConfig) => {
    if (typeof document === 'undefined') return;
    let styleTag = document.getElementById('workspace-theme-overrides') as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'workspace-theme-overrides';
      document.head.appendChild(styleTag);
    }
    const css = generateTokensCss(config);
    styleTag.textContent = css;
  }, []);

  // Apply theme attributes to DOM
  const applyThemeToDom = useCallback(
    (currentTheme: ThemePreference, resolved: ResolvedTheme, wsTheme: WorkspaceThemeConfig) => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      root.setAttribute('data-theme', currentTheme);
      root.style.colorScheme = resolved;

      applyWorkspaceThemeToDom(wsTheme);

      // Dispatch event so charts (ECharts) re-read the theme tokens
      window.dispatchEvent(
        new CustomEvent('theme-changed', {
          detail: { theme: currentTheme, resolvedTheme: resolved, workspaceTheme: wsTheme },
        })
      );
    },
    [applyWorkspaceThemeToDom]
  );

  const setTheme = useCallback(
    (newTheme: ThemePreference) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {
        // Ignore localStorage write failure
      }

      const currentResolved = newTheme === 'system' ? (resolveSystemTheme() === 'dark' ? 'dark' : 'light') : newTheme;
      applyThemeToDom(newTheme, currentResolved, workspaceTheme);

      // Async backend sync (best-effort)
      apiFetch('/auth/theme', {
        method: 'PATCH',
        body: JSON.stringify({ theme: newTheme }),
      }).catch(() => {
        // Ignore sync failure if offline or unauthenticated
      });
    },
    [applyThemeToDom, workspaceTheme]
  );

  const setWorkspaceTheme = useCallback(
    (newWsTheme: WorkspaceThemeConfig) => {
      setWorkspaceThemeState(newWsTheme);
      applyThemeToDom(theme, resolvedTheme, newWsTheme);
    },
    [applyThemeToDom, theme, resolvedTheme]
  );

  const refetchWorkspaceTheme = useCallback(async () => {
    try {
      const data = await fetchWorkspaceTheme();
      if (data?.themeConfig) {
        setWorkspaceThemeState(data.themeConfig);
        if (data.themeEditing) {
          setThemeEditing(data.themeEditing);
        }
        applyWorkspaceThemeToDom(data.themeConfig);
        window.dispatchEvent(
          new CustomEvent('theme-changed', {
            detail: { theme, resolvedTheme, workspaceTheme: data.themeConfig },
          })
        );
      }
    } catch {
      // Ignore if unauthenticated or offline
    }
  }, [applyWorkspaceThemeToDom, theme, resolvedTheme]);

  // The workspace theme belongs to whoever is signed in: load it on sign-in (or a switch to
  // another workspace), and go back to the default on sign-out so the login screen doesn't
  // keep the previous workspace's spacing and text size
  const auth = useContext(AuthContext);
  const signedInWorkspace = auth ? (auth.user ? `${auth.user.id}:${auth.user.tenantId}` : null) : undefined;
  useEffect(() => {
    if (initialWorkspaceTheme) return;
    if (signedInWorkspace === null) {
      if (auth?.loading) return;
      setWorkspaceThemeState(defaultWorkspaceTheme);
      setThemeEditing('enabled');
      return;
    }
    refetchWorkspaceTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkspaceTheme, signedInWorkspace, auth?.loading]);

  // Sync if initialTheme prop changes from auth profile
  useEffect(() => {
    if (initialTheme && initialTheme !== theme) {
      setThemeState(initialTheme);
      try {
        localStorage.setItem(STORAGE_KEY, initialTheme);
      } catch {}
      const currentResolved = initialTheme === 'system' ? (resolveSystemTheme() === 'dark' ? 'dark' : 'light') : initialTheme;
      applyThemeToDom(initialTheme, currentResolved, workspaceTheme);
    }
  }, [initialTheme, workspaceTheme, applyThemeToDom]);

  // Listen to OS system color-scheme changes (live matchMedia updates)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
      if (theme === 'system') {
        applyThemeToDom('system', e.matches ? 'dark' : 'light', workspaceTheme);
      }
    };

    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, [theme, workspaceTheme, applyThemeToDom]);

  // Initial DOM application on mount
  useEffect(() => {
    applyThemeToDom(theme, resolvedTheme, workspaceTheme);
  }, [theme, resolvedTheme, workspaceTheme, applyThemeToDom]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        workspaceTheme,
        setWorkspaceTheme,
        themeEditing,
        refetchWorkspaceTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Graceful fallback for non-provider renders/tests
    return {
      theme: 'system',
      resolvedTheme: resolveSystemTheme(),
      setTheme: () => {},
      workspaceTheme: defaultWorkspaceTheme,
      setWorkspaceTheme: () => {},
      themeEditing: 'enabled',
      refetchWorkspaceTheme: async () => {},
    };
  }
  return context;
}
