import { describe, it, expect } from 'vitest';
import { catalogMigrations } from '../src/db/catalog-migration-runner.js';
import { ThemePreferenceSchema } from '@config-platform/schema';

describe('Catalog Migration 008: User Theme Preference', () => {
  it('includes migration 008_user_theme_preference in catalogMigrations', () => {
    const migration008 = catalogMigrations.find((m) => m.version === 8);
    expect(migration008).toBeDefined();
    expect(migration008?.name).toBe('008_user_theme_preference');
  });

  it('includes migration 009_tenant_theme_config in catalogMigrations', () => {
    const migration009 = catalogMigrations.find((m) => m.version === 9);
    expect(migration009).toBeDefined();
    expect(migration009?.name).toBe('009_tenant_theme_config');
  });

  it('includes migration 010_entity_def_icon in catalogMigrations', () => {
    const migration010 = catalogMigrations.find((m) => m.version === 10);
    expect(migration010).toBeDefined();
    expect(migration010?.name).toBe('010_entity_def_icon');
  });

  it('preserves all historical migrations without modification', () => {
    const versions = catalogMigrations.map((m) => m.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('includes migration 014_page_nav_folder_icon in catalogMigrations', () => {
    const migration014 = catalogMigrations.find((m) => m.version === 14);
    expect(migration014?.name).toBe('014_page_nav_folder_icon');
  });

  it('validates ThemePreferenceSchema values (system, light, dark)', () => {
    expect(ThemePreferenceSchema.safeParse('system').success).toBe(true);
    expect(ThemePreferenceSchema.safeParse('light').success).toBe(true);
    expect(ThemePreferenceSchema.safeParse('dark').success).toBe(true);

    expect(ThemePreferenceSchema.safeParse('blue').success).toBe(false);
    expect(ThemePreferenceSchema.safeParse('').success).toBe(false);
    expect(ThemePreferenceSchema.safeParse(null).success).toBe(false);
  });
});
