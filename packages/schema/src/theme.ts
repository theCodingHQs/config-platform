import { z } from 'zod';

/**
 * Semantic Color Tokens Schema
 */
export const SemanticColorsSchema = z.object({
  bg: z.string(),
  surface: z.string(),
  'surface-2': z.string(),
  'surface-hover': z.string().optional(),
  text: z.string(),
  muted: z.string(),
  border: z.string(),
  'border-subtle': z.string(),
  accent: z.string(),
  'accent-contrast': z.string(),
  'accent-subtle': z.string(),
  'accent-hover': z.string().optional(),
  danger: z.string(),
  'danger-contrast': z.string(),
  'danger-subtle': z.string(),
  'danger-hover': z.string().optional(),
  success: z.string(),
  'success-contrast': z.string(),
  'success-subtle': z.string(),
  'success-hover': z.string().optional(),
  warning: z.string(),
  'warning-contrast': z.string(),
  'warning-subtle': z.string(),
  'warning-hover': z.string().optional(),
  'overlay-bg': z.string().optional(),
});

export type SemanticColors = z.infer<typeof SemanticColorsSchema>;

/**
 * Theme Presets Schema & Types
 */
export const ThemePresetIdSchema = z.enum(['neutral', 'slate', 'ocean', 'warm']);
export type ThemePresetId = z.infer<typeof ThemePresetIdSchema>;

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  light: SemanticColors;
  dark: SemanticColors;
}

/**
 * Fixed Editor Tokens (Overlay & Selection in Studio)
 * Invariant across themes to guarantee high visibility.
 */
export const EditorTokensSchema = z.object({
  'editor-overlay-selected': z.string(),
  'editor-overlay-selected-bg': z.string(),
  'editor-overlay-hover': z.string(),
  'editor-overlay-hover-bg': z.string(),
  'editor-overlay-badge-text': z.string(),
});

export type EditorTokens = z.infer<typeof EditorTokensSchema>;

/**
 * Shared Non-Color Scales
 */
export const RadiusScaleSchema = z.object({
  none: z.string(),
  xs: z.string(),
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
  xl: z.string(),
  full: z.string(),
});

export const BorderWidthScaleSchema = z.object({
  none: z.string(),
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
});

export const FontSizeScaleSchema = z.object({
  xs: z.string(),
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
  xl: z.string(),
  '2xl': z.string(),
  '3xl': z.string(),
});

export const FontStackSchema = z.object({
  sans: z.string(),
  mono: z.string(),
});

export const ShadowScaleSchema = z.object({
  none: z.string(),
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
  xl: z.string().optional(),
});

export const ControlHeightScaleSchema = z.object({
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
});

export const SpacingScaleSchema = z.object({
  '0': z.string(),
  '1': z.string(),
  '2': z.string(),
  '3': z.string(),
  '4': z.string(),
  '5': z.string(),
  '6': z.string(),
  '8': z.string(),
  '10': z.string(),
  '12': z.string(),
  '16': z.string(),
});

export const SharedTokensSchema = z.object({
  radius: RadiusScaleSchema,
  borderWidth: BorderWidthScaleSchema,
  fontSize: FontSizeScaleSchema,
  fontStack: FontStackSchema,
  shadow: ShadowScaleSchema,
  controlHeight: ControlHeightScaleSchema,
  spacing: SpacingScaleSchema,
  editor: EditorTokensSchema,
});

export type SharedTokens = z.infer<typeof SharedTokensSchema>;

/**
 * Theme Preference Schema (User level: system | light | dark)
 */
export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

/**
 * Workspace Overrides Schema (Tenant level: accent, radius, density)
 */
export const ThemeRadiusOverrideSchema = z.enum(['none', 'sm', 'md', 'lg', 'xl', 'full']);
export type ThemeRadiusOverride = z.infer<typeof ThemeRadiusOverrideSchema>;

export const ThemeDensityOverrideSchema = z.enum(['dense', 'compact', 'normal', 'comfortable']);
export type ThemeDensityOverride = z.infer<typeof ThemeDensityOverrideSchema>;

/** Body text size in px; every other font-size token is derived from it. */
export const TEXT_SIZE_MIN = 12;
export const TEXT_SIZE_MAX = 18;
export const TEXT_SIZE_DEFAULT = 14;

export const ThemeTextSizeOverrideSchema = z
  .number()
  .min(TEXT_SIZE_MIN, `Text size must be at least ${TEXT_SIZE_MIN}px`)
  .max(TEXT_SIZE_MAX, `Text size must be at most ${TEXT_SIZE_MAX}px`)
  .multipleOf(0.5, 'Text size must be in 0.5px steps');

export const TEXT_SIZE_PRESETS: ReadonlyArray<{ id: string; label: string; value: number }> = [
  { id: 'small', label: 'Small', value: 13 },
  { id: 'default', label: 'Default', value: TEXT_SIZE_DEFAULT },
  { id: 'large', label: 'Large', value: 15 },
  { id: 'x-large', label: 'Extra Large', value: 16 },
];

/**
 * Layout Overrides (Tenant level)
 * Shared by every standard screen (studio managers and runtime pages). Full-bleed
 * workspaces such as the Page Builder and Grid Designer ignore the content width.
 */
export const LAYOUT_CONTENT_WIDTH_MIN = 640;
export const LAYOUT_CONTENT_WIDTH_MAX = 2560;
export const LAYOUT_PAGE_PADDING_MAX = 64;
export const LAYOUT_SIDEBAR_WIDTH_MIN = 180;
export const LAYOUT_SIDEBAR_WIDTH_MAX = 360;

export const ThemeContentWidthSchema = z.union([
  z.literal('full'),
  z.number()
    .int('Content width must be a whole number of pixels')
    .min(LAYOUT_CONTENT_WIDTH_MIN, `Content width must be at least ${LAYOUT_CONTENT_WIDTH_MIN}px`)
    .max(LAYOUT_CONTENT_WIDTH_MAX, `Content width must be at most ${LAYOUT_CONTENT_WIDTH_MAX}px`),
]);
export type ThemeContentWidth = z.infer<typeof ThemeContentWidthSchema>;

export const ThemeContentAlignSchema = z.enum(['center', 'start']);
export type ThemeContentAlign = z.infer<typeof ThemeContentAlignSchema>;

export const ThemeLayoutOverrideSchema = z.object({
  /** Max width of the main content area in px, or 'full' to use the whole viewport. */
  contentWidth: ThemeContentWidthSchema.optional(),
  /** Where a width-limited content area sits on wide screens. */
  contentAlign: ThemeContentAlignSchema.optional(),
  /** Horizontal page padding in px; vertical padding is derived. Defaults per density. */
  pagePadding: z.number().int().min(0).max(LAYOUT_PAGE_PADDING_MAX, `Page padding must be at most ${LAYOUT_PAGE_PADDING_MAX}px`).optional(),
  /** Expanded width of the runtime navigation sidebar in px. */
  sidebarWidth: z.number().int()
    .min(LAYOUT_SIDEBAR_WIDTH_MIN, `Sidebar width must be at least ${LAYOUT_SIDEBAR_WIDTH_MIN}px`)
    .max(LAYOUT_SIDEBAR_WIDTH_MAX, `Sidebar width must be at most ${LAYOUT_SIDEBAR_WIDTH_MAX}px`)
    .optional(),
}).strict();
export type ThemeLayoutOverride = z.infer<typeof ThemeLayoutOverrideSchema>;

export const ThemeOverridesSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Accent must be a 6-digit hex color (#rrggbb)').optional(),
  radius: ThemeRadiusOverrideSchema.optional(),
  density: ThemeDensityOverrideSchema.optional(),
  textSize: ThemeTextSizeOverrideSchema.optional(),
  layout: ThemeLayoutOverrideSchema.optional(),
}).strict();
export type ThemeOverrides = z.infer<typeof ThemeOverridesSchema>;

export const WorkspaceThemeConfigSchema = z.object({
  presetId: ThemePresetIdSchema.default('neutral'),
  overrides: ThemeOverridesSchema.default({}),
}).strict();
export type WorkspaceThemeConfig = z.infer<typeof WorkspaceThemeConfigSchema>;

/**
 * Density Scale Options & Calculations
 */
export type DensityMultiplier = 'dense' | 'compact' | 'normal' | 'comfortable';

export const DENSITY_FACTORS: Record<DensityMultiplier, number> = {
  dense: 0.6,
  compact: 0.8,
  normal: 1.0,
  comfortable: 1.25,
};

export function getDensitySpacing(multiplier: DensityMultiplier = 'normal'): Record<string, string> {
  const factor = DENSITY_FACTORS[multiplier];
  const baseRem: Record<string, number> = {
    '0': 0,
    '1': 0.25,
    '2': 0.5,
    '3': 0.75,
    '4': 1.0,
    '5': 1.25,
    '6': 1.5,
    '8': 2.0,
    '10': 2.5,
    '12': 3.0,
    '16': 4.0,
  };
  const result: Record<string, string> = {};
  for (const [key, rem] of Object.entries(baseRem)) {
    if (rem === 0) {
      result[key] = '0px';
    } else {
      result[key] = `${(rem * factor).toFixed(3).replace(/\.?0+$/, '')}rem`;
    }
  }
  return result;
}

/**
 * Control heights per density. Only 'dense' shrinks controls; spacing alone can't,
 * because inputs and buttons size themselves from these tokens.
 */
const DENSE_CONTROL_HEIGHTS = { sm: '24px', md: '28px', lg: '36px' };

export function getDensityControlHeights(multiplier: DensityMultiplier = 'normal'): Record<'sm' | 'md' | 'lg', string> {
  return multiplier === 'dense' ? DENSE_CONTROL_HEIGHTS : defaultSharedTokens.controlHeight;
}

/**
 * Recommended body text size per density. Applied automatically when the workspace
 * has no explicit textSize override, so changing density also retunes the text.
 */
export const DENSITY_DEFAULT_TEXT_SIZE: Record<DensityMultiplier, number> = {
  dense: 13,
  compact: 13.5,
  normal: TEXT_SIZE_DEFAULT,
  comfortable: 15,
};

export function getDensityDefaultTextSize(density: DensityMultiplier = 'normal'): number {
  return DENSITY_DEFAULT_TEXT_SIZE[density];
}

/** Effective body text size: an explicit override wins, otherwise the density's default. */
export function resolveTextSize(density?: DensityMultiplier, textSize?: number): number {
  return textSize ?? getDensityDefaultTextSize(density);
}

/**
 * Layout Defaults & Resolution
 */
export const CONTENT_WIDTH_PRESETS: ReadonlyArray<{ id: string; label: string; value: ThemeContentWidth }> = [
  { id: 'narrow', label: 'Narrow', value: 960 },
  { id: 'default', label: 'Default', value: 1280 },
  { id: 'wide', label: 'Wide', value: 1440 },
  { id: 'x-wide', label: 'Extra Wide', value: 1680 },
  { id: 'full', label: 'Full Width', value: 'full' },
];

/** Page padding follows density unless set explicitly, like text size. */
export const DENSITY_DEFAULT_PAGE_PADDING: Record<DensityMultiplier, number> = {
  dense: 16,
  compact: 20,
  normal: 24,
  comfortable: 32,
};

export const LAYOUT_DEFAULTS = {
  contentWidth: 1280 as ThemeContentWidth,
  contentAlign: 'center' as ThemeContentAlign,
  sidebarWidth: 240,
};

export interface ResolvedLayout {
  contentWidth: ThemeContentWidth;
  contentAlign: ThemeContentAlign;
  pagePadding: number;
  sidebarWidth: number;
}

/** Fills every layout setting: explicit override, else density default, else global default. */
export function resolveLayout(layout?: ThemeLayoutOverride, density?: DensityMultiplier): ResolvedLayout {
  return {
    contentWidth: layout?.contentWidth ?? LAYOUT_DEFAULTS.contentWidth,
    contentAlign: layout?.contentAlign ?? LAYOUT_DEFAULTS.contentAlign,
    pagePadding: layout?.pagePadding ?? DENSITY_DEFAULT_PAGE_PADDING[density ?? 'normal'],
    sidebarWidth: layout?.sidebarWidth ?? LAYOUT_DEFAULTS.sidebarWidth,
  };
}

/**
 * Text Size Scale
 * The default scale (px) at a 14px body size; other body sizes scale it proportionally.
 */
const BASE_FONT_SCALE_PX = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 } as const;
type FontSizeKey = keyof typeof BASE_FONT_SCALE_PX;
const MIN_LEGIBLE_FONT_PX = 11;

const pxToRem = (px: number) => `${(px / 16).toFixed(4).replace(/\.?0+$/, '')}rem`;

/** Font sizes in px for a given body size, rounded to 0.5px. */
export function getTextSizeScalePx(textSize: number = TEXT_SIZE_DEFAULT): Record<FontSizeKey, number> {
  const factor = textSize / TEXT_SIZE_DEFAULT;
  const result = {} as Record<FontSizeKey, number>;
  for (const [key, px] of Object.entries(BASE_FONT_SCALE_PX) as Array<[FontSizeKey, number]>) {
    result[key] = Math.max(MIN_LEGIBLE_FONT_PX, Math.round(px * factor * 2) / 2);
  }
  return result;
}

/** Font-size tokens (rem, so browser zoom and user font settings still apply). */
export function getTextSizeScale(textSize: number = TEXT_SIZE_DEFAULT): Record<FontSizeKey, string> {
  const px = getTextSizeScalePx(textSize);
  const result = {} as Record<FontSizeKey, string>;
  for (const key of Object.keys(px) as FontSizeKey[]) result[key] = pxToRem(px[key]);
  return result;
}

/**
 * Control heights are the density height, raised when needed so the text a control
 * carries (sm → xs text, md → sm text, lg → md text) keeps a minimum vertical padding.
 * Any density/text-size combination therefore stays usable.
 */
export function resolveControlHeights(
  density: DensityMultiplier = 'normal',
  textSize: number = TEXT_SIZE_DEFAULT,
): Record<'sm' | 'md' | 'lg', string> {
  const heights = getDensityControlHeights(density);
  const font = getTextSizeScalePx(textSize);
  const LINE_HEIGHT = 1.25;
  const BORDERS = 2;
  const needed = {
    sm: Math.ceil(font.xs * LINE_HEIGHT + 2 * 3 + BORDERS),
    md: Math.ceil(font.sm * LINE_HEIGHT + 2 * 4 + BORDERS),
    lg: Math.ceil(font.md * LINE_HEIGHT + 2 * 5 + BORDERS),
  };
  const result = {} as Record<'sm' | 'md' | 'lg', string>;
  for (const key of ['sm', 'md', 'lg'] as const) {
    result[key] = `${Math.max(Number.parseFloat(heights[key]), needed[key])}px`;
  }
  return result;
}

/**
 * 4 Immutable Theme Presets (Neutral, Slate, Ocean, Warm)
 * All pass WCAG AA >= 4.5:1 contrast in both light and dark modes.
 */
export const neutralLightPalette: SemanticColors = {
  bg: '#fafafa',
  surface: '#ffffff',
  'surface-2': '#f4f4f5',
  'surface-hover': '#f4f4f5',
  text: '#18181b',
  muted: '#52525b', // 7.4:1 contrast on #fafafa
  border: '#e4e4e7',
  'border-subtle': '#f4f4f5',
  accent: '#2563eb',
  'accent-contrast': '#ffffff', // 5.2:1 contrast on #2563eb
  'accent-subtle': '#eff6ff',
  'accent-hover': '#1d4ed8',
  danger: '#b91c1c',
  'danger-contrast': '#ffffff',
  'danger-subtle': '#fef2f2',
  'danger-hover': '#991b1b',
  success: '#15803d',
  'success-contrast': '#ffffff',
  'success-subtle': '#f0fdf4',
  'success-hover': '#166534',
  warning: '#b45309',
  'warning-contrast': '#ffffff',
  'warning-subtle': '#fffbeb',
  'warning-hover': '#92400e',
  'overlay-bg': 'rgba(0, 0, 0, 0.5)',
};

export const neutralDarkPalette: SemanticColors = {
  bg: '#09090b',
  surface: '#18181b',
  'surface-2': '#27272a',
  'surface-hover': '#27272a',
  text: '#f4f4f5',
  muted: '#a1a1aa', // 7.8:1 contrast on #09090b
  border: '#27272a',
  'border-subtle': '#1f1f23',
  accent: '#3b82f6',
  'accent-contrast': '#09090b', // 5.4:1 contrast on #3b82f6
  'accent-subtle': '#1e293b',
  'accent-hover': '#60a5fa',
  danger: '#f87171',
  'danger-contrast': '#09090b',
  'danger-subtle': '#450a0a',
  'danger-hover': '#fca5a5',
  success: '#22c55e',
  'success-contrast': '#09090b',
  'success-subtle': '#052e16',
  'success-hover': '#4ade80',
  warning: '#f59e0b',
  'warning-contrast': '#09090b',
  'warning-subtle': '#451a03',
  'warning-hover': '#fbbf24',
  'overlay-bg': 'rgba(0, 0, 0, 0.7)',
};

export const slateLightPalette: SemanticColors = {
  bg: '#f8fafc',
  surface: '#ffffff',
  'surface-2': '#f1f5f9',
  'surface-hover': '#e2e8f0',
  text: '#0f172a',
  muted: '#475569', // 7.2:1 contrast on #f8fafc
  border: '#cbd5e1',
  'border-subtle': '#f1f5f9',
  accent: '#334155',
  'accent-contrast': '#ffffff', // 10.4:1 contrast on #334155
  'accent-subtle': '#f1f5f9',
  'accent-hover': '#1e293b',
  danger: '#b91c1c',
  'danger-contrast': '#ffffff',
  'danger-subtle': '#fef2f2',
  'danger-hover': '#991b1b',
  success: '#15803d',
  'success-contrast': '#ffffff',
  'success-subtle': '#f0fdf4',
  'success-hover': '#166534',
  warning: '#b45309',
  'warning-contrast': '#ffffff',
  'warning-subtle': '#fffbeb',
  'warning-hover': '#92400e',
  'overlay-bg': 'rgba(15, 23, 42, 0.5)',
};

export const slateDarkPalette: SemanticColors = {
  bg: '#020617',
  surface: '#0f172a',
  'surface-2': '#1e293b',
  'surface-hover': '#334155',
  text: '#f8fafc',
  muted: '#94a3b8', // 7.9:1 contrast on #020617
  border: '#1e293b',
  'border-subtle': '#0f172a',
  accent: '#94a3b8',
  'accent-contrast': '#020617', // 7.9:1 contrast on #94a3b8
  'accent-subtle': '#1e293b',
  'accent-hover': '#cbd5e1',
  danger: '#f87171',
  'danger-contrast': '#020617',
  'danger-subtle': '#450a0a',
  'danger-hover': '#fca5a5',
  success: '#22c55e',
  'success-contrast': '#020617',
  'success-subtle': '#052e16',
  'success-hover': '#4ade80',
  warning: '#f59e0b',
  'warning-contrast': '#020617',
  'warning-subtle': '#451a03',
  'warning-hover': '#fbbf24',
  'overlay-bg': 'rgba(2, 6, 23, 0.7)',
};

export const oceanLightPalette: SemanticColors = {
  bg: '#f0fdfa',
  surface: '#ffffff',
  'surface-2': '#e0f2fe',
  'surface-hover': '#bae6fd',
  text: '#082f49',
  muted: '#0369a1', // 5.7:1 contrast on #f0fdfa
  border: '#bae6fd',
  'border-subtle': '#e0f2fe',
  accent: '#0369a1',
  'accent-contrast': '#ffffff', // 5.9:1 contrast on #0369a1
  'accent-subtle': '#e0f2fe',
  'accent-hover': '#075985',
  danger: '#b91c1c',
  'danger-contrast': '#ffffff',
  'danger-subtle': '#fef2f2',
  'danger-hover': '#991b1b',
  success: '#0f766e',
  'success-contrast': '#ffffff',
  'success-subtle': '#f0fdfa',
  'success-hover': '#115e59',
  warning: '#b45309',
  'warning-contrast': '#ffffff',
  'warning-subtle': '#fffbeb',
  'warning-hover': '#92400e',
  'overlay-bg': 'rgba(8, 47, 73, 0.5)',
};

export const oceanDarkPalette: SemanticColors = {
  bg: '#030712',
  surface: '#082f49',
  'surface-2': '#0c4a6e',
  'surface-hover': '#075985',
  text: '#f0f9ff',
  muted: '#7dd3fc', // 12.1:1 contrast on #030712
  border: '#0c4a6e',
  'border-subtle': '#082f49',
  accent: '#38bdf8',
  'accent-contrast': '#030712', // 9.4:1 contrast on #38bdf8
  'accent-subtle': '#082f49',
  'accent-hover': '#7dd3fc',
  danger: '#f87171',
  'danger-contrast': '#030712',
  'danger-subtle': '#450a0a',
  'danger-hover': '#fca5a5',
  success: '#2dd4bf',
  'success-contrast': '#030712',
  'success-subtle': '#134e4a',
  'success-hover': '#5eead4',
  warning: '#f59e0b',
  'warning-contrast': '#030712',
  'warning-subtle': '#451a03',
  'warning-hover': '#fbbf24',
  'overlay-bg': 'rgba(3, 7, 18, 0.7)',
};

export const warmLightPalette: SemanticColors = {
  bg: '#fafaf9',
  surface: '#ffffff',
  'surface-2': '#f5f5f4',
  'surface-hover': '#e7e5e4',
  text: '#1c1917',
  muted: '#57534e', // 7.3:1 contrast on #fafaf9
  border: '#e7e5e4',
  'border-subtle': '#f5f5f4',
  accent: '#b45309',
  'accent-contrast': '#ffffff', // 5.0:1 contrast on #b45309
  'accent-subtle': '#fef3c7',
  'accent-hover': '#92400e',
  danger: '#b91c1c',
  'danger-contrast': '#ffffff',
  'danger-subtle': '#fef2f2',
  'danger-hover': '#991b1b',
  success: '#15803d',
  'success-contrast': '#ffffff',
  'success-subtle': '#f0fdf4',
  'success-hover': '#166534',
  warning: '#b45309',
  'warning-contrast': '#ffffff',
  'warning-subtle': '#fffbeb',
  'warning-hover': '#92400e',
  'overlay-bg': 'rgba(28, 25, 23, 0.5)',
};

export const warmDarkPalette: SemanticColors = {
  bg: '#0c0a09',
  surface: '#1c1917',
  'surface-2': '#292524',
  'surface-hover': '#44403c',
  text: '#fafaf9',
  muted: '#a8a29e', // 7.8:1 contrast on #0c0a09
  border: '#292524',
  'border-subtle': '#1c1917',
  accent: '#f59e0b',
  'accent-contrast': '#0c0a09', // 9.2:1 contrast on #f59e0b
  'accent-subtle': '#451a03',
  'accent-hover': '#fbbf24',
  danger: '#f87171',
  'danger-contrast': '#0c0a09',
  'danger-subtle': '#450a0a',
  'danger-hover': '#fca5a5',
  success: '#22c55e',
  'success-contrast': '#0c0a09',
  'success-subtle': '#052e16',
  'success-hover': '#4ade80',
  warning: '#f59e0b',
  'warning-contrast': '#0c0a09',
  'warning-subtle': '#451a03',
  'warning-hover': '#fbbf24',
  'overlay-bg': 'rgba(12, 10, 9, 0.7)',
};

export const themePresets: Record<ThemePresetId, ThemePreset> = {
  neutral: {
    id: 'neutral',
    name: 'Neutral',
    description: 'Clean balanced slate gray with royal blue accents',
    light: neutralLightPalette,
    dark: neutralDarkPalette,
  },
  slate: {
    id: 'slate',
    name: 'Slate',
    description: 'Cool slate monochrome with graphite contrast',
    light: slateLightPalette,
    dark: slateDarkPalette,
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep marine blues with vibrant sky accents',
    light: oceanLightPalette,
    dark: oceanDarkPalette,
  },
  warm: {
    id: 'warm',
    name: 'Warm',
    description: 'Earthy amber, terracotta, and warm stone',
    light: warmLightPalette,
    dark: warmDarkPalette,
  },
};

export const THEME_PRESETS = themePresets;

export const defaultSharedTokens: SharedTokens = {
  radius: {
    none: '0px',
    xs: '2px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    full: '9999px',
  },
  borderWidth: {
    none: '0px',
    sm: '1px',
    md: '2px',
    lg: '4px',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
  },
  fontStack: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  shadow: {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.15)',
  },
  controlHeight: {
    sm: '28px',
    md: '36px',
    lg: '44px',
  },
  spacing: {
    '0': '0px',
    '1': '0.25rem',
    '2': '0.5rem',
    '3': '0.75rem',
    '4': '1rem',
    '5': '1.25rem',
    '6': '1.5rem',
    '8': '2rem',
    '10': '2.5rem',
    '12': '3rem',
    '16': '4rem',
  },
  editor: {
    'editor-overlay-selected': '#2563eb',
    'editor-overlay-selected-bg': 'rgba(37, 99, 235, 0.12)',
    'editor-overlay-hover': '#9333ea',
    'editor-overlay-hover-bg': 'rgba(147, 51, 234, 0.08)',
    'editor-overlay-badge-text': '#ffffff',
  },
};

/**
 * Calculate WCAG 2.1 relative luminance of a hex color
 */
export function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Calculate WCAG 2.1 contrast ratio between two hex colors
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Derive accent shades and contrast from a custom hex color
 */
export function deriveAccentShades(accentHex: string) {
  const whiteRatio = getContrastRatio(accentHex, '#ffffff');
  const blackRatio = getContrastRatio(accentHex, '#09090b');
  const accentContrast = whiteRatio >= blackRatio ? '#ffffff' : '#09090b';

  const clean = accentHex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);

  const accentSubtleLight = `rgba(${r}, ${g}, ${b}, 0.12)`;
  const accentSubtleDark = `rgba(${r}, ${g}, ${b}, 0.22)`;

  const darken = (c: number) => Math.max(0, Math.floor(c * 0.85));
  const lighten = (c: number) => Math.min(255, Math.floor(c + (255 - c) * 0.2));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');

  const accentHoverLight = `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`;
  const accentHoverDark = `#${toHex(lighten(r))}${toHex(lighten(g))}${toHex(lighten(b))}`;

  return {
    accent: accentHex,
    accentContrast,
    accentSubtleLight,
    accentSubtleDark,
    accentHoverLight,
    accentHoverDark,
  };
}

/**
 * Validate accent color against WCAG AA 4.5:1 minimum contrast
 */
export function validateAccentContrast(accentHex: string, bgHex: string = '#ffffff'): {
  contrastRatio: number;
  contrastAgainst: string;
  isCompliant: boolean;
  warning?: string;
} {
  const ratio = getContrastRatio(accentHex, bgHex);
  const isCompliant = ratio >= 4.5;
  const contrastAgainst = bgHex === '#ffffff' ? 'white (#ffffff)' : bgHex;

  return {
    contrastRatio: parseFloat(ratio.toFixed(2)),
    contrastAgainst,
    isCompliant,
    warning: isCompliant
      ? undefined
      : `Contrast ratio with ${contrastAgainst} is ${ratio.toFixed(2)}:1, which is below the WCAG AA minimum of 4.5:1.`,
  };
}

/**
 * Generate tokens.css string from theme definitions (single source of truth)
 */
export interface SemanticRadiusTokens {
  base: string;
  control: string;
  surface: string;
  pill: string;
  button: string;
}

export function deriveSemanticRadius(override: ThemeRadiusOverride = 'md'): SemanticRadiusTokens {
  switch (override) {
    case 'none':
      return {
        base: '0px',
        control: '0px',
        surface: '0px',
        pill: '0px',
        button: '0px',
      };
    case 'sm':
      return {
        base: '4px',
        control: '4px',
        surface: '6px',
        pill: '9999px',
        button: '4px',
      };
    case 'md':
      return {
        base: '6px',
        control: '6px',
        surface: '10px',
        pill: '9999px',
        button: '6px',
      };
    case 'lg':
      return {
        base: '8px',
        control: '8px',
        surface: '14px',
        pill: '9999px',
        button: '8px',
      };
    case 'xl':
      return {
        base: '12px',
        control: '8px', // capped: control never exceeds 8px
        surface: '16px', // capped: surface never exceeds 16px
        pill: '9999px',
        button: '9999px',
      };
    case 'full':
      return {
        base: '16px', // capped: full does NOT turn modals, cards, tables into pills even if base is referenced
        control: '8px', // capped: full does NOT turn inputs into pills!
        surface: '16px', // capped: full does NOT turn modals, cards, tables into pills!
        pill: '9999px',
        button: '9999px', // buttons become pills on Full
      };
    default:
      return {
        base: '6px',
        control: '6px',
        surface: '10px',
        pill: '9999px',
        button: '6px',
      };
  }
}

export function generateTokensCss(options?: {
  presetId?: ThemePresetId;
  overrides?: ThemeOverrides;
}): string {
  // Validate theme configuration to ensure runtime style output is generated only from validated values
  const parsed = WorkspaceThemeConfigSchema.safeParse(options || {});
  const safeConfig = parsed.success ? parsed.data : { presetId: 'neutral' as const, overrides: {} };
  const presetId = safeConfig.presetId;
  const preset = themePresets[presetId] || themePresets.neutral;
  const overrides = safeConfig.overrides;

  const densitySpacing = overrides?.density
    ? getDensitySpacing(overrides.density)
    : defaultSharedTokens.spacing;
  const textSize = resolveTextSize(overrides?.density, overrides?.textSize);
  const layout = resolveLayout(overrides?.layout, overrides?.density);
  const isFullWidth = layout.contentWidth === 'full';
  const controlHeights = resolveControlHeights(overrides?.density, textSize);
  const fontSizes = textSize === TEXT_SIZE_DEFAULT
    ? defaultSharedTokens.fontSize
    : getTextSizeScale(textSize);

  const semanticRadius = deriveSemanticRadius(overrides?.radius);
  const radiusOverride = semanticRadius.base;

  let lightAccent = preset.light.accent;
  let lightAccentContrast = preset.light['accent-contrast'];
  let lightAccentSubtle = preset.light['accent-subtle'];
  let lightAccentHover = preset.light['accent-hover'];

  let darkAccent = preset.dark.accent;
  let darkAccentContrast = preset.dark['accent-contrast'];
  let darkAccentSubtle = preset.dark['accent-subtle'];
  let darkAccentHover = preset.dark['accent-hover'];

  if (overrides?.accent) {
    const shades = deriveAccentShades(overrides.accent);
    lightAccent = shades.accent;
    lightAccentContrast = shades.accentContrast;
    lightAccentSubtle = shades.accentSubtleLight;
    lightAccentHover = shades.accentHoverLight;

    darkAccent = shades.accent;
    darkAccentContrast = shades.accentContrast;
    darkAccentSubtle = shades.accentSubtleDark;
    darkAccentHover = shades.accentHoverDark;
  }

  return `/**
 * Design Tokens - Single Source of Truth
 * Generated from @config-platform/schema theme definitions
 * Preset: ${preset.name} (${preset.id})
 */

:root {
  /* Typography */
  --font-sans: ${defaultSharedTokens.fontStack.sans};
  --font-mono: ${defaultSharedTokens.fontStack.mono};

  --font-size-xs: ${fontSizes.xs};
  --font-size-sm: ${fontSizes.sm};
  --font-size-md: ${fontSizes.md};
  --font-size-base: ${fontSizes.md};
  --font-size-lg: ${fontSizes.lg};
  --font-size-xl: ${fontSizes.xl};
  --font-size-2xl: ${fontSizes['2xl']};
  --font-size-3xl: ${fontSizes['3xl']};

  /* Radius Scale */
  --radius-none: ${defaultSharedTokens.radius.none};
  --radius-xs: ${defaultSharedTokens.radius.xs};
  --radius-sm: ${defaultSharedTokens.radius.sm};
  --radius-md: ${defaultSharedTokens.radius.md};
  --radius-lg: ${defaultSharedTokens.radius.lg};
  --radius-xl: ${defaultSharedTokens.radius.xl};
  --radius-full: ${defaultSharedTokens.radius.full};
  --radius: ${radiusOverride};

  /* Semantic Radius Tokens */
  --radius-control: ${semanticRadius.control};
  --radius-surface: ${semanticRadius.surface};
  --radius-pill: ${semanticRadius.pill};
  --radius-button: ${semanticRadius.button};

  /* Border Widths */
  --border-width-none: ${defaultSharedTokens.borderWidth.none};
  --border-width-sm: ${defaultSharedTokens.borderWidth.sm};
  --border-width-md: ${defaultSharedTokens.borderWidth.md};
  --border-width-lg: ${defaultSharedTokens.borderWidth.lg};
  --border-width: var(--border-width-sm);

  /* Spacing Scale */
  --spacing-0: ${densitySpacing['0']};
  --spacing-1: ${densitySpacing['1']};
  --spacing-2: ${densitySpacing['2']};
  --spacing-3: ${densitySpacing['3']};
  --spacing-4: ${densitySpacing['4']};
  --spacing-5: ${densitySpacing['5']};
  --spacing-6: ${densitySpacing['6']};
  --spacing-8: ${densitySpacing['8']};
  --spacing-10: ${densitySpacing['10']};
  --spacing-12: ${densitySpacing['12']};
  --spacing-16: ${densitySpacing['16']};

  /* Spacing Scale Aliases (--space-*) */
  --space-0: var(--spacing-0);
  --space-1: var(--spacing-1);
  --space-2: var(--spacing-2);
  --space-3: var(--spacing-3);
  --space-4: var(--spacing-4);
  --space-5: var(--spacing-5);
  --space-6: var(--spacing-6);
  --space-8: var(--spacing-8);
  --space-10: var(--spacing-10);
  --space-12: var(--spacing-12);
  --space-16: var(--spacing-16);

  /* Control & Layout Heights */
  --control-height-sm: ${controlHeights.sm};
  --control-height-md: ${controlHeights.md};
  --control-height-lg: ${controlHeights.lg};
  --navbar-height: 50px;

  /* Layout (standard screens; full-bleed workspaces opt out) */
  --layout-content-max-width: ${isFullWidth ? 'none' : `${layout.contentWidth}px`};
  --layout-content-margin-inline: ${layout.contentAlign === 'center' ? 'auto' : '0'};
  --layout-page-padding: ${layout.pagePadding}px;
  --layout-sidebar-width: ${layout.sidebarWidth}px;

  /* Shadows */
  --shadow-none: ${defaultSharedTokens.shadow.none};
  --shadow-sm: ${defaultSharedTokens.shadow.sm};
  --shadow-md: ${defaultSharedTokens.shadow.md};
  --shadow-lg: ${defaultSharedTokens.shadow.lg};
  --shadow-xl: ${defaultSharedTokens.shadow.xl};

  /* Overlays */
  --overlay-bg: rgba(0, 0, 0, 0.5);

  /* Fixed Studio Overlay Tokens - invariant across themes for visibility */
  --editor-overlay-selected: ${defaultSharedTokens.editor['editor-overlay-selected']};
  --editor-overlay-selected-bg: ${defaultSharedTokens.editor['editor-overlay-selected-bg']};
  --editor-overlay-hover: ${defaultSharedTokens.editor['editor-overlay-hover']};
  --editor-overlay-hover-bg: ${defaultSharedTokens.editor['editor-overlay-hover-bg']};
  --editor-overlay-badge-text: ${defaultSharedTokens.editor['editor-overlay-badge-text']};
}

/* =========================================================================
   Light Theme (Default and [data-theme="light"])
   ========================================================================= */
:root,
[data-theme="light"] {
  color-scheme: light;

  /* Surfaces & Background */
  --bg: ${preset.light.bg};
  --surface: ${preset.light.surface};
  --surface-2: ${preset.light['surface-2']};
  --surface-hover: ${preset.light['surface-hover']};
  --border: ${preset.light.border};
  --border-subtle: ${preset.light['border-subtle']};

  /* Typography */
  --text: ${preset.light.text};
  --text-muted: ${preset.light.muted};

  /* Accent */
  --accent: ${lightAccent};
  --accent-contrast: ${lightAccentContrast};
  --accent-subtle: ${lightAccentSubtle};
  --accent-hover: ${lightAccentHover};

  /* Status Colors */
  --danger: ${preset.light.danger};
  --danger-contrast: ${preset.light['danger-contrast']};
  --danger-subtle: ${preset.light['danger-subtle']};
  --danger-hover: ${preset.light['danger-hover']};

  --success: ${preset.light.success};
  --success-contrast: ${preset.light['success-contrast']};
  --success-subtle: ${preset.light['success-subtle']};
  --success-hover: ${preset.light['success-hover']};

  --warning: ${preset.light.warning};
  --warning-contrast: ${preset.light['warning-contrast']};
  --warning-subtle: ${preset.light['warning-subtle']};
  --warning-hover: ${preset.light['warning-hover']};

  /* Overlays */
  --overlay-bg: ${preset.light['overlay-bg']};

  /* Compatibility & Semantic Aliases */
  --muted: var(--text-muted);
  --muted-bg: var(--surface-2);
  --bg-surface: var(--surface);
  --bg-surface-secondary: var(--surface-2);
  --bg-muted: var(--surface-2);
  --surface-subtle: var(--surface-2);
  --border-color: var(--border);
  --text-primary: var(--text);
  --text-inverse: var(--accent-contrast);
  --primary: var(--accent);
  --primary-hover: var(--accent-hover);
  --primary-subtle: var(--accent-subtle);
  --danger-bg: var(--danger-subtle);
  --danger-border: var(--danger);
  --warning-bg: var(--warning-subtle);
  --warning-border: var(--warning);
  --success-bg: var(--success-subtle);
}

/* =========================================================================
   Dark Theme ([data-theme="dark"])
   ========================================================================= */
[data-theme="dark"] {
  color-scheme: dark;

  /* Surfaces & Background */
  --bg: ${preset.dark.bg};
  --surface: ${preset.dark.surface};
  --surface-2: ${preset.dark['surface-2']};
  --surface-hover: ${preset.dark['surface-hover']};
  --border: ${preset.dark.border};
  --border-subtle: ${preset.dark['border-subtle']};

  /* Typography */
  --text: ${preset.dark.text};
  --text-muted: ${preset.dark.muted};

  /* Accent */
  --accent: ${darkAccent};
  --accent-contrast: ${darkAccentContrast};
  --accent-subtle: ${darkAccentSubtle};
  --accent-hover: ${darkAccentHover};

  /* Status Colors */
  --danger: ${preset.dark.danger};
  --danger-contrast: ${preset.dark['danger-contrast']};
  --danger-subtle: ${preset.dark['danger-subtle']};
  --danger-hover: ${preset.dark['danger-hover']};

  --success: ${preset.dark.success};
  --success-contrast: ${preset.dark['success-contrast']};
  --success-subtle: ${preset.dark['success-subtle']};
  --success-hover: ${preset.dark['success-hover']};

  --warning: ${preset.dark.warning};
  --warning-contrast: ${preset.dark['warning-contrast']};
  --warning-subtle: ${preset.dark['warning-subtle']};
  --warning-hover: ${preset.dark['warning-hover']};

  /* Overlays */
  --overlay-bg: ${preset.dark['overlay-bg']};

  /* Compatibility & Semantic Aliases */
  --muted: var(--text-muted);
  --muted-bg: var(--surface-2);
  --bg-surface: var(--surface);
  --bg-surface-secondary: var(--surface-2);
  --bg-muted: var(--surface-2);
  --surface-subtle: var(--surface-2);
  --border-color: var(--border);
  --text-primary: var(--text);
  --text-inverse: var(--accent-contrast);
  --primary: var(--accent);
  --primary-hover: var(--accent-hover);
  --primary-subtle: var(--accent-subtle);
  --danger-bg: var(--danger-subtle);
  --danger-border: var(--danger);
  --warning-bg: var(--warning-subtle);
  --warning-border: var(--warning);
  --success-bg: var(--success-subtle);
}

/* =========================================================================
   System Preference - Follows OS dark mode when theme is system
   ========================================================================= */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]),
  [data-theme="system"] {
    color-scheme: dark;

    --bg: ${preset.dark.bg};
    --surface: ${preset.dark.surface};
    --surface-2: ${preset.dark['surface-2']};
    --surface-hover: ${preset.dark['surface-hover']};
    --border: ${preset.dark.border};
    --border-subtle: ${preset.dark['border-subtle']};

    --text: ${preset.dark.text};
    --text-muted: ${preset.dark.muted};

    --accent: ${darkAccent};
    --accent-contrast: ${darkAccentContrast};
    --accent-subtle: ${darkAccentSubtle};
    --accent-hover: ${darkAccentHover};

    --danger: ${preset.dark.danger};
    --danger-contrast: ${preset.dark['danger-contrast']};
    --danger-subtle: ${preset.dark['danger-subtle']};
    --danger-hover: ${preset.dark['danger-hover']};

    --success: ${preset.dark.success};
    --success-contrast: ${preset.dark['success-contrast']};
    --success-subtle: ${preset.dark['success-subtle']};
    --success-hover: ${preset.dark['success-hover']};

    --warning: ${preset.dark.warning};
    --warning-contrast: ${preset.dark['warning-contrast']};
    --warning-subtle: ${preset.dark['warning-subtle']};
    --warning-hover: ${preset.dark['warning-hover']};

    --overlay-bg: ${preset.dark['overlay-bg']};

    --muted: var(--text-muted);
    --muted-bg: var(--surface-2);
    --bg-surface: var(--surface);
    --bg-surface-secondary: var(--surface-2);
    --bg-muted: var(--surface-2);
    --surface-subtle: var(--surface-2);
    --border-color: var(--border);
    --text-primary: var(--text);
    --text-inverse: var(--accent-contrast);
    --primary: var(--accent);
    --primary-hover: var(--accent-hover);
    --primary-subtle: var(--accent-subtle);
    --danger-bg: var(--danger-subtle);
    --danger-border: var(--danger);
    --warning-bg: var(--warning-subtle);
    --warning-border: var(--warning);
    --success-bg: var(--success-subtle);
  }
}

${VISUAL_TOKENS_CSS}
`;
}

/**
 * Colours of Studio → Visuals: the swatches a shape's colour is picked from and the scene's own
 * colours, for light and dark. They don't follow a workspace's theme preset; generateTokensCss
 * appends them as they are.
 */
const VISUAL_TOKENS_CSS = `/* =========================================================================
   Visuals (Studio → Visuals): the swatches a shape's colour is chosen from, and the scene's
   own colours. Box sides are these colours darkened (see visuals/visuals.css).
   ========================================================================= */
:root,
[data-theme="light"] {
  --vis-steel: #a1aab8;
  --vis-blue: #3b82f6;
  --vis-green: #22a35a;
  --vis-yellow: #eab308;
  --vis-orange: #f97316;
  --vis-red: #dc2626;
  --vis-purple: #8b5cf6;
  --vis-grey: #8a8f98;
  --vis-dark: #3f4652;
  --vis-white: #f1f3f6;

  --vis-shade: #0b1020;
  --vis-light: #ffffff;
  --vis-floor: #e9ecf1;
  --vis-floor-line: #d3d8e0;
  --vis-zone: #dbe7fb;
  --vis-belt: #2f343c;
  --vis-belt-mark: #6b7280;
  --vis-item: #c08a4e;
  --vis-liquid: #38bdf8;
  --vis-glass: #cfe3f5;
  --vis-on: #22c55e;
  --vis-idle: #eab308;
  --vis-off: #9ca3af;
  --vis-alarm: #ef4444;
  --vis-label: #18181b;
  --vis-label-bg: #ffffff;
  --vis-select: #2563eb;
}

[data-theme="dark"] {
  --vis-steel: #7b8494;
  --vis-white: #c9ced6;
  --vis-dark: #2b313b;
  --vis-shade: #000000;
  --vis-floor: #1c2028;
  --vis-floor-line: #2a303a;
  --vis-zone: #1d2a40;
  --vis-belt: #14171c;
  --vis-belt-mark: #4b5563;
  --vis-glass: #2a3f55;
  --vis-off: #6b7280;
  --vis-label: #f4f4f5;
  --vis-label-bg: #18181b;
  --vis-select: #60a5fa;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]),
  [data-theme="system"] {
    --vis-steel: #7b8494;
    --vis-white: #c9ced6;
    --vis-dark: #2b313b;
    --vis-shade: #000000;
    --vis-floor: #1c2028;
    --vis-floor-line: #2a303a;
    --vis-zone: #1d2a40;
    --vis-belt: #14171c;
    --vis-belt-mark: #4b5563;
    --vis-glass: #2a3f55;
    --vis-off: #6b7280;
    --vis-label: #f4f4f5;
    --vis-label-bg: #18181b;
    --vis-select: #60a5fa;
  }
}`;
