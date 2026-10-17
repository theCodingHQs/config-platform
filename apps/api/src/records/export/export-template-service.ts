import { pool } from '../../db/pool.js';
import {
  ExportTemplateDefinitionSchema,
  GridExportTemplateDefinitionSchema,
  SimpleExportTemplateDefinitionSchema,
  type ExportTemplate,
  type SimpleExportTemplateDefinition,
} from '@config-platform/schema';
import { generateExportTemplateId } from '../../utils/id-gen.js';
import { entityCache } from '../entity-cache.js';
import { permissionService } from '../../permissions/permission-service.js';
import { queryBuilder } from '../query-builder.js';
import { defaultStorageAdapter } from '../../db/storage-adapter.js';
import type { TenantRole } from '../../auth/auth-types.js';

export class ExportTemplateService {
  async listTemplates(tenantId: string, entityId?: string): Promise<ExportTemplate[]> {
    const conditions = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (entityId) {
      params.push(entityId);
      conditions.push(`entity_id = $${params.length}`);
    }

    const query = `
      SELECT id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at
      FROM public.export_template
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC;
    `;

    const res = await pool.query(query, params);
    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    }));
  }

  async getTemplate(tenantId: string, id: string): Promise<ExportTemplate> {
    const res = await pool.query(
      `SELECT id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at
       FROM public.export_template
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, id]
    );

    if (res.rows.length === 0) {
      const err = new Error(`Export template '${id}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async createTemplate(
    tenantId: string,
    input: { name: string; entityId: string; draft?: any }
  ): Promise<ExportTemplate> {
    const resolved = await entityCache.resolveEntity(tenantId, input.entityId);
    if (!resolved) {
      const err = new Error(`Entity '${input.entityId}' not found`);
      (err as any).statusCode = 404;
      throw err;
    }

    // Default draft if none provided
    const defaultDraft: SimpleExportTemplateDefinition = {
      kind: 'simple',
      columns: resolved.fields.map((f: any) => ({
        fieldId: f.id,
        header: f.label || f.name,
        format: f.type === 'date' ? 'date_iso' : 'text',
      })),
      defaultSort: [],
      defaultFilters: [],
      includeHeader: true,
      csv: { delimiter: ',', bom: false },
      filenameExpression: '',
      pdf: { mode: 'table' },
    };

    let parsedDraft: any;
    try {
      if (input.draft?.kind === 'grid') {
        parsedDraft = GridExportTemplateDefinitionSchema.parse(input.draft);
      } else {
        parsedDraft = ExportTemplateDefinitionSchema.parse(input.draft || defaultDraft);
      }
    } catch (err: any) {
      if (err.name === 'ZodError' || err.issues) {
        const msg = err.issues?.map((i: any) => i.message).join('; ') || err.message;
        const e = new Error(msg);
        (e as any).statusCode = 400;
        throw e;
      }
      throw err;
    }

    if (parsedDraft.kind === 'grid') {
      await this.validateGridBindings(tenantId, parsedDraft);
    }

    const id = generateExportTemplateId();

    const res = await pool.query(
      `INSERT INTO public.export_template (id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, 1, NOW(), NOW())
       RETURNING id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at;`,
      [id, tenantId, resolved.entity.id, input.name.trim(), JSON.stringify(parsedDraft)]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async validateGridBindings(tenantId: string, draft: any): Promise<void> {
    if (!draft || draft.kind !== 'grid' || !Array.isArray(draft.sheets)) return;

    const datasetsMap = new Map<string, any>();
    const datasetFieldSets = new Map<string, Set<string>>();
    const datasetAggregateSets = new Map<string, Set<string>>();
    const parameterIds = new Set<string>();

    if (Array.isArray(draft.parameters)) {
      for (const p of draft.parameters) {
        if (p?.id) parameterIds.add(p.id);
        if (p?.name) parameterIds.add(p.name);
      }
    }

    if (Array.isArray(draft.datasets)) {
      for (const ds of draft.datasets) {
        if (!ds || !ds.id) continue;
        datasetsMap.set(ds.id, ds);

        const fieldSet = new Set<string>();
        const aggSet = new Set<string>();

        // 1. Validate base entity
        const baseEntityId = ds.source?.baseEntityId;
        if (!baseEntityId) {
          const err = new Error(`Dataset '${ds.name || ds.id}' is missing baseEntityId`);
          (err as any).statusCode = 400;
          throw err;
        }

        const baseResolved = await entityCache.resolveEntity(tenantId, baseEntityId);
        if (!baseResolved) {
          const err = new Error(
            `Dataset '${ds.name || ds.id}' references unknown entity '${baseEntityId}'`
          );
          (err as any).statusCode = 400;
          throw err;
        }

        // 2. Validate joins (max 4)
        const joins = ds.source?.joins || [];
        if (joins.length > 4) {
          const err = new Error(`Dataset '${ds.name || ds.id}' exceeds maximum 4 joins`);
          (err as any).statusCode = 400;
          throw err;
        }

        const aliasToEntity = new Map<string, any>();
        aliasToEntity.set('t0', baseResolved);
        aliasToEntity.set(baseResolved.entity.name.toLowerCase(), baseResolved);
        aliasToEntity.set(baseResolved.entity.id, baseResolved);

        for (let i = 0; i < joins.length; i++) {
          const j = joins[i];
          const parentAlias = j.parentJoinId || 't0';
          const parent = aliasToEntity.get(parentAlias) || baseResolved;

          const refField =
            parent.fieldById?.get(j.referenceFieldId) ||
            parent.fieldByName?.get(j.referenceFieldId) ||
            parent.fields?.find((f: any) => f.id === j.referenceFieldId || f.name === j.referenceFieldId);

          if (!refField) {
            const err = new Error(
              `Join references unknown reference field '${j.referenceFieldId}' on entity '${parent.entity.name}' in dataset '${ds.name || ds.id}'`
            );
            (err as any).statusCode = 400;
            throw err;
          }

          if (refField.type !== 'reference') {
            const err = new Error(
              `Field '${refField.name}' is not a reference field on entity '${parent.entity.name}' in dataset '${ds.name || ds.id}'`
            );
            (err as any).statusCode = 400;
            throw err;
          }

          const targetEntId = j.targetEntityId || refField.config?.targetEntityId;
          const targetResolved = targetEntId
            ? await entityCache.resolveEntity(tenantId, targetEntId)
            : null;

          if (!targetResolved) {
            const err = new Error(
              `Join references unknown target entity '${targetEntId}' in dataset '${ds.name || ds.id}'`
            );
            (err as any).statusCode = 400;
            throw err;
          }

          const joinAlias = `j${i + 1}`;
          aliasToEntity.set(joinAlias, targetResolved);
          if (j.id) aliasToEntity.set(j.id, targetResolved);
          if (j.name) aliasToEntity.set(j.name.toLowerCase(), targetResolved);
          aliasToEntity.set(targetResolved.entity.name.toLowerCase(), targetResolved);
          aliasToEntity.set(targetResolved.entity.id, targetResolved);
        }

        // 3. Collect & validate fields
        for (const f of ds.fields || []) {
          fieldSet.add(f.id);
          if (f.name) fieldSet.add(f.name);
          if (f.fieldPath) fieldSet.add(f.fieldPath);
        }

        // 4. Collect aggregates
        for (const a of ds.aggregates || []) {
          aggSet.add(a.id);
          if (a.name) aggSet.add(a.name);
        }

        datasetFieldSets.set(ds.id, fieldSet);
        datasetAggregateSets.set(ds.id, aggSet);
      }
    }

    for (const sheet of draft.sheets) {
      if (sheet.cells) {
        for (const [coord, cell] of Object.entries(sheet.cells)) {
          const binding = (cell as any)?.binding;
          if (binding && typeof binding === 'object') {
            const { entityId, fieldId, datasetId, aggregateId, parameterId } = binding;

            if (datasetId) {
              if (!datasetsMap.has(datasetId)) {
                const err = new Error(
                  `Binding references unknown dataset '${datasetId}' at cell ${coord}`
                );
                (err as any).statusCode = 400;
                throw err;
              }
              if (aggregateId) {
                const aggs = datasetAggregateSets.get(datasetId);
                if (!aggs || !aggs.has(aggregateId)) {
                  const err = new Error(
                    `Binding references unknown aggregate '${aggregateId}' on dataset '${datasetId}' at cell ${coord}`
                  );
                  (err as any).statusCode = 400;
                  throw err;
                }
              }
            } else if (parameterId) {
              if (!parameterIds.has(parameterId)) {
                const err = new Error(
                  `Binding references unknown parameter '${parameterId}' at cell ${coord}`
                );
                (err as any).statusCode = 400;
                throw err;
              }
            } else if (entityId) {
              const resolved = await entityCache.resolveEntity(tenantId, entityId);
              if (!resolved) {
                const err = new Error(`Binding references unknown entity '${entityId}' at cell ${coord}`);
                (err as any).statusCode = 400;
                throw err;
              }
              if (fieldId) {
                const fieldExists = resolved.fields.some((f) => f.id === fieldId);
                if (!fieldExists) {
                  const err = new Error(
                    `Binding references unknown field '${fieldId}' on entity '${resolved.entity.name}' at cell ${coord}`
                  );
                  (err as any).statusCode = 400;
                  throw err;
                }
              }
            }
          }
        }
      }

      if (Array.isArray(sheet.regions)) {
        for (const region of sheet.regions) {
          if (region.datasetId) {
            if (!datasetsMap.has(region.datasetId)) {
              const err = new Error(
                `Region references unknown dataset '${region.datasetId}' in region '${region.id}'`
              );
              (err as any).statusCode = 400;
              throw err;
            }
          } else if (region.entityId) {
            const resolved = await entityCache.resolveEntity(tenantId, region.entityId);
            if (!resolved) {
              const err = new Error(
                `Region references unknown entity '${region.entityId}' in region '${region.id}'`
              );
              (err as any).statusCode = 400;
              throw err;
            }
            if (Array.isArray(region.columns)) {
              for (const col of region.columns) {
                if (col.fieldId) {
                  const fieldExists = resolved.fields.some((f) => f.id === col.fieldId);
                  if (!fieldExists) {
                    const err = new Error(
                      `Region column references unknown field '${col.fieldId}' on entity '${resolved.entity.name}' in region '${region.id}'`
                    );
                    (err as any).statusCode = 400;
                    throw err;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (Array.isArray(draft.charts)) {
      if (draft.charts.length > 20) {
        const err = new Error(`Template exceeds maximum limit of 20 charts (current: ${draft.charts.length})`);
        (err as any).statusCode = 400;
        throw err;
      }

      const sheetIds = new Set(draft.sheets.map((s: any) => s.id));
      const sheetNames = new Set(draft.sheets.map((s: any) => s.name));

      for (const ch of draft.charts) {
        if (!ch.anchor || (!sheetIds.has(ch.anchor.sheetId) && !sheetNames.has(ch.anchor.sheetId))) {
          const err = new Error(`Chart '${ch.title || ch.id}' references unknown sheet '${ch.anchor?.sheetId}'`);
          (err as any).statusCode = 400;
          throw err;
        }

        if (ch.source?.kind === 'dataset') {
          const dsId = ch.source.datasetId;
          if (!datasetsMap.has(dsId)) {
            const err = new Error(`Chart '${ch.title || ch.id}' references unknown dataset '${dsId}'`);
            (err as any).statusCode = 400;
            throw err;
          }
          const fSet = datasetFieldSets.get(dsId) || new Set();
          const aSet = datasetAggregateSets.get(dsId) || new Set();

          const catField = typeof ch.source.category === 'string'
            ? ch.source.category
            : ch.source.category?.fieldId;

          if (!catField || (!fSet.has(catField) && !aSet.has(catField))) {
            const err = new Error(`Chart '${ch.title || ch.id}' category field '${catField}' not found in dataset '${dsId}'`);
            (err as any).statusCode = 400;
            throw err;
          }

          for (const s of ch.source.series || []) {
            const targetId = s.aggregateId || s.fieldId;
            if (!targetId || (!fSet.has(targetId) && !aSet.has(targetId))) {
              const err = new Error(`Chart '${ch.title || ch.id}' series '${s.name || targetId}' field/aggregate '${targetId}' not found in dataset '${dsId}'`);
              (err as any).statusCode = 400;
              throw err;
            }
          }
        } else if (ch.source?.kind === 'range') {
          if (!sheetIds.has(ch.source.sheetId) && !sheetNames.has(ch.source.sheetId)) {
            const err = new Error(`Chart '${ch.title || ch.id}' range source references unknown sheet '${ch.source.sheetId}'`);
            (err as any).statusCode = 400;
            throw err;
          }
          if (!ch.source.series || ch.source.series.length === 0) {
            const err = new Error(`Chart '${ch.title || ch.id}' has no series defined`);
            (err as any).statusCode = 400;
            throw err;
          }
        }
      }
    }
  }

  async updateTemplate(
    tenantId: string,
    id: string,
    input: { name?: string; draft?: any }
  ): Promise<ExportTemplate> {
    const existing = await this.getTemplate(tenantId, id);

    let nextName = existing.name;
    if (input.name !== undefined && input.name.trim()) {
      nextName = input.name.trim();
    }

    let nextDraft = existing.draft;
    if (input.draft !== undefined) {
      try {
        if (input.draft?.kind === 'grid') {
          nextDraft = GridExportTemplateDefinitionSchema.parse(input.draft);
        } else {
          nextDraft = ExportTemplateDefinitionSchema.parse(input.draft);
        }
      } catch (err: any) {
        if (err.name === 'ZodError' || err.issues) {
          const msg = err.issues?.map((i: any) => i.message).join('; ') || err.message;
          const e = new Error(msg);
          (e as any).statusCode = 400;
          throw e;
        }
        throw err;
      }

      if (nextDraft.kind === 'grid') {
        await this.validateGridBindings(tenantId, nextDraft);
      }
    }

    const res = await pool.query(
      `UPDATE public.export_template
       SET name = $1, draft = $2, updated_at = NOW()
       WHERE tenant_id = $3 AND id = $4
       RETURNING id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at;`,
      [nextName, JSON.stringify(nextDraft), tenantId, id]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async deleteTemplate(tenantId: string, id: string): Promise<void> {
    await this.getTemplate(tenantId, id);
    await pool.query(
      `DELETE FROM public.export_template WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, id]
    );
  }

  async publishTemplate(tenantId: string, id: string): Promise<ExportTemplate> {
    const existing = await this.getTemplate(tenantId, id);
    const newVersion = existing.version + 1;

    const res = await pool.query(
      `UPDATE public.export_template
       SET published = draft, version = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND id = $3
       RETURNING id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at;`,
      [newVersion, tenantId, id]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async duplicateTemplate(tenantId: string, id: string): Promise<ExportTemplate> {
    const existing = await this.getTemplate(tenantId, id);
    const newId = generateExportTemplateId();
    const newName = `Copy of ${existing.name}`;

    const res = await pool.query(
      `INSERT INTO public.export_template (id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, 1, NOW(), NOW())
       RETURNING id, tenant_id, entity_id, name, draft, published, version, created_at, updated_at;`,
      [newId, tenantId, existing.entityId, newName, JSON.stringify(existing.draft)]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      name: r.name,
      draft: r.draft,
      published: r.published,
      version: r.version,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }
}

export const exportTemplateService = new ExportTemplateService();
