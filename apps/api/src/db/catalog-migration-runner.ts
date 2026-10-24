import type { Pool, PoolClient } from 'pg';
import { pool, directPool } from './pool.js';

export const CATALOG_MIGRATION_LOCK_ID = 847291034;

export interface MigrationReport {
  version: number;
  name: string;
  rowsAffected?: number;
  appliedAt?: string;
}

export let editorDeleteMigrationReport: { rowsChanged: number; executedAt: string } = {
  rowsChanged: 0,
  executedAt: new Date().toISOString(),
};

export interface CatalogMigration {
  version: number;
  name: string;
  up: (client: PoolClient) => Promise<{ rowsAffected?: number } | void>;
}

export const catalogMigrations: CatalogMigration[] = [
  {
    version: 1,
    name: '001_catalog_base',
    up: async (client: PoolClient) => {
      await client.query(`
        -- Tenant table
        CREATE TABLE IF NOT EXISTS public.tenant (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          schema_version INT NOT NULL DEFAULT 1,
          timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';

        -- Entity definitions table
        CREATE TABLE IF NOT EXISTS public.entity_def (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          name VARCHAR(128) NOT NULL,
          label VARCHAR(255) NOT NULL,
          physical_table_name VARCHAR(64) NOT NULL,
          version INT NOT NULL DEFAULT 1,
          display_field_id VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_entity_tenant_name UNIQUE (tenant_id, name)
        );

        ALTER TABLE public.entity_def ADD COLUMN IF NOT EXISTS display_field_id VARCHAR(64);

        -- Field definitions table
        CREATE TABLE IF NOT EXISTS public.field_def (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          name VARCHAR(128) NOT NULL,
          label VARCHAR(255) NOT NULL,
          physical_column_name VARCHAR(64) NOT NULL,
          type VARCHAR(32) NOT NULL,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          is_unique BOOLEAN NOT NULL DEFAULT FALSE,
          is_primary BOOLEAN NOT NULL DEFAULT FALSE,
          position INT NOT NULL DEFAULT 0,
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_field_entity_name UNIQUE (entity_id, name)
        );

        ALTER TABLE public.field_def ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;

        -- Relation definitions table
        CREATE TABLE IF NOT EXISTS public.relation_def (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          name VARCHAR(128) NOT NULL,
          source_entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          source_field_id VARCHAR(64) NOT NULL REFERENCES public.field_def(id) ON DELETE CASCADE,
          target_entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          target_field_id VARCHAR(64) REFERENCES public.field_def(id) ON DELETE SET NULL,
          relation_type VARCHAR(32) NOT NULL DEFAULT 'many_to_one',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Page definitions table
        CREATE TABLE IF NOT EXISTS public.page_def (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          name VARCHAR(128) NOT NULL,
          route VARCHAR(255) NOT NULL,
          draft JSONB NOT NULL,
          published JSONB,
          version INT NOT NULL DEFAULT 1,
          allowed_roles TEXT[] DEFAULT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_page_tenant_route UNIQUE (tenant_id, route)
        );

        ALTER TABLE public.page_def ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT NULL;

        -- Schema migration history table
        CREATE TABLE IF NOT EXISTS public.schema_migration (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          version INT NOT NULL,
          ddl TEXT NOT NULL,
          status VARCHAR(32) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Auth tables
        CREATE TABLE IF NOT EXISTS public.app_user (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.tenant_member (
          user_id VARCHAR(64) NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          role VARCHAR(32) NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, tenant_id)
        );

        CREATE TABLE IF NOT EXISTS public.app_session (
          id VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          role VARCHAR(32) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.invite_token (
          token VARCHAR(128) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          inviter_id VARCHAR(64) NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
          invitee_email VARCHAR(255) NOT NULL,
          role VARCHAR(32) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_invite_tenant_email UNIQUE (tenant_id, invitee_email)
        );

        CREATE TABLE IF NOT EXISTS public.entity_permission (
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          role VARCHAR(32) NOT NULL,
          can_read BOOLEAN NOT NULL DEFAULT TRUE,
          can_create BOOLEAN NOT NULL DEFAULT FALSE,
          can_update BOOLEAN NOT NULL DEFAULT FALSE,
          can_delete BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (tenant_id, entity_id, role)
        );

        CREATE TABLE IF NOT EXISTS public.field_permission (
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          field_id VARCHAR(64) NOT NULL REFERENCES public.field_def(id) ON DELETE CASCADE,
          role VARCHAR(32) NOT NULL,
          hidden BOOLEAN NOT NULL DEFAULT FALSE,
          read_only BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (tenant_id, entity_id, field_id, role)
        );

        CREATE INDEX IF NOT EXISTS idx_entity_def_tenant ON public.entity_def(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_field_def_entity ON public.field_def(entity_id);
        CREATE INDEX IF NOT EXISTS idx_relation_def_tenant ON public.relation_def(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_page_def_tenant ON public.page_def(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_schema_migration_tenant ON public.schema_migration(tenant_id, version);
        CREATE INDEX IF NOT EXISTS idx_app_session_user ON public.app_session(user_id);
        CREATE INDEX IF NOT EXISTS idx_app_session_expires ON public.app_session(expires_at);
        CREATE INDEX IF NOT EXISTS idx_tenant_member_tenant ON public.tenant_member(tenant_id);
      `);
    },
  },
  {
    version: 2,
    name: '002_reset_editor_delete_permissions',
    up: async (client: PoolClient) => {
      // Part A.5: Resets entity permission rows where editor has canDelete false only if they match old UI default
      // (can_read=true, can_create=true, can_update=true, can_delete=false)
      const res = await client.query(`
        UPDATE public.entity_permission
        SET can_delete = true
        WHERE role = 'editor'
          AND can_read = true
          AND can_create = true
          AND can_update = true
          AND can_delete = false;
      `);
      const count = res.rowCount || 0;
      editorDeleteMigrationReport = { rowsChanged: count, executedAt: new Date().toISOString() };
      console.log(`[MIGRATION 002] Reset editor canDelete permissions: ${count} rows updated to can_delete=true.`);
      return { rowsAffected: count };
    },
  },
  {
    version: 3,
    name: '003_multi_workspace_and_verification',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.app_user ADD COLUMN IF NOT EXISTS last_tenant_id VARCHAR(64) REFERENCES public.tenant(id) ON DELETE SET NULL;
        ALTER TABLE public.app_user ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE TABLE IF NOT EXISTS public.email_verification_token (
          token VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_email_verification_user ON public.email_verification_token(user_id);
      `);
    },
  },
  {
    version: 4,
    name: '004_tenant_plan_and_limits',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS plan VARCHAR(32) NOT NULL DEFAULT 'free';
        ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS statement_timeout_ms INT NOT NULL DEFAULT 10000;
      `);
    },
  },
  {
    version: 5,
    name: '005_audit_log',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.audit_log (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          user_id VARCHAR(64) NOT NULL,
          user_email VARCHAR(255) NOT NULL,
          action VARCHAR(64) NOT NULL,
          entity_type VARCHAR(64) NOT NULL,
          entity_id VARCHAR(64) NOT NULL,
          before_state JSONB,
          after_state JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON public.audit_log(tenant_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(tenant_id, entity_type, entity_id);
      `);
    },
  },
  {
    version: 6,
    name: '006_audit_log_append_only',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey;

        CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          IF current_setting('audit.allow_tenant_purge', true) = 'on' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'audit_log is append-only: updates and deletes are prohibited';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_audit_log_append_only ON public.audit_log;
        CREATE TRIGGER trg_audit_log_append_only
        BEFORE UPDATE OR DELETE ON public.audit_log
        FOR EACH ROW
        EXECUTE FUNCTION public.prevent_audit_log_modification();
      `);
    },
  },
  {
    version: 7,
    name: '007_audit_log_scoped_purge',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          IF current_setting('audit.allow_tenant_purge', true) = 'on' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'audit_log is append-only: updates and deletes are prohibited';
        END;
        $$ LANGUAGE plpgsql;
      `);
    },
  },
  {
    version: 8,
    name: '008_user_theme_preference',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.app_user
        ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(16) NOT NULL DEFAULT 'system';
      `);
    },
  },
  {
    version: 9,
    name: '009_tenant_theme_config',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.tenant
        ADD COLUMN IF NOT EXISTS theme_config JSONB NOT NULL DEFAULT '{"presetId":"neutral","overrides":{}}'::jsonb;
      `);
    },
  },
  {
    version: 10,
    name: '010_entity_def_icon',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.entity_def
        ADD COLUMN IF NOT EXISTS icon VARCHAR(64);
      `);
    },
  },
  {
    version: 11,
    name: '011_export_template_and_permissions',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.entity_permission
        ADD COLUMN IF NOT EXISTS can_export BOOLEAN NOT NULL DEFAULT FALSE;

        UPDATE public.entity_permission
        SET can_export = TRUE
        WHERE role IN ('owner', 'admin', 'builder', 'editor');

        UPDATE public.entity_permission
        SET can_export = FALSE
        WHERE role = 'viewer';

        CREATE TABLE IF NOT EXISTS public.export_template (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          entity_id VARCHAR(64) NOT NULL REFERENCES public.entity_def(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          draft JSONB NOT NULL,
          published JSONB,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_export_template_tenant ON public.export_template(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_export_template_entity ON public.export_template(tenant_id, entity_id);
      `);
    },
  },
  {
    version: 12,
    name: '012_tenant_timezone',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.tenant
        ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
      `);
    },
  },
  {
    version: 13,
    name: '013_nested_page_navigation',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.page_nav_folder (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          parent_id VARCHAR(64),
          name VARCHAR(128) NOT NULL,
          slug VARCHAR(128) NOT NULL,
          position INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT fk_page_nav_folder_parent
            FOREIGN KEY (parent_id) REFERENCES public.page_nav_folder(id) ON DELETE CASCADE
        );

        ALTER TABLE public.page_def
          ADD COLUMN IF NOT EXISTS nav_folder_id VARCHAR(64),
          ADD COLUMN IF NOT EXISTS nav_position INT NOT NULL DEFAULT 0;

        CREATE INDEX IF NOT EXISTS idx_page_nav_folder_tenant_parent
          ON public.page_nav_folder(tenant_id, parent_id, position);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_page_nav_folder_sibling_slug
          ON public.page_nav_folder(tenant_id, COALESCE(parent_id, ''), slug);
        CREATE INDEX IF NOT EXISTS idx_page_def_tenant_nav
          ON public.page_def(tenant_id, nav_folder_id, nav_position);
      `);
    },
  },
  {
    version: 14,
    name: '014_page_nav_folder_icon',
    up: async (client: PoolClient) => {
      await client.query(`
        ALTER TABLE public.page_nav_folder
        ADD COLUMN IF NOT EXISTS icon VARCHAR(64);
      `);
    },
  },
  {
    version: 15,
    name: '015_date_settings',
    up: async (client: PoolClient) => {
      // Workspace date defaults (the time zone stays in tenant.timezone) and each user's own choices
      await client.query(`
        ALTER TABLE public.tenant
        ADD COLUMN IF NOT EXISTS date_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE public.app_user
        ADD COLUMN IF NOT EXISTS date_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
      `);
    },
  },
  {
    version: 16,
    name: '016_entity_unique_rules',
    up: async (client: PoolClient) => {
      // Field combinations no two records may share (each backed by a unique index)
      await client.query(`
        ALTER TABLE public.entity_def
        ADD COLUMN IF NOT EXISTS unique_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
    },
  },
  {
    version: 17,
    name: '017_report_schedules',
    up: async (client: PoolClient) => {
      // Reports emailed on a schedule, and how each workspace sends email
      await client.query(`
        ALTER TABLE public.tenant
        ADD COLUMN IF NOT EXISTS email_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

        CREATE TABLE IF NOT EXISTS public.report_schedule (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          template_id VARCHAR(64) NOT NULL REFERENCES public.export_template(id) ON DELETE CASCADE,
          name VARCHAR(120),
          config JSONB NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_by VARCHAR(64) REFERENCES public.app_user(id) ON DELETE SET NULL,
          next_run_at TIMESTAMPTZ,
          last_run_at TIMESTAMPTZ,
          last_status VARCHAR(16),
          last_error TEXT,
          running_since TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_report_schedule_tenant ON public.report_schedule(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_report_schedule_due ON public.report_schedule(next_run_at) WHERE enabled;
      `);
    },
  },
  {
    version: 18,
    name: '018_platform_setup',
    up: async (client: PoolClient) => {
      // Server-wide settings (Platform setup screen) and the accounts allowed to change them
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.platform_setting (
          key VARCHAR(64) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_by VARCHAR(64) REFERENCES public.app_user(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE public.app_user
        ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
      `);
      // An existing server's first account (whoever set it up) becomes its platform owner
      await client.query(`
        UPDATE public.app_user SET is_platform_admin = TRUE
        WHERE id = (SELECT id FROM public.app_user ORDER BY created_at, id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM public.app_user WHERE is_platform_admin);
      `);
    },
  },
  {
    version: 19,
    name: '019_password_reset_tokens',
    up: async (client: PoolClient) => {
      // One-time "forgot password" links (only a hash of each is stored)
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.password_reset_token (
          token VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_token_user ON public.password_reset_token(user_id);
      `);
    },
  },
  {
    version: 20,
    name: '020_live_connections',
    up: async (client: PoolClient) => {
      // Live data sources (machine gateways, MQTT brokers, simulators) and their tag rules
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.live_connection (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          kind VARCHAR(32) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          settings JSONB NOT NULL,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          view_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by VARCHAR(64) REFERENCES public.app_user(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_live_connection_tenant ON public.live_connection(tenant_id);
      `);
    },
  },
];

/**
 * Runs all unapplied versioned catalog migrations behind a PostgreSQL advisory lock.
 * Uses directPool (DATABASE_URL_DIRECT, unpooled) with a blocking advisory lock.
 */
export async function runCatalogMigrations(_customPool?: Pool): Promise<MigrationReport[] & { success: boolean }> {
  const db = directPool;
  const client = await db.connect();

  try {
    // Acquire blocking advisory lock on unpooled connection to prevent concurrent deploy race conditions
    await client.query(`SELECT pg_advisory_lock($1)`, [CATALOG_MIGRATION_LOCK_ID]);

    // Ensure schema migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch already applied migrations
    const appliedRes = await client.query<{ version: number }>(
      `SELECT version FROM public.schema_migrations ORDER BY version ASC`
    );
    const appliedVersions = new Set(appliedRes.rows.map((r) => r.version));

    const reports: MigrationReport[] & { success: boolean } = Object.assign([] as MigrationReport[], { success: true });

    for (const mig of catalogMigrations) {
      if (!appliedVersions.has(mig.version)) {
        await client.query('BEGIN');
        try {
          const result = await mig.up(client);
          await client.query(
            `INSERT INTO public.schema_migrations (version, name, applied_at)
             VALUES ($1, $2, NOW())`,
            [mig.version, mig.name]
          );
          await client.query('COMMIT');
          reports.push({
            version: mig.version,
            name: mig.name,
            rowsAffected: result?.rowsAffected,
            appliedAt: new Date().toISOString(),
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }

    return reports;
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [CATALOG_MIGRATION_LOCK_ID]);
    } catch {
      // ignore unlock error on disconnect
    }
    client.release();
  }
}
