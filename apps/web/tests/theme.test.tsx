import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  THEME_PRESETS,
  neutralLightPalette,
  neutralDarkPalette,
  defaultSharedTokens,
  SemanticColorsSchema,
  SharedTokensSchema,
  getContrastRatio,
  validateAccentContrast,
} from '@config-platform/schema';
import { ThemeProvider, useTheme } from '../src/context/theme-context';
import { ThemeModeSwitch } from '../src/components/ThemeModeSwitch';
import { ThemeStudio } from '../src/studio/ThemeStudio';
import { AuthContext } from '../src/context/auth-context';
import { AppBarProvider } from '../src/context/app-bar-context';
import * as apiClient from '../src/api/client';

describe('Theme Foundation Unit & Integration Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    const existingStyle = document.getElementById('workspace-theme-overrides');
    if (existingStyle) existingStyle.remove();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signing out puts the login screen back on the default theme; signing in loads the workspace theme', async () => {
    const dense = { presetId: 'neutral', overrides: { density: 'dense' as const } };
    vi.spyOn(apiClient, 'fetchWorkspaceTheme').mockResolvedValue({ themeConfig: dense, themeEditing: 'enabled' } as any);
    const authValue = (user: any) => ({
      user, loading: false, login: vi.fn(), signup: vi.fn(), acceptInvite: vi.fn(), logout: vi.fn(), refetchUser: vi.fn(),
    });
    const admin = { id: 'u1', email: 'admin@example.com', tenantId: 't1', role: 'admin' };
    const spacing8 = () => document.getElementById('workspace-theme-overrides')!.textContent!.match(/--spacing-8: ([^;]+);/)![1];
    const tree = (user: any) => (
      <AuthContext.Provider value={authValue(user)}>
        <ThemeProvider><div /></ThemeProvider>
      </AuthContext.Provider>
    );
    const { rerender } = render(tree(admin));
    await act(async () => {});
    const denseSpacing = spacing8();

    rerender(tree(null));
    await act(async () => {});
    expect(spacing8()).not.toBe(denseSpacing);

    rerender(tree(admin));
    await act(async () => {});
    expect(spacing8()).toBe(denseSpacing);
  });

  describe('Token Parity and Schema Validation', () => {
    it('validates that neutralLightPalette conforms to SemanticColorsSchema', () => {
      const parsed = SemanticColorsSchema.safeParse(neutralLightPalette);
      expect(parsed.success).toBe(true);
    });

    it('validates that neutralDarkPalette conforms to SemanticColorsSchema', () => {
      const parsed = SemanticColorsSchema.safeParse(neutralDarkPalette);
      expect(parsed.success).toBe(true);
    });

    it('validates that defaultSharedTokens conforms to SharedTokensSchema', () => {
      const parsed = SharedTokensSchema.safeParse(defaultSharedTokens);
      expect(parsed.success).toBe(true);
    });

    it('verifies exact key parity between light and dark palettes', () => {
      const lightKeys = Object.keys(neutralLightPalette).sort();
      const darkKeys = Object.keys(neutralDarkPalette).sort();

      expect(lightKeys).toEqual(darkKeys);

      const requiredTokens = [
        'bg',
        'surface',
        'surface-2',
        'text',
        'muted',
        'border',
        'accent',
        'accent-contrast',
        'danger',
        'success',
        'warning',
        'accent-subtle',
        'danger-subtle',
        'success-subtle',
        'warning-subtle',
      ];

      for (const token of requiredTokens) {
        expect(lightKeys).toContain(token);
        expect(darkKeys).toContain(token);
      }
    });

    it('ships 4 immutable presets (Neutral, Slate, Ocean, Warm) with WCAG AA compliance (>= 4.5:1)', () => {
      const presetIds = ['neutral', 'slate', 'ocean', 'warm'] as const;
      for (const id of presetIds) {
        const preset = THEME_PRESETS[id];
        expect(preset).toBeDefined();

        // Light mode contrast
        const lightTextBg = getContrastRatio(preset.light.text, preset.light.bg);
        const lightMutedBg = getContrastRatio(preset.light.muted, preset.light.bg);
        const lightAccentContrast = getContrastRatio(preset.light['accent-contrast'], preset.light.accent);

        expect(lightTextBg).toBeGreaterThanOrEqual(4.5);
        expect(lightMutedBg).toBeGreaterThanOrEqual(4.5);
        expect(lightAccentContrast).toBeGreaterThanOrEqual(4.5);

        // Dark mode contrast
        const darkTextBg = getContrastRatio(preset.dark.text, preset.dark.bg);
        const darkMutedBg = getContrastRatio(preset.dark.muted, preset.dark.bg);
        const darkAccentContrast = getContrastRatio(preset.dark['accent-contrast'], preset.dark.accent);

        expect(darkTextBg).toBeGreaterThanOrEqual(4.5);
        expect(darkMutedBg).toBeGreaterThanOrEqual(4.5);
        expect(darkAccentContrast).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe('System Mode & Live matchMedia Updates', () => {
    it('listens to matchMedia changes live and dispatches theme-changed event for page and charts', () => {
      let mediaQueryCallback: ((e: any) => void) | null = null;

      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event, cb) => {
          if (event === 'change') mediaQueryCallback = cb;
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const themeChangedEvents: any[] = [];
      const listener = (e: any) => themeChangedEvents.push(e.detail);
      window.addEventListener('theme-changed', listener);

      render(
        <ThemeProvider initialTheme="system">
          <div data-testid="system-test-child">App</div>
        </ThemeProvider>
      );

      expect(document.documentElement.getAttribute('data-theme')).toBe('system');
      expect(document.documentElement.style.colorScheme).toBe('light');

      // Trigger OS dark mode change live
      act(() => {
        if (mediaQueryCallback) {
          mediaQueryCallback({ matches: true } as MediaQueryListEvent);
        }
      });

      expect(document.documentElement.style.colorScheme).toBe('dark');
      expect(themeChangedEvents.length).toBeGreaterThan(0);
      const lastEvent = themeChangedEvents[themeChangedEvents.length - 1];
      expect(lastEvent.resolvedTheme).toBe('dark');

      window.removeEventListener('theme-changed', listener);
    });
  });

  describe('Theme Mode Switch & Persistence', () => {
    it('renders ThemeModeSwitch with System, Light, and Dark options', () => {
      render(
        <ThemeProvider>
          <ThemeModeSwitch />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme-mode-switch')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-system')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    });

    it('switches to dark mode, persists to localStorage, and updates document attributes', async () => {
      render(
        <ThemeProvider>
          <ThemeModeSwitch />
        </ThemeProvider>
      );

      const darkBtn = screen.getByTestId('theme-option-dark');
      act(() => {
        fireEvent.click(darkBtn);
      });

      expect(localStorage.getItem('theme_preference')).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('switches to light mode, persists to localStorage, and updates document attributes', async () => {
      render(
        <ThemeProvider>
          <ThemeModeSwitch />
        </ThemeProvider>
      );

      const lightBtn = screen.getByTestId('theme-option-light');
      act(() => {
        fireEvent.click(lightBtn);
      });

      expect(localStorage.getItem('theme_preference')).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });

    it('initializes from localStorage cache if present', () => {
      localStorage.setItem('theme_preference', 'dark');

      const Consumer = () => {
        const { theme } = useTheme();
        return <div data-testid="current-theme">{theme}</div>;
      };

      render(
        <ThemeProvider>
          <Consumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('Studio Theme Editor UI (/studio/theme)', () => {
    const mockAuthContext = {
      user: {
        id: 'u_1',
        email: 'builder@example.com',
        role: 'builder' as const,
        tenantId: 't_1',
        tenantName: 'Acme Corp',
      },
      loading: false,
      login: vi.fn(),
      signup: vi.fn(),
      acceptInvite: vi.fn(),
      logout: vi.fn(),
      refetchUser: vi.fn(),
    };

    it('renders preset gallery and allows selecting a preset', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <ThemeProvider
            initialTheme="light"
            initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}
          >
            <ThemeStudio />
          </ThemeProvider>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Workspace Theme')).toBeInTheDocument();
      expect(screen.getByText('Neutral')).toBeInTheDocument();
      expect(screen.getByText('Slate')).toBeInTheDocument();
      expect(screen.getByText('Ocean')).toBeInTheDocument();
      expect(screen.getByText('Warm')).toBeInTheDocument();

      // Click Ocean preset
      const oceanBtn = screen.getByText('Ocean').closest('button');
      expect(oceanBtn).toBeDefined();
      act(() => {
        fireEvent.click(oceanBtn!);
      });

      // Style tag in head should now reflect ocean
      const styleTag = document.getElementById('workspace-theme-overrides');
      expect(styleTag).toBeDefined();
      expect(styleTag?.textContent).toContain('Preset: Ocean (ocean)');
    });

    it('reports a theme save in the status bar, not in a banner above the settings', async () => {
      const spy = vi.spyOn(apiClient, 'updateWorkspaceTheme').mockResolvedValue({ success: true } as any);
      const ownerAuth = { ...mockAuthContext, user: { ...mockAuthContext.user, role: 'owner' as const } };
      render(
        <AuthContext.Provider value={ownerAuth}>
          <ThemeProvider initialTheme="light" initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}>
            <AppBarProvider>
              <ThemeStudio />
            </AppBarProvider>
          </ThemeProvider>
        </AuthContext.Provider>
      );

      await act(async () => { fireEvent.click(screen.getByText('Save Theme').closest('button')!); });
      expect(spy).toHaveBeenCalled();
      const status = screen.getByTestId('app-status-notification');
      expect(status).toHaveTextContent(/Workspace theme saved/);
      // Only one place shows it: no banner inside the page
      expect(screen.getAllByText(/Workspace theme saved/)).toHaveLength(1);

      spy.mockRejectedValueOnce(new Error('Theme locked by another editor'));
      await act(async () => { fireEvent.click(screen.getByText(/Save Theme|Saved!/).closest('button')!); });
      expect(screen.getByTestId('app-status-notification')).toHaveTextContent('Theme locked by another editor');
      spy.mockRestore();
    });

    it('groups settings in keyboard-accessible tabs and flags a tab whose value blocks saving', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <ThemeProvider initialTheme="light" initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}>
            <ThemeStudio />
          </ThemeProvider>
        </AuthContext.Provider>
      );

      const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
      expect(tabs).toEqual(['Colors', 'Shape', 'Spacing & Text', 'Layout']);
      const colors = screen.getByRole('tab', { name: 'Colors' });
      expect(colors).toHaveAttribute('aria-selected', 'true');
      // Live preview is visible alongside the settings
      expect(screen.getByText('Ocean')).toBeVisible();

      // Arrow keys move between tabs and show the matching panel only
      act(() => { fireEvent.keyDown(colors, { key: 'ArrowRight' }); });
      expect(screen.getByRole('tab', { name: 'Shape' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Shape' })).toBeVisible();
      expect(screen.queryByRole('tabpanel', { name: 'Colors' })).toBeNull();
      act(() => { fireEvent.keyDown(screen.getByRole('tab', { name: 'Shape' }), { key: 'End' }); });
      expect(screen.getByRole('tab', { name: 'Layout' })).toHaveAttribute('aria-selected', 'true');

      // An invalid text size keeps its value when the tab is left, and the tab is flagged
      act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Spacing & Text' })); });
      const textSize = screen.getByLabelText('Text Size');
      act(() => { fireEvent.change(textSize, { target: { value: '30' } }); });
      act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Colors' })); });
      expect(screen.getByRole('tab', { name: /Spacing & Text/ })).toContainElement(screen.getByLabelText('has an error'));
      act(() => { fireEvent.click(screen.getByRole('tab', { name: /Spacing & Text/ })); });
      expect(screen.getByLabelText('Text Size')).toHaveValue(30);
    });

    it('live preview shows only the components related to the selected tab', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <ThemeProvider initialTheme="light" initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}>
            <ThemeStudio />
          </ThemeProvider>
        </AuthContext.Provider>
      );
      const openTab = (name: string) => act(() => { fireEvent.click(screen.getByRole('tab', { name })); });

      // Colors: buttons/badges/data; no layout diagram or type scale
      expect(screen.getByText('Primary Accent')).toBeInTheDocument();
      expect(screen.queryByTestId('layout-preview')).toBeNull();
      expect(screen.queryByTestId('preview-type-scale')).toBeNull();

      openTab('Shape');
      expect(screen.getByTestId('preview-modal-box')).toBeInTheDocument();
      expect(screen.queryByText('Accent')).toBeNull(); // badges belong to Colors

      openTab('Spacing & Text');
      expect(screen.getByTestId('preview-type-scale')).toBeInTheDocument();
      expect(screen.getByTestId('preview-control-row')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-modal-box')).toBeNull();

      openTab('Layout');
      const diagram = screen.getByTestId('layout-preview');
      expect(diagram).toHaveAttribute('aria-label', expect.stringContaining('240px sidebar, content up to 1280px centered, 24px padding'));
      expect(screen.queryByTestId('preview-card-box')).toBeNull();
      // Screen width switch rescales the diagram
      act(() => { fireEvent.click(screen.getByRole('radio', { name: '2560px screen' })); });
      expect(screen.getByTestId('layout-preview')).toHaveAttribute('viewBox', '0 0 2560 1440');
    });

    it('warns when custom accent contrast is below 4.5:1 and allows reset', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <ThemeProvider
            initialTheme="light"
            initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}
          >
            <ThemeStudio />
          </ThemeProvider>
        </AuthContext.Provider>
      );

      const hexInput = screen.getByPlaceholderText(THEME_PRESETS.neutral.light.accent);
      expect(hexInput).toBeInTheDocument();

      // Enter a low-contrast yellow accent
      act(() => {
        fireEvent.change(hexInput, { target: { value: '#facc15' } });
      });

      // Low contrast warning should be displayed
      expect(screen.getByText(/Low Contrast Warning:/i)).toBeInTheDocument();

      // Click Reset Overrides
      const resetBtn = screen.getByText('Reset Overrides');
      act(() => {
        fireEvent.click(resetBtn);
      });

      // Low contrast warning should disappear
      expect(screen.queryByText(/Low Contrast Warning:/i)).toBeNull();
    });

    it('displays policy lock banner and disables editing when THEME_EDITING=locked', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <ThemeProvider
            initialTheme="light"
            initialThemeEditing="locked"
            initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}
          >
            <ThemeStudio />
          </ThemeProvider>
        </AuthContext.Provider>
      );

      expect(screen.getByText(/Theme Editing Locked/i)).toBeInTheDocument();
      expect(screen.getByText(/THEME_EDITING=locked/i)).toBeInTheDocument();

      // Save button should be disabled
      const saveBtn = screen.getByText('Save Theme').closest('button');
      expect(saveBtn).toBeDisabled();
    });
  });

  describe('Theme Linter Validation', () => {
    it('passes theme linter with zero violations across all component styles', async () => {
      const { execSync } = await import('child_process');
      const path = await import('path');
      const rootDir = path.resolve(__dirname, '../../..');
      const output = execSync('node scripts/lint-theme.cjs', { cwd: rootDir, encoding: 'utf8' });
      expect(output).toContain('Theme Lint PASSED');
    });
  });
});
