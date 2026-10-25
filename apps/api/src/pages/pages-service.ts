import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  PageDefinitionSchema,
  PageWidthSchema,
  AllowedIconNameSchema,
  migratePageV1toV2,
  type PageDefinition,
  type PageWidth,
  type NodeDefinition,
  type DataSourceDefinition,
} from '@config-platform/schema';
import { erdService } from '../schema/erd-service.js';
import { visualRepository } from '../visuals/visual-repository.js';
import crypto from 'node:crypto';

/** A page request the client can fix; the error handler answers with its status and message. */
export class PageRequestError extends Error {
  constructor(public readonly statusCode: 409 | 422, message: string) {
    super(message);
    this.name = statusCode === 409 ? 'Conflict' : 'Unprocessable Entity';
  }
}

export interface PageSummary {
  id: string;
  name: string;
  route: string;
  version: number;
  hasDraft: boolean;
  hasPublished: boolean;
  createdAt: string;
  updatedAt: string;
  folderId?: string | null;
  position?: number;
  allowedRoles?: string[] | null;
  /** Navigation icon override (null = derived automatically). */
  icon?: string | null;
  /** 'full' = always full width; null = follows the theme content width. */
  width?: 'full' | null;
}

export interface PageNavFolder {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  position: number;
  icon: string | null;
}

/** Page-level settings edited from the Pages screen; applied to draft and published at once. */
export interface PageSettingsInput {
  name?: string;
  /** Last route segment; the full route is rebuilt from the page's group. */
  slug?: string;
  folderId?: string | null;
  width?: PageWidth;
  icon?: string | null;
}

const FOLDER_COLUMNS = `id, parent_id AS "parentId", name, slug, position, icon`;
const ROUTE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertIcon(icon: string | null | undefined): void {
  if (icon !== null && icon !== undefined && !AllowedIconNameSchema.safeParse(icon).success) {
    throw new Error(`'${icon}' is not an allowed icon`);
  }
}

export interface PageNavigation {
  folders: PageNavFolder[];
  pages: PageSummary[];
}

export interface PageDetail extends PageSummary {
  draft: PageDefinition;
  published: PageDefinition | null;
  brokenBindings: string[];
}

export class PagesService {
  /**
   * Scans a PageDefinition tree and returns a list of broken entity or field bindings
   */
  async validateBindings(
    tenantId: string,
    rawPageDef: PageDefinition,
    externalClient?: PoolClient
  ): Promise<string[]> {
    if (!rawPageDef) return [];
    const pageDef = migratePageV1toV2(rawPageDef);

    const erd = await erdService.getLiveErd(tenantId, externalClient);
    const entityMap = new Map<string, typeof erd.tables[0]>();
    const fieldMap = new Map<string, typeof erd.tables[0]['columns'][0]>();
    const entityColumnsMap = new Map<string, Set<string>>();

    for (const table of erd.tables) {
      entityMap.set(table.id, table);
      entityMap.set(table.name, table);
      const colSet = new Set<string>();
      for (const col of table.columns) {
        fieldMap.set(col.id, col);
        colSet.add(col.id);
        colSet.add(col.name);
      }
      entityColumnsMap.set(table.id, colSet);
      entityColumnsMap.set(table.name, colSet);
    }

    const visualIds = await visualRepository.ids(tenantId, externalClient);

    const broken: string[] = [];
    const dataSourceMap = new Map<string, DataSourceDefinition>();

    // Validate data sources
    if (Array.isArray(pageDef.dataSources)) {
      for (const ds of pageDef.dataSources) {
        dataSourceMap.set(ds.id, ds);
        const entity = entityMap.get(ds.entityId);
        if (!ds.entityId || !entity) {
          broken.push(`Data source [${ds.id}] references missing entity '${ds.entityId || 'undefined'}'`);
        } else {
          const colSet = entityColumnsMap.get(ds.entityId) || new Set<string>();
          if (ds.filter && typeof ds.filter === 'object') {
            for (const key of Object.keys(ds.filter)) {
              // "machine_name,title" matches any of several fields: check each one
              for (const field of key.split(',').map((f) => f.trim()).filter(Boolean)) {
                if (!colSet.has(field)) {
                  broken.push(`Data source [${ds.id}] filter references missing field '${field}'`);
                }
              }
            }
          }
          if (ds.sort?.fieldId && !colSet.has(ds.sort.fieldId)) {
            broken.push(`Data source [${ds.id}] sort references missing field '${ds.sort.fieldId}'`);
          }
        }
      }
    }

    function checkNode(node: NodeDefinition) {
      if (!node) return;

      if (node.type === 'table') {
        const sourceId = node.props?.source;
        if (sourceId) {
          const ds = dataSourceMap.get(sourceId);
          if (!ds) {
            broken.push(`Table [${node.id}] references missing data source '${sourceId}'`);
          } else {
            const colSet = entityColumnsMap.get(ds.entityId) || new Set<string>();
            const cols = (node.props?.columns || []) as Array<{ fieldId: string }>;
            for (const col of cols) {
              if (!col.fieldId || !colSet.has(col.fieldId)) {
                broken.push(`Table [${node.id}] references missing column '${col.fieldId || 'undefined'}'`);
              }
            }
          }
        } else {
          const entityId = node.props?.entityId;
          if (!entityId || !entityMap.has(entityId)) {
            broken.push(`Table [${node.id}] references missing entity '${entityId || 'undefined'}'`);
          } else {
            const cols = (node.props?.columns || []) as Array<{ fieldId: string }>;
            for (const col of cols) {
              if (!col.fieldId || !fieldMap.has(col.fieldId)) {
                broken.push(`Table [${node.id}] references missing column '${col.fieldId || 'undefined'}'`);
              }
            }
          }
        }
      }

      if (node.type === 'details') {
        const sourceId = node.props?.source;
        if (sourceId) {
          const ds = dataSourceMap.get(sourceId);
          if (!ds) {
            broken.push(`Details [${node.id}] references missing data source '${sourceId}'`);
          } else {
            const colSet = entityColumnsMap.get(ds.entityId) || new Set<string>();
            const fields = (node.props?.fields || []) as Array<{ fieldId: string }>;
            for (const f of fields) {
              if (!f.fieldId || !colSet.has(f.fieldId)) {
                broken.push(`Details [${node.id}] references missing field '${f.fieldId || 'undefined'}'`);
              }
            }
          }
        } else {
          const entityId = node.props?.entityId;
          if (!entityId || !entityMap.has(entityId)) {
            broken.push(`Details [${node.id}] references missing entity '${entityId || 'undefined'}'`);
          } else {
            const fields = (node.props?.fields || []) as Array<{ fieldId: string }>;
            for (const f of fields) {
              if (!f.fieldId || !fieldMap.has(f.fieldId)) {
                broken.push(`Details [${node.id}] references missing field '${f.fieldId || 'undefined'}'`);
              }
            }
          }
        }
      }

      if (node.type === 'form') {
        const entityId = node.props?.entityId;
        if (!entityId || !entityMap.has(entityId)) {
          broken.push(`Form [${node.id}] references missing entity '${entityId || 'undefined'}'`);
        } else {
          const fields = (node.props?.fields || []) as Array<{ fieldId: string }>;
          for (const f of fields) {
            if (!f.fieldId || !fieldMap.has(f.fieldId)) {
              broken.push(`Form [${node.id}] references missing field '${f.fieldId || 'undefined'}'`);
            }
          }
        }
      }

      if (node.type === 'chart') {
        const sourceId = node.props?.source;
        let colSet: Set<string> | undefined;

        if (sourceId) {
          const ds = dataSourceMap.get(sourceId);
          if (!ds) {
            broken.push(`Chart [${node.id}] references missing data source '${sourceId}'`);
          } else {
            colSet = entityColumnsMap.get(ds.entityId);
          }
        } else {
          const entityId = node.props?.entityId;
          if (!entityId || !entityMap.has(entityId)) {
            broken.push(`Chart [${node.id}] references missing entity '${entityId || 'undefined'}'`);
          } else {
            colSet = entityColumnsMap.get(entityId);
          }
        }

        if (colSet) {
          const groupByFieldId = node.props?.groupByFieldId;
          if (groupByFieldId && groupByFieldId !== 'id' && !colSet.has(groupByFieldId)) {
            broken.push(`Chart [${node.id}] references missing field '${groupByFieldId}'`);
          }
          const aggregateFieldId = node.props?.aggregateFieldId;
          if (aggregateFieldId && aggregateFieldId !== 'id' && !colSet.has(aggregateFieldId)) {
            broken.push(`Chart [${node.id}] references missing field '${aggregateFieldId}'`);
          }
        }
      }

      if (node.type === 'visual') {
        const visualId = node.props?.visualId;
        if (visualId && !visualIds.has(visualId)) {
          broken.push(`Visual [${node.id}] references missing visual '${visualId}'`);
        }
      }

      if (node.type === 'stat') {
        const entityId = node.props?.entityId;
        if (!entityId || !entityMap.has(entityId)) {
          broken.push(`Stat [${node.id}] references missing entity '${entityId || 'undefined'}'`);
        } else {
          const fieldId = node.props?.fieldId;
          const colSet = entityColumnsMap.get(entityId);
          if (fieldId && fieldId !== 'id' && colSet && !colSet.has(fieldId)) {
            broken.push(`Stat [${node.id}] references missing field '${fieldId}'`);
          }
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          checkNode(child);
        }
      }
    }

    if (pageDef.root) {
      checkNode(pageDef.root);
    }

    return broken;
  }

  /**
   * GET /pages - List all pages for tenant
   */
  async listPages(tenantId: string): Promise<PageSummary[]> {
    const res = await pool.query(
      `SELECT id, name, route, version, nav_folder_id AS "folderId", nav_position AS position,
              allowed_roles AS "allowedRoles",
              COALESCE(draft->>'icon', published->>'icon') AS icon,
              COALESCE(draft->>'width', published->>'width') AS width,
              (draft IS NOT NULL) AS "hasDraft",
              (published IS NOT NULL) AS "hasPublished",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM public.page_def
       WHERE tenant_id = $1
       ORDER BY nav_position ASC, updated_at DESC`,
      [tenantId]
    );

    return res.rows;
  }

  async getNavigation(tenantId: string): Promise<PageNavigation> {
    const [folders, pages] = await Promise.all([
      pool.query(
        `SELECT ${FOLDER_COLUMNS}
         FROM public.page_nav_folder WHERE tenant_id = $1
         ORDER BY position ASC, name ASC`,
        [tenantId]
      ),
      this.listPages(tenantId),
    ]);
    return { folders: folders.rows, pages };
  }

  async createFolder(
    tenantId: string,
    input: { name: string; parentId?: string | null; icon?: string | null }
  ): Promise<PageNavFolder> {
    const name = input.name.trim();
    if (!name || name.length > 128) throw new Error('Folder name must be between 1 and 128 characters');
    assertIcon(input.icon);
    if (input.parentId) await this.assertFolder(tenantId, input.parentId);
    const slug = this.slugify(name);
    const siblings = await pool.query<{ name: string; slug: string }>(
      `SELECT name, slug FROM public.page_nav_folder
       WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
      [tenantId, input.parentId ?? null]
    );
    if (siblings.rows.some((folder) => folder.slug === slug || folder.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A folder with this name already exists at this level');
    }
    const id = `nf_${crypto.randomBytes(6).toString('hex')}`;
    const nextPosition = await pool.query<{ position: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS position FROM public.page_nav_folder
       WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
      [tenantId, input.parentId ?? null]
    );
    const res = await pool.query(
      `INSERT INTO public.page_nav_folder (id, tenant_id, parent_id, name, slug, position, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${FOLDER_COLUMNS}`,
      [id, tenantId, input.parentId ?? null, name, slug, nextPosition.rows[0].position, input.icon ?? null]
    );
    return res.rows[0];
  }

  async updateFolder(
    tenantId: string,
    folderId: string,
    input: { name?: string; parentId?: string | null; icon?: string | null }
  ): Promise<PageNavFolder> {
    assertIcon(input.icon);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
      const current = await client.query<PageNavFolder>(
        `SELECT ${FOLDER_COLUMNS}
         FROM public.page_nav_folder WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, folderId]
      );
      if (!current.rows[0]) throw new Error(`Folder '${folderId}' not found`);
      const folder = current.rows[0];
      const parentId = input.parentId === undefined ? folder.parentId : input.parentId;
      if (parentId) await this.assertFolder(tenantId, parentId, client);
      if (parentId === folderId) throw new Error('A folder cannot be its own parent');
      const newName = input.name === undefined ? folder.name : input.name.trim();
      if (!newName || newName.length > 128) throw new Error('Folder name must be between 1 and 128 characters');
      const slug = input.name === undefined ? folder.slug : this.slugify(newName);
      const descendants = await client.query<{ id: string; parent_id: string | null; slug: string }>(
        `WITH RECURSIVE tree AS (
           SELECT id, parent_id, slug FROM public.page_nav_folder WHERE tenant_id = $1 AND id = $2
           UNION ALL
           SELECT f.id, f.parent_id, f.slug FROM public.page_nav_folder f JOIN tree t ON f.parent_id = t.id
           WHERE f.tenant_id = $1
         ) SELECT * FROM tree`,
        [tenantId, folderId]
      );
      if (parentId && descendants.rows.some((entry) => entry.id === parentId)) {
        throw new Error('A folder cannot be moved inside its descendant');
      }
      const siblingCheck = await client.query<{ id: string }>(
        `SELECT id FROM public.page_nav_folder
         WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND id <> $3
           AND (slug = $4 OR lower(name) = lower($5))`,
        [tenantId, parentId, folderId, slug, newName]
      );
      if (siblingCheck.rowCount) throw new Error('A folder with this name already exists at this level');

      const icon = input.icon === undefined ? folder.icon : input.icon;
      await client.query(
        `UPDATE public.page_nav_folder SET name = $3, slug = $4, parent_id = $5, icon = $6 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, folderId, newName, slug, parentId, icon]
      );
      await this.rebuildFolderRoutes(client, tenantId, descendants.rows.map((entry) => entry.id));
      const updated = await client.query(
        `SELECT ${FOLDER_COLUMNS}
         FROM public.page_nav_folder WHERE tenant_id = $1 AND id = $2`,
        [tenantId, folderId]
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteFolder(tenantId: string, folderId: string): Promise<void> {
    const result = await pool.query(
      `DELETE FROM public.page_nav_folder f
       WHERE f.tenant_id = $1 AND f.id = $2
         AND NOT EXISTS (SELECT 1 FROM public.page_nav_folder c WHERE c.tenant_id = $1 AND c.parent_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM public.page_def p WHERE p.tenant_id = $1 AND p.nav_folder_id = f.id)
       RETURNING f.id`,
      [tenantId, folderId]
    );
    if (!result.rowCount) throw new Error('Folder not found or not empty');
  }

  async movePage(tenantId: string, pageId: string, folderId: string | null): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
      if (folderId) await this.assertFolder(tenantId, folderId, client);
      const page = await client.query<{ route: string }>(
        `SELECT route FROM public.page_def WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, pageId]
      );
      if (!page.rows[0]) throw new Error(`Page '${pageId}' not found`);
      const nextRoute = await this.routeForFolder(client, tenantId, folderId, page.rows[0].route.split('/').filter(Boolean).pop()!);
      await this.applyRouteChanges(client, tenantId, new Map([[pageId, nextRoute]]));
      const nextPosition = await client.query<{ position: number }>(
        `SELECT COALESCE(MAX(nav_position) + 1, 0) AS position FROM public.page_def
         WHERE tenant_id = $1 AND nav_folder_id IS NOT DISTINCT FROM $2 AND id <> $3`,
        [tenantId, folderId, pageId]
      );
      await client.query(
        `UPDATE public.page_def SET nav_folder_id = $3, nav_position = $4
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pageId, folderId, nextPosition.rows[0].position]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * PUT /pages/:id/settings - Page-level settings (name, URL slug, group, width, icon).
   * These are navigation/presentation settings rather than page content, so they apply to
   * the draft and the published version together and take effect without republishing.
   */
  async updatePageSettings(tenantId: string, pageId: string, input: PageSettingsInput): Promise<PageSummary> {
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && (!name || name.length > 128)) {
      throw new Error('Page name must be between 1 and 128 characters');
    }
    if (input.slug !== undefined && !ROUTE_SLUG_PATTERN.test(input.slug)) {
      throw new Error('URL slug may only contain lowercase letters, numbers and single hyphens');
    }
    if (input.width !== undefined && !PageWidthSchema.safeParse(input.width).success) {
      throw new Error("Width must be 'theme' or 'full'");
    }
    assertIcon(input.icon);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
      const currentRes = await client.query<{ route: string; folderId: string | null }>(
        `SELECT route, nav_folder_id AS "folderId" FROM public.page_def WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, pageId]
      );
      const current = currentRes.rows[0];
      if (!current) throw new Error(`Page '${pageId}' not found`);

      // Route = group path + slug; rebuilt when either changes (duplicate routes are rejected)
      const folderId = input.folderId === undefined ? current.folderId : input.folderId;
      if (folderId) await this.assertFolder(tenantId, folderId, client);
      const slug = input.slug ?? current.route.split('/').filter(Boolean).pop()!;
      const nextRoute = await this.routeForFolder(client, tenantId, folderId, slug);
      if (nextRoute !== current.route) {
        await this.applyRouteChanges(client, tenantId, new Map([[pageId, nextRoute]]));
      }
      if (folderId !== current.folderId) {
        const nextPosition = await client.query<{ position: number }>(
          `SELECT COALESCE(MAX(nav_position) + 1, 0) AS position FROM public.page_def
           WHERE tenant_id = $1 AND nav_folder_id IS NOT DISTINCT FROM $2 AND id <> $3`,
          [tenantId, folderId, pageId]
        );
        await client.query(
          `UPDATE public.page_def SET nav_folder_id = $3, nav_position = $4 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, pageId, folderId, nextPosition.rows[0].position]
        );
      }

      // Width/icon live in the page definition; set or remove the key in draft and published.
      // 'theme' width and a null icon are the defaults, so they are stored as absent.
      const params: unknown[] = [tenantId, pageId, name ?? null];
      let iconParam = '';
      if (typeof input.icon === 'string') {
        params.push(input.icon);
        iconParam = `$${params.length}::text`;
      }
      const definitionPatch = (column: 'draft' | 'published') => {
        let expr: string = column;
        if (input.width !== undefined) {
          expr = input.width === 'full'
            ? `jsonb_set(${expr}, '{width}', '"full"', true)`
            : `(${expr} - 'width')`;
        }
        if (input.icon !== undefined) {
          expr = input.icon === null ? `(${expr} - 'icon')` : `jsonb_set(${expr}, '{icon}', to_jsonb(${iconParam}), true)`;
        }
        return `CASE WHEN ${column} IS NULL THEN NULL ELSE ${expr} END`;
      };
      await client.query(
        `UPDATE public.page_def
         SET name = COALESCE($3::text, name),
             draft = ${definitionPatch('draft')},
             published = ${definitionPatch('published')},
             version = version + 1,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        params
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const pages = await this.listPages(tenantId);
    return pages.find((page) => page.id === pageId)!;
  }

  /**
   * GET /pages/published - Returns published pages for runtime app navigation & rendering
   */
  async listPublishedPages(tenantId: string): Promise<PageDefinition[]> {
    const res = await pool.query<{ published: any; allowedRoles: string[] | null }>(
      `SELECT published, allowed_roles AS "allowedRoles"
       FROM public.page_def
       WHERE tenant_id = $1 AND published IS NOT NULL
       ORDER BY route ASC`,
      [tenantId]
    );

    // Pages imported from a workspace bundle may carry their restriction only in the column
    return res.rows.map((r) => {
      const page = migratePageV1toV2(r.published);
      if (!page.allowedRoles?.length && r.allowedRoles?.length) {
        page.allowedRoles = r.allowedRoles as PageDefinition['allowedRoles'];
      }
      return page;
    });
  }

  /**
   * GET /pages/:id - Get page by ID with draft, published, and broken bindings
   */
  async getPage(tenantId: string, id: string): Promise<PageDetail> {
    const res = await pool.query(
      `SELECT id, name, route, draft, published, version,
              allowed_roles AS "allowedRoles",
              (draft IS NOT NULL) AS "hasDraft",
              (published IS NOT NULL) AS "hasPublished",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM public.page_def
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );

    if (res.rows.length === 0) {
      throw new Error(`Page '${id}' not found`);
    }

    const row = res.rows[0];
    const draft = row.draft ? migratePageV1toV2(row.draft) : null;
    const published = row.published ? migratePageV1toV2(row.published) : null;
    const brokenBindings = draft ? await this.validateBindings(tenantId, draft) : [];

    return {
      id: row.id,
      name: row.name,
      route: row.route,
      version: row.version,
      hasDraft: row.hasDraft,
      hasPublished: row.hasPublished,
      draft: draft as PageDefinition,
      published: published as PageDefinition | null,
      // Live access restriction (set on publish)
      allowedRoles: row.allowedRoles ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      brokenBindings,
    };
  }

  /**
   * POST /pages - Create a new page
   */
  async createPage(
    tenantId: string,
    input: {
      name: string;
      route: string;
      draft?: PageDefinition;
      folderId?: string | null;
      width?: PageWidth;
      icon?: string | null;
    }
  ): Promise<PageDetail> {
    const id = `p_${crypto.randomBytes(4).toString('hex')}`;
    let formattedRoute = input.route.startsWith('/') ? input.route : `/${input.route}`;
    if (input.folderId) await this.assertFolder(tenantId, input.folderId);

    // Default blank page if no draft provided
    const baseDraft: PageDefinition = input.draft
      ? migratePageV1toV2(input.draft)
      : {
          schemaVersion: 2,
          id,
          version: 1,
          route: formattedRoute,
          state: {},
          dataSources: [],
          root: {
            id: `stack_${crypto.randomBytes(3).toString('hex')}`,
            type: 'stack',
            props: { direction: 'vertical', gap: 24 },
            children: [
              {
                id: `text_${crypto.randomBytes(3).toString('hex')}`,
                type: 'text',
                props: { value: input.name, variant: 'h1' },
              },
            ],
          },
        };
    // Page settings chosen in the create dialog ('theme' width is the default, stored as absent)
    const initialDraft: PageDefinition = {
      ...baseDraft,
      ...(input.width === 'full' ? { width: 'full' as const } : {}),
      ...(input.icon ? { icon: input.icon as PageDefinition['icon'] } : {}),
    };

    // Validate PageDefinition schema
    const parsed = PageDefinitionSchema.safeParse(initialDraft);
    if (!parsed.success) {
      throw new Error(`Invalid page definition: ${parsed.error.message}`);
    }

    // New pages go to the end of their folder (all-zero positions fall back to updated_at order)
    const nextPosition = await pool.query<{ position: number }>(
      `SELECT COALESCE(MAX(nav_position) + 1, 0) AS position FROM public.page_def
       WHERE tenant_id = $1 AND nav_folder_id IS NOT DISTINCT FROM $2`,
      [tenantId, input.folderId ?? null]
    );

    // The definition id must equal the row id: the runtime matches navigation entries to
    // published definitions by id, so a page with a different draft id never shows in the menu.
    const res = await pool.query(
      `INSERT INTO public.page_def (id, tenant_id, name, route, draft, published, version, nav_folder_id, nav_position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, 1, $6, $7, NOW(), NOW())
       RETURNING id, name, route, draft, published, version, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        tenantId,
        input.name,
        formattedRoute,
        JSON.stringify({ ...parsed.data, id, route: formattedRoute }),
        input.folderId ?? null,
        nextPosition.rows[0].position,
      ]
    );

    const row = res.rows[0];
    const draft = migratePageV1toV2(row.draft);
    const brokenBindings = await this.validateBindings(tenantId, draft);

    return {
      id: row.id,
      name: row.name,
      route: row.route,
      version: row.version,
      hasDraft: true,
      hasPublished: false,
      draft,
      published: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      brokenBindings,
    };
  }

  /**
   * PUT /pages/:id - Update draft and metadata
   */
  async updatePage(
    tenantId: string,
    id: string,
    input: { name?: string; route?: string; draft?: PageDefinition; expectedVersion?: number }
  ): Promise<PageDetail> {
    // Check page exists and optimistic lock
    const checkRes = await pool.query<{ version: number; draft: any; name: string; route: string }>(
      `SELECT version, draft, name, route FROM public.page_def WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );

    if (checkRes.rows.length === 0) {
      throw new Error(`Page '${id}' not found`);
    }

    const current = checkRes.rows[0];
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new PageRequestError(409, `Version conflict: expected ${input.expectedVersion}, found ${current.version}`);
    }

    const rawDraft = input.draft || current.draft;
    const newDraft = rawDraft ? migratePageV1toV2(rawDraft) : rawDraft;
    const newName = input.name || current.name;
    const newRoute = input.route ? (input.route.startsWith('/') ? input.route : `/${input.route}`) : current.route;

    // Validate PageDefinition schema
    const parsed = PageDefinitionSchema.safeParse(newDraft);
    if (!parsed.success) {
      throw new PageRequestError(422, `Invalid page definition: ${parsed.error.message}`);
    }

    // The version is checked again in the UPDATE so two saves racing past the check above
    // can't both apply (the second gets a conflict instead of silently overwriting)
    const res = await pool.query(
      `UPDATE public.page_def
       SET name = $1, route = $2, draft = $3, version = version + 1, updated_at = NOW()
       WHERE tenant_id = $4 AND id = $5 AND ($6::int IS NULL OR version = $6)
       RETURNING id, name, route, draft, published, version,
                 (draft IS NOT NULL) AS "hasDraft",
                 (published IS NOT NULL) AS "hasPublished",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [newName, newRoute, JSON.stringify({ ...parsed.data, id }), tenantId, id, input.expectedVersion ?? null]
    );
    if (res.rows.length === 0) {
      throw new PageRequestError(409, `Version conflict: the page was saved elsewhere (expected version ${input.expectedVersion})`);
    }

    const row = res.rows[0];
    const draft = migratePageV1toV2(row.draft);
    const published = row.published ? migratePageV1toV2(row.published) : null;
    const brokenBindings = await this.validateBindings(tenantId, draft);

    return {
      id: row.id,
      name: row.name,
      route: row.route,
      version: row.version,
      hasDraft: row.hasDraft,
      hasPublished: row.hasPublished,
      draft,
      published,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      brokenBindings,
    };
  }

  /**
   * POST /pages/:id/publish - Publishes draft to published JSON
   */
  async publishPage(tenantId: string, id: string): Promise<PageDetail> {
    const page = await this.getPage(tenantId, id);

    // Validate draft before publishing
    const draftV2 = migratePageV1toV2(page.draft);
    const parsed = PageDefinitionSchema.safeParse(draftV2);
    if (!parsed.success) {
      throw new PageRequestError(422, `Cannot publish invalid page: ${parsed.error.message}`);
    }

    // The access restriction goes live with the page: the column (used for listings and
    // navigation) always matches the published definition
    const publishedRoles = parsed.data.allowedRoles?.length ? parsed.data.allowedRoles : null;
    const res = await pool.query(
      `UPDATE public.page_def
       SET published = $1, allowed_roles = $4, version = version + 1, updated_at = NOW()
       WHERE tenant_id = $2 AND id = $3
       RETURNING id, name, route, draft, published, version,
                 (draft IS NOT NULL) AS "hasDraft",
                 (published IS NOT NULL) AS "hasPublished",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [JSON.stringify({ ...parsed.data, id }), tenantId, id, publishedRoles]
    );

    const row = res.rows[0];
    const draft = migratePageV1toV2(row.draft);
    const published = migratePageV1toV2(row.published);
    const brokenBindings = await this.validateBindings(tenantId, draft);

    return {
      id: row.id,
      name: row.name,
      route: row.route,
      version: row.version,
      hasDraft: row.hasDraft,
      hasPublished: row.hasPublished,
      draft,
      published,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      brokenBindings,
    };
  }

  /**
   * DELETE /pages/:id - Delete page
   */
  async deletePage(tenantId: string, id: string): Promise<{ success: boolean; id: string }> {
    const res = await pool.query(
      `DELETE FROM public.page_def WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, id]
    );

    if (res.rows.length === 0) {
      throw new Error(`Page '${id}' not found`);
    }

    return { success: true, id };
  }

  private slugify(value: string): string {
    const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new Error('Folder name must contain at least one letter or number');
    return slug;
  }

  private async assertFolder(tenantId: string, folderId: string, client: Pool | PoolClient = pool): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM public.page_nav_folder WHERE tenant_id = $1 AND id = $2`,
      [tenantId, folderId]
    );
    if (!result.rowCount) throw new Error(`Folder '${folderId}' not found`);
  }

  private async routeForFolder(
    client: PoolClient,
    tenantId: string,
    folderId: string | null,
    pageSlug: string
  ): Promise<string> {
    if (!folderId) return `/${pageSlug}`;
    const result = await client.query<{ id: string; parent_id: string | null; slug: string }>(
      `SELECT id, parent_id, slug FROM public.page_nav_folder WHERE tenant_id = $1`,
      [tenantId]
    );
    const byId = new Map(result.rows.map((folder) => [folder.id, folder]));
    const segments: string[] = [];
    let current = byId.get(folderId);
    while (current) {
      segments.unshift(current.slug);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return `/${[...segments, pageSlug].join('/')}`;
  }

  private async rebuildFolderRoutes(client: PoolClient, tenantId: string, folderIds: string[]): Promise<void> {
    if (!folderIds.length) return;
    const pages = await client.query<{ id: string; route: string; nav_folder_id: string }>(
      `SELECT id, route, nav_folder_id FROM public.page_def
       WHERE tenant_id = $1 AND nav_folder_id = ANY($2::varchar[])`,
      [tenantId, folderIds]
    );
    const routes = new Map<string, string>();
    for (const page of pages.rows) {
      routes.set(page.id, await this.routeForFolder(
        client, tenantId, page.nav_folder_id, page.route.split('/').filter(Boolean).pop()!
      ));
    }
    await this.applyRouteChanges(client, tenantId, routes);
  }

  private async applyRouteChanges(client: PoolClient, tenantId: string, changes: Map<string, string>): Promise<void> {
    if (!changes.size) return;
    const current = await client.query<{ id: string; route: string }>(
      `SELECT id, route FROM public.page_def WHERE tenant_id = $1`,
      [tenantId]
    );
    const changedIds = new Set(changes.keys());
    const desired = new Set<string>();
    for (const route of changes.values()) {
      const normalized = route.toLowerCase();
      if (desired.has(normalized)) throw new Error(`Navigation change would create duplicate route '${route}'`);
      desired.add(normalized);
    }
    const occupied = new Map(current.rows.filter((page) => !changedIds.has(page.id)).map((page) => [page.route.toLowerCase(), page.route]));
    for (const route of changes.values()) {
      const conflictingRoute = occupied.get(route.toLowerCase());
      if (conflictingRoute) throw new Error(`Route '${route}' is already in use`);
    }

    for (const id of changes.keys()) {
      const temporaryRoute = `/__nav_move_${crypto.randomBytes(8).toString('hex')}`;
      await client.query(
        `UPDATE public.page_def SET route = $1,
           draft = CASE WHEN draft IS NULL THEN NULL ELSE jsonb_set(draft, '{route}', to_jsonb($2::text), true) END,
           published = CASE WHEN published IS NULL THEN NULL ELSE jsonb_set(published, '{route}', to_jsonb($3::text), true) END
         WHERE tenant_id = $4 AND id = $5`,
        [temporaryRoute, temporaryRoute, temporaryRoute, tenantId, id]
      );
    }
    for (const [id, route] of changes) {
      await client.query(
        `UPDATE public.page_def SET route = $1,
           draft = CASE WHEN draft IS NULL THEN NULL ELSE jsonb_set(draft, '{route}', to_jsonb($2::text), true) END,
           published = CASE WHEN published IS NULL THEN NULL ELSE jsonb_set(published, '{route}', to_jsonb($3::text), true) END,
           version = version + 1, updated_at = NOW()
         WHERE tenant_id = $4 AND id = $5`,
        [route, route, route, tenantId, id]
      );
    }
  }
}

export const pagesService = new PagesService();
