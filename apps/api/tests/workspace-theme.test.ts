import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WorkspaceThemeConfigSchema,
  ThemePresetIdSchema,
  validateAccentContrast,
  deriveAccentShades,
  deriveSemanticRadius,
  generateTokensCss,
  THEME_PRESETS,
} from '@config-platform/schema';
import { catalogMigrations, runCatalogMigrations } from '../src/db/catalog-migration-runner.js';
import { exportImportService, type WorkspaceBundle } from '../src/workspace/export-import-service.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { pool } from '../src/db/pool.js';

describe('Workspace Theme Configuration & Policy', () => {
  it('includes migration 009_tenant_theme_config in catalogMigrations', () => {
    const mig009 = catalogMigrations.find((m) => m.version === 9);
    expect(mig009).toBeDefined();
    expect(mig009?.name).toBe('009_tenant_theme_config');
  });

  it('validates WorkspaceThemeConfig with only presetId and allowed overrides (accent, radius, density)', () => {
    const validConfig = {
      presetId: 'ocean',
      overrides: {
        accent: '#0284c7',
        radius: 'lg',
        density: 'comfortable',
      },
    };

    const parsed = WorkspaceThemeConfigSchema.safeParse(validConfig);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.presetId).toBe('ocean');
      expect(parsed.data.overrides.accent).toBe('#0284c7');
      expect(parsed.data.overrides.radius).toBe('lg');
      expect(parsed.data.overrides.density).toBe('comfortable');
    }
  });

  it('rejects invalid overrides or invalid accent color format', () => {
    // Invalid accent (not 6-digit hex)
    const invalidHex = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { accent: 'rgb(255,0,0)' },
    });
    expect(invalidHex.success).toBe(false);

    // Invalid radius
    const invalidRadius = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { radius: 'extra-large' },
    });
    expect(invalidRadius.success).toBe(false);

    // Invalid density
    const invalidDensity = WorkspaceThemeConfigSchema.safeParse({
      presetId: 'neutral',
      overrides: { density: 'ultra' },
    });
    expect(invalidDensity.success).toBe(false);
  });

  it('derives accent shades and detects low contrast below 4.5:1', () => {
    const highContrast = validateAccentContrast('#2563eb');
    expect(highContrast.isCompliant).toBe(true);
    expect(highContrast.warning).toBeUndefined();

    const lowContrast = validateAccentContrast('#facc15'); // Bright yellow on white
    expect(lowContrast.isCompliant).toBe(false);
    expect(lowContrast.warning).toBeDefined();
    expect(lowContrast.warning).toContain('below the WCAG AA minimum of 4.5:1');

    const shades = deriveAccentShades('#2563eb');
    expect(shades.accentContrast).toBeDefined();
    expect(shades.accentHoverLight).toBeDefined();
    expect(shades.accentHoverDark).toBeDefined();
    expect(shades.accentSubtleLight).toBeDefined();
    expect(shades.accentSubtleDark).toBeDefined();
  });

  it('validates all 4 preset ids', () => {
    const presets = ['neutral', 'slate', 'ocean', 'warm'];
    for (const p of presets) {
      expect(ThemePresetIdSchema.safeParse(p).success).toBe(true);
      expect(THEME_PRESETS[p as keyof typeof THEME_PRESETS]).toBeDefined();
    }
    expect(ThemePresetIdSchema.safeParse('neon').success).toBe(false);
  });

  it('derives semantic radius scale and caps controls/surfaces so full does not turn modals/cards/inputs into pills', () => {
    // 1. None: all roles 0px
    const none = deriveSemanticRadius('none');
    expect(none.base).toBe('0px');
    expect(none.control).toBe('0px');
    expect(none.surface).toBe('0px');
    expect(none.pill).toBe('0px');
    expect(none.button).toBe('0px');

    // 2. Medium: balanced defaults
    const md = deriveSemanticRadius('md');
    expect(md.base).toBe('6px');
    expect(md.control).toBe('6px');
    expect(md.surface).toBe('10px');
    expect(md.pill).toBe('9999px');
    expect(md.button).toBe('6px');

    // 3. Full: buttons/pills are round (9999px), but controls and surfaces are strictly capped!
    const full = deriveSemanticRadius('full');
    expect(full.base).toBe('16px'); // CAPPED at 16px: defense-in-depth so base fallback never pills containers
    expect(full.control).toBe('8px'); // CAPPED at 8px: inputs never become pills
    expect(full.surface).toBe('16px'); // CAPPED at 16px: modals, cards, tables never become pills
    expect(full.pill).toBe('9999px');
    expect(full.button).toBe('9999px');

    // 4. CSS generator outputs all semantic tokens
    const css = generateTokensCss({
      presetId: 'neutral',
      overrides: { radius: 'full' },
    });
    expect(css).toContain('--radius-control: 8px;');
    expect(css).toContain('--radius-surface: 16px;');
    expect(css).toContain('--radius-pill: 9999px;');
    expect(css).toContain('--radius-button: 9999px;');
  });

  it('supports themeConfig in WorkspaceBundle export/import typing', () => {
    const bundle: WorkspaceBundle = {
      bundleVersion: 1,
      exportedAt: new Date().toISOString(),
      themeConfig: {
        presetId: 'warm',
        overrides: {
          accent: '#d97706',
          radius: 'md',
          density: 'normal',
        },
      },
      entities: [],
      relations: [],
      pages: [],
    };

    expect(bundle.themeConfig?.presetId).toBe('warm');
    expect(bundle.themeConfig?.overrides?.accent).toBe('#d97706');
    const parsed = WorkspaceThemeConfigSchema.safeParse(bundle.themeConfig);
    expect(parsed.success).toBe(true);
  });

  describe('Workspace Import Validation & Safe Runtime Style Output', () => {
    let testTenant: string;

    beforeAll(async () => {
      await runCatalogMigrations(pool);
      testTenant = `theme_test_${crypto.randomBytes(4).toString('hex')}`;
      await migrationService.provisionTenant(testTenant, 'Theme Validation Workspace');
    });

    afterAll(async () => {
      if (testTenant) {
        await pool.query('DELETE FROM public.tenant WHERE id = $1', [testTenant]);
      }
    });

    it('rejects malicious accent with injected CSS in schema validation', () => {
      const maliciousAccent = WorkspaceThemeConfigSchema.safeParse({
        presetId: 'neutral',
        overrides: {
          accent: '#2563eb; } * { display: none }',
        },
      });
      expect(maliciousAccent.success).toBe(false);
      if (!maliciousAccent.success) {
        const msg = maliciousAccent.error.issues[0]?.message;
        expect(msg).toContain('Accent must be a 6-digit hex color (#rrggbb)');
      }
    });

    it('rejects injected unknown properties in themeConfig or overrides via strict schema', () => {
      const injectedOverrides = WorkspaceThemeConfigSchema.safeParse({
        presetId: 'neutral',
        overrides: {
          accent: '#2563eb',
          injectedCss: 'body { display: none }',
        },
      });
      expect(injectedOverrides.success).toBe(false);

      const injectedTopLevel = WorkspaceThemeConfigSchema.safeParse({
        presetId: 'neutral',
        overrides: {},
        maliciousKey: 'attack',
      });
      expect(injectedTopLevel.success).toBe(false);
    });

    it('rejects import bundle containing malicious accent and returns clear conflict error', async () => {
      const maliciousBundle: WorkspaceBundle = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        themeConfig: {
          presetId: 'neutral',
          overrides: {
            accent: '#2563eb; } * { display: none }',
          },
        },
        entities: [],
        relations: [],
        pages: [],
      };

      const result = await exportImportService.importBundle(testTenant, maliciousBundle, true);
      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0]).toContain('Invalid theme configuration in bundle');
      expect(result.conflicts[0]).toContain('Accent must be a 6-digit hex color (#rrggbb)');
    });

    it('rejects import bundle containing injected/unrecognized theme properties', async () => {
      const injectedBundle: any = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        themeConfig: {
          presetId: 'neutral',
          overrides: {
            accent: '#2563eb',
            injectedProperty: 'malicious',
          },
        },
        entities: [],
        relations: [],
        pages: [],
      };

      const result = await exportImportService.importBundle(testTenant, injectedBundle, true);
      expect(result.success).toBe(false);
      expect(result.conflicts[0]).toContain('Invalid theme configuration in bundle');
      expect(result.conflicts[0]).toContain('Unrecognized key(s)');
    });

    it('confirms runtime style output is generated only from validated values and ignores malicious injection', () => {
      const maliciousConfig = {
        presetId: 'neutral',
        overrides: {
          accent: '#2563eb; } * { display: none }',
        },
      } as any;

      const runtimeCss = generateTokensCss(maliciousConfig);
      // Malicious injected CSS must never be in runtime style output
      expect(runtimeCss).not.toContain('display: none');
      expect(runtimeCss).not.toContain('* {');
      // Defaults to safe validated neutral tokens
      expect(runtimeCss).toContain('--accent: #2563eb;');

      // Valid configuration produces corresponding validated style tokens
      const validConfig = {
        presetId: 'ocean' as const,
        overrides: {
          accent: '#0284c7',
          radius: 'lg' as const,
        },
      };
      const validCss = generateTokensCss(validConfig);
      expect(validCss).toContain('--accent: #0284c7;');
      expect(validCss).toContain('Preset: Ocean (ocean)');
    });

    it('accepts and applies valid themeConfig on workspace import', async () => {
      const validBundle: WorkspaceBundle = {
        bundleVersion: 1,
        exportedAt: new Date().toISOString(),
        themeConfig: {
          presetId: 'slate',
          overrides: {
            accent: '#475569',
            radius: 'sm',
            density: 'compact',
          },
        },
        entities: [],
        relations: [],
        pages: [],
      };

      const result = await exportImportService.importBundle(testTenant, validBundle, false);
      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBe(0);

      // Verify stored theme_config in database
      const tenantRow = await pool.query<{ theme_config: any }>(
        `SELECT theme_config FROM public.tenant WHERE id = $1`,
        [testTenant]
      );
      expect(tenantRow.rows[0].theme_config).toEqual(validBundle.themeConfig);
    });
  });
});

