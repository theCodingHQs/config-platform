import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_PRESETS,
  neutralLightPalette,
  neutralDarkPalette,
  slateLightPalette,
  slateDarkPalette,
  oceanLightPalette,
  oceanDarkPalette,
  warmLightPalette,
  warmDarkPalette,
  defaultSharedTokens,
  SemanticColorsSchema,
  SharedTokensSchema,
  ThemePreferenceSchema,
  ThemePresetIdSchema,
  WorkspaceThemeConfigSchema,
  getContrastRatio,
  getDensitySpacing,
  deriveAccentShades,
  validateAccentContrast,
  generateTokensCss,
  getTextSizeScalePx,
  resolveControlHeights,
  resolveTextSize,
  resolveLayout,
  ThemeOverridesSchema,
} from '../src/theme.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Theme Tokens & WCAG Contrast Tests', () => {
  it('validates that defaultSharedTokens conforms to SharedTokensSchema', () => {
    const result = SharedTokensSchema.safeParse(defaultSharedTokens);
    assert.equal(result.success, true);
  });

  it('ships 4 immutable presets (Neutral, Slate, Ocean, Warm)', () => {
    const presetIds = Object.keys(THEME_PRESETS).sort();
    assert.deepEqual(presetIds, ['neutral', 'ocean', 'slate', 'warm']);
    for (const [id, preset] of Object.entries(THEME_PRESETS)) {
      assert.equal(preset.id, id);
      assert.ok(preset.name);
      assert.ok(preset.description);
      assert.equal(SemanticColorsSchema.safeParse(preset.light).success, true);
      assert.equal(SemanticColorsSchema.safeParse(preset.dark).success, true);
    }
  });

  it('verifies exact key parity between light and dark palettes for all 4 presets', () => {
    const presets = [
      { name: 'neutral', light: neutralLightPalette, dark: neutralDarkPalette },
      { name: 'slate', light: slateLightPalette, dark: slateDarkPalette },
      { name: 'ocean', light: oceanLightPalette, dark: oceanDarkPalette },
      { name: 'warm', light: warmLightPalette, dark: warmDarkPalette },
    ];

    const required = [
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

    for (const preset of presets) {
      const lightKeys = Object.keys(preset.light).sort();
      const darkKeys = Object.keys(preset.dark).sort();
      assert.deepEqual(lightKeys, darkKeys, `Key mismatch in preset ${preset.name}`);

      for (const key of required) {
        assert.ok(lightKeys.includes(key), `Missing ${key} in ${preset.name} light`);
        assert.ok(darkKeys.includes(key), `Missing ${key} in ${preset.name} dark`);
      }
    }
  });

  it('verifies WCAG 2.1 AA contrast >= 4.5:1 across ALL 4 presets in both Light and Dark mode', () => {
    for (const [id, preset] of Object.entries(THEME_PRESETS)) {
      // Light mode checks
      const lightTextBg = getContrastRatio(preset.light.text, preset.light.bg);
      const lightMutedBg = getContrastRatio(preset.light.muted, preset.light.bg);
      const lightAccentContrast = getContrastRatio(preset.light['accent-contrast'], preset.light.accent);

      assert.ok(lightTextBg >= 4.5, `Preset ${id} Light text/bg ratio ${lightTextBg} < 4.5`);
      assert.ok(lightMutedBg >= 4.5, `Preset ${id} Light muted/bg ratio ${lightMutedBg} < 4.5`);
      assert.ok(lightAccentContrast >= 4.5, `Preset ${id} Light accent-contrast/accent ratio ${lightAccentContrast} < 4.5`);

      // Dark mode checks
      const darkTextBg = getContrastRatio(preset.dark.text, preset.dark.bg);
      const darkMutedBg = getContrastRatio(preset.dark.muted, preset.dark.bg);
      const darkAccentContrast = getContrastRatio(preset.dark['accent-contrast'], preset.dark.accent);

      assert.ok(darkTextBg >= 4.5, `Preset ${id} Dark text/bg ratio ${darkTextBg} < 4.5`);
      assert.ok(darkMutedBg >= 4.5, `Preset ${id} Dark muted/bg ratio ${darkMutedBg} < 4.5`);
      assert.ok(darkAccentContrast >= 4.5, `Preset ${id} Dark accent-contrast/accent ratio ${darkAccentContrast} < 4.5`);
    }
  });

  it('verifies warning, success, and danger text contrast >= 4.5:1 on solid and subtle backgrounds across all 4 presets in both modes', () => {
    for (const [id, preset] of Object.entries(THEME_PRESETS)) {
      for (const mode of ['light', 'dark'] as const) {
        const p = preset[mode];
        for (const type of ['warning', 'success', 'danger'] as const) {
          const solid = p[type];
          const contrast = p[`${type}-contrast` as keyof typeof p] as string;
          const subtle = p[`${type}-subtle` as keyof typeof p] as string;

          const solidRatio = getContrastRatio(contrast, solid);
          const subtleRatio = getContrastRatio(solid, subtle);

          assert.ok(
            solidRatio >= 4.5,
            `${id} ${mode} ${type}-contrast (${contrast}) on solid ${type} (${solid}) ratio ${solidRatio.toFixed(2)} < 4.5`
          );
          assert.ok(
            subtleRatio >= 4.5,
            `${id} ${mode} ${type} (${solid}) on subtle (${subtle}) ratio ${subtleRatio.toFixed(2)} < 4.5`
          );
        }
      }
    }
  });

  it('verifies density spacing scaling factors', () => {
    const compact = getDensitySpacing('compact');
    const normal = getDensitySpacing('normal');
    const comfortable = getDensitySpacing('comfortable');

    assert.equal(normal['4'], '1rem');
    assert.equal(compact['4'], '0.8rem');
    assert.equal(comfortable['4'], '1.25rem');
    assert.equal(getDensitySpacing('dense')['4'], '0.6rem');
  });

  it('shrinks control heights only for dense density', () => {
    const dense = generateTokensCss({ presetId: 'neutral', overrides: { density: 'dense' } });
    assert.match(dense, /--control-height-md: 28px;/);
    assert.match(dense, /--spacing-4: 0\.6rem;/);

    const compact = generateTokensCss({ presetId: 'neutral', overrides: { density: 'compact' } });
    assert.match(compact, /--control-height-md: 36px;/);
  });

  it('derives the whole font scale from a configurable text size', () => {
    // Default (no override) keeps the original tokens
    const base = generateTokensCss({ presetId: 'neutral', overrides: {} });
    assert.match(base, /--font-size-sm: 0\.875rem;/);

    // 13px body → proportionally smaller scale, floor of 11px on captions
    const small = getTextSizeScalePx(13);
    assert.equal(small.sm, 13);
    assert.equal(small.xs, 11);
    assert.equal(small.md, 15);
    assert.equal(small['3xl'], 28);

    const css = generateTokensCss({ presetId: 'neutral', overrides: { textSize: 13 } });
    assert.match(css, /--font-size-sm: 0\.8125rem;/);
    assert.match(css, /--font-size-xs: 0\.6875rem;/);
  });

  it('applies a density default text size unless one is set explicitly', () => {
    assert.equal(resolveTextSize('dense'), 13);
    assert.equal(resolveTextSize('compact'), 13.5);
    assert.equal(resolveTextSize(undefined), 14);
    assert.equal(resolveTextSize('comfortable'), 15);
    assert.equal(resolveTextSize('dense', 16), 16);

    const dense = generateTokensCss({ presetId: 'neutral', overrides: { density: 'dense' } });
    assert.match(dense, /--font-size-sm: 0\.8125rem;/);

    const denseOverride = generateTokensCss({ presetId: 'neutral', overrides: { density: 'dense', textSize: 16 } });
    assert.match(denseOverride, /--font-size-sm: 1rem;/);

    const normal = generateTokensCss({ presetId: 'neutral', overrides: { density: 'normal' } });
    assert.match(normal, /--font-size-sm: 0\.875rem;/);
  });

  it('resolves layout settings with density-aware page padding', () => {
    assert.deepEqual(resolveLayout(undefined, undefined), {
      contentWidth: 1280, contentAlign: 'center', pagePadding: 24, sidebarWidth: 240,
    });
    assert.equal(resolveLayout(undefined, 'dense').pagePadding, 16);
    assert.equal(resolveLayout({ pagePadding: 40 }, 'dense').pagePadding, 40);

    const wide = generateTokensCss({ presetId: 'neutral', overrides: { layout: { contentWidth: 1440, contentAlign: 'start', sidebarWidth: 280 } } });
    assert.match(wide, /--layout-content-max-width: 1440px;/);
    assert.match(wide, /--layout-content-margin-inline: 0;/);
    assert.match(wide, /--layout-sidebar-width: 280px;/);

    const full = generateTokensCss({ presetId: 'neutral', overrides: { layout: { contentWidth: 'full' } } });
    assert.match(full, /--layout-content-max-width: none;/);
  });

  it('validates layout ranges and rejects unknown keys', () => {
    const ok = [{ contentWidth: 'full' }, { contentWidth: 640 }, { contentWidth: 2560 }, { pagePadding: 0 }, { sidebarWidth: 360 }, { contentAlign: 'start' }];
    for (const layout of ok) {
      assert.equal(ThemeOverridesSchema.safeParse({ layout }).success, true, `expected ${JSON.stringify(layout)} to be valid`);
    }
    const bad = [{ contentWidth: 639 }, { contentWidth: 1280.5 }, { contentWidth: 'wide' }, { pagePadding: 65 }, { sidebarWidth: 100 }, { contentAlign: 'right' }, { gutter: 10 }];
    for (const layout of bad) {
      assert.equal(ThemeOverridesSchema.safeParse({ layout }).success, false, `expected ${JSON.stringify(layout)} to be invalid`);
    }
  });

  it('validates text size range and step', () => {
    for (const ok of [12, 13.5, 14, 18]) {
      assert.equal(ThemeOverridesSchema.safeParse({ textSize: ok }).success, true, `expected ${ok} to be valid`);
    }
    for (const bad of [11.5, 18.5, 13.3, '14']) {
      assert.equal(ThemeOverridesSchema.safeParse({ textSize: bad }).success, false, `expected ${bad} to be invalid`);
    }
  });

  it('grows control heights when the text needs room, never shrinks them', () => {
    assert.deepEqual(resolveControlHeights('dense', 14), { sm: '24px', md: '28px', lg: '36px' });
    // 18px body on dense: 18 * 1.25 + 8 + 2 = 32.5 → 33px
    assert.equal(resolveControlHeights('dense', 18).md, '33px');
    // Normal density already has room for the largest text size
    assert.deepEqual(resolveControlHeights('normal', 18), { sm: '28px', md: '36px', lg: '44px' });
  });

  it('validates ThemePreferenceSchema and ThemePresetIdSchema', () => {
    assert.equal(ThemePreferenceSchema.safeParse('system').success, true);
    assert.equal(ThemePreferenceSchema.safeParse('light').success, true);
    assert.equal(ThemePreferenceSchema.safeParse('dark').success, true);
    assert.equal(ThemePreferenceSchema.safeParse('other').success, false);

    assert.equal(ThemePresetIdSchema.safeParse('neutral').success, true);
    assert.equal(ThemePresetIdSchema.safeParse('slate').success, true);
    assert.equal(ThemePresetIdSchema.safeParse('ocean').success, true);
    assert.equal(ThemePresetIdSchema.safeParse('warm').success, true);
    assert.equal(ThemePresetIdSchema.safeParse('invalid').success, false);
  });

  it('validates WorkspaceThemeConfigSchema overrides for accent, radius, and density only', () => {
    // Valid config
    const valid = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'ocean',
      overrides: {
        accent: '#2563eb',
        radius: 'md',
        density: 'compact',
      },
    });
    assert.equal(valid.success, true);

    // Invalid accent color (not 6-digit hex)
    const invalidHex = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { accent: 'blue' },
    });
    assert.equal(invalidHex.success, false);

    // Invalid radius
    const invalidRadius = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { radius: 'huge' },
    });
    assert.equal(invalidRadius.success, false);

    // Invalid density
    const invalidDensity = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { density: 'tight' },
    });
    assert.equal(invalidDensity.success, false);
  });

  it('derives accent shades and validates contrast with warning below 4.5:1', () => {
    // Good contrast accent
    const goodAccent = '#2563eb';
    const goodContrast = validateAccentContrast(goodAccent);
    assert.equal(goodContrast.isCompliant, true);
    assert.equal(goodContrast.warning, undefined);

    // Low contrast accent on white (e.g. bright yellow #facc15)
    const lowContrastAccent = '#facc15';
    const lowContrast = validateAccentContrast(lowContrastAccent);
    assert.equal(lowContrast.isCompliant, false);
    assert.ok(lowContrast.warning?.includes('below the WCAG AA minimum'));

    // Deriving shades produces expected tokens
    const shades = deriveAccentShades(goodAccent);
    assert.ok(shades.accentHoverLight);
    assert.ok(shades.accentHoverDark);
    assert.ok(shades.accentSubtleLight);
    assert.ok(shades.accentSubtleDark);
    assert.ok(shades.accentContrast === '#ffffff' || shades.accentContrast === '#09090b');
  });

  it('checks shipped tokens.css against the schema single source of truth', () => {
    const shippedCssPath = path.resolve(__dirname, '../../../apps/web/src/styles/tokens.css');
    assert.ok(fs.existsSync(shippedCssPath), 'apps/web/src/styles/tokens.css must exist');

    const shippedCss = fs.readFileSync(shippedCssPath, 'utf8').trim();
    const generatedCss = generateTokensCss({ presetId: 'neutral', overrides: {} }).trim();

    assert.equal(shippedCss, generatedCss, 'Shipped tokens.css must exactly match generateTokensCss() schema output');
  });
});
