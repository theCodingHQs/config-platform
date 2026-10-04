import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  PageDefinitionSchema,
  migratePageV1toV2,
  type PageDefinition,
  type NodeDefinition,
  type DataSourceDefinition,
} from '@config-platform/schema';
import { erdService } from '../schema/erd-service.js';
import crypto from 'node:crypto';

export interface PageSummary {
  id: string;
  name: string;
  route: string;
  version: number;
  hasDraft: boolean;
  hasPublished: boolean;
  createdAt: string;
  updatedAt: string;
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
              if (!colSet.has(key)) {
                broken.push(`Data source [${ds.id}] filter references missing field '${key}'`);
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
      `SELECT id, name, route, version,
              (draft IS NOT NULL) AS "hasDraft",
              (published IS NOT NULL) AS "hasPublished",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM public.page_def
       WHERE tenant_id = $1
       ORDER BY updated_at DESC`,
      [tenantId]
    );

    return res.rows;
  }

  /**
   * GET /pages/published - Returns published pages for runtime app navigation & rendering
   */
  async listPublishedPages(tenantId: string): Promise<PageDefinition[]> {
    const res = await pool.query<{ published: any }>(
      `SELECT published
       FROM public.page_def
       WHERE tenant_id = $1 AND published IS NOT NULL
       ORDER BY route ASC`,
      [tenantId]
    );

    return res.rows.map((r) => migratePageV1toV2(r.published));
  }

  /**
   * GET /pages/:id - Get page by ID with draft, published, and broken bindings
   */
  async getPage(tenantId: string, id: string): Promise<PageDetail> {
    const res = await pool.query(
      `SELECT id, name, route, draft, published, version,
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
    input: { name: string; route: string; draft?: PageDefinition }
  ): Promise<PageDetail> {
    const id = `p_${crypto.randomBytes(4).toString('hex')}`;
    let formattedRoute = input.route.startsWith('/') ? input.route : `/${input.route}`;

    // Default blank page if no draft provided
    const initialDraft: PageDefinition = input.draft
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

    // Validate PageDefinition schema
    const parsed = PageDefinitionSchema.safeParse(initialDraft);
    if (!parsed.success) {
      throw new Error(`Invalid page definition: ${parsed.error.message}`);
    }

    const res = await pool.query(
      `INSERT INTO public.page_def (id, tenant_id, name, route, draft, published, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, 1, NOW(), NOW())
       RETURNING id, name, route, draft, published, version, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, tenantId, input.name, formattedRoute, JSON.stringify(parsed.data)]
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
      throw new Error(`Version conflict: expected ${input.expectedVersion}, found ${current.version}`);
    }

    const rawDraft = input.draft || current.draft;
    const newDraft = rawDraft ? migratePageV1toV2(rawDraft) : rawDraft;
    const newName = input.name || current.name;
    const newRoute = input.route ? (input.route.startsWith('/') ? input.route : `/${input.route}`) : current.route;

    // Validate PageDefinition schema
    const parsed = PageDefinitionSchema.safeParse(newDraft);
    if (!parsed.success) {
      throw new Error(`Invalid page definition: ${parsed.error.message}`);
    }

    const res = await pool.query(
      `UPDATE public.page_def
       SET name = $1, route = $2, draft = $3, version = version + 1, updated_at = NOW()
       WHERE tenant_id = $4 AND id = $5
       RETURNING id, name, route, draft, published, version,
                 (draft IS NOT NULL) AS "hasDraft",
                 (published IS NOT NULL) AS "hasPublished",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [newName, newRoute, JSON.stringify(parsed.data), tenantId, id]
    );

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
      throw new Error(`Cannot publish invalid page: ${parsed.error.message}`);
    }

    const res = await pool.query(
      `UPDATE public.page_def
       SET published = $1, version = version + 1, updated_at = NOW()
       WHERE tenant_id = $2 AND id = $3
       RETURNING id, name, route, draft, published, version,
                 (draft IS NOT NULL) AS "hasDraft",
                 (published IS NOT NULL) AS "hasPublished",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [JSON.stringify(parsed.data), tenantId, id]
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
}

export const pagesService = new PagesService();
