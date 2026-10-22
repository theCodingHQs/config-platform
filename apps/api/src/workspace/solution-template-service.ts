import {
  createTemplatePage,
  isSampleRef,
  SOLUTION_TEMPLATES,
  buildExecutiveReportTemplate,
  type ErdTable,
  type SolutionEntitySpec,
  type SolutionTemplate,
} from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { entityCache, type ResolvedEntity } from '../records/entity-cache.js';
import { recordsService } from '../records/records-service.js';
import { migrationService } from '../migrations/migration-service.js';
import { pagesService } from '../pages/pages-service.js';
import { exportTemplateService } from '../records/export/export-template-service.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { seedProductionTracker } from '../scripts/seed-production-tracker.js';
import { seedProductionPages } from '../scripts/seed-production-pages.js';

export class SolutionTemplateError extends Error {
  constructor(public statusCode: 404 | 409, message: string) {
    super(message);
    this.name = statusCode === 404 ? 'Not Found' : 'Conflict';
  }
}

export interface InstallResult {
  templateId: string;
  entities: Array<{ id: string; label: string; reused: boolean }>;
  pages: Array<{ id: string; name: string; route: string }>;
  reports: Array<{ id: string; name: string }>;
  sampleRecords: number;
  warnings: string[];
}

/** Gallery cards: what each template is and what it adds. */
export function listSolutionTemplates() {
  return SOLUTION_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.summary,
    description: t.description,
    icon: t.icon,
    folder: t.folder,
    entities: t.entities.map((e) => e.label),
    pages: t.custom ? ['Production Dashboard', 'Machines', 'Production Sheets', 'Machine Performance'] : t.pages.map((p) => p.title),
    reports: t.custom ? ['Production Target Tracker'] : t.reports.map((r) => r.name),
    hasSampleData: Boolean(t.sampleData || t.custom),
  }));
}

class SolutionTemplateService {
  async install(tenantId: string, templateId: string, opts: { sampleData: boolean; today?: Date }): Promise<InstallResult> {
    const template = SOLUTION_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new SolutionTemplateError(404, `Unknown template '${templateId}'`);
    const today = opts.today ?? new Date();
    if (template.custom === 'production-tracker') return this.installProductionTracker(tenantId, template, today);

    const result: InstallResult = { templateId, entities: [], pages: [], reports: [], sampleRecords: 0, warnings: [] };

    // Refuse before creating anything if the template's own entities already exist
    for (const spec of template.entities.filter((e) => !e.shared)) {
      if (await this.entityByName(tenantId, spec.name)) {
        throw new SolutionTemplateError(409, `${template.name} is already installed (the entity '${spec.label}' exists).`);
      }
    }

    // 1. Entities (shared ones reused), in order so links point at entities that exist
    const byKey = new Map<string, ResolvedEntity>();
    const reused = new Set<string>();
    for (const spec of template.entities) {
      const existing = spec.shared ? await this.entityByName(tenantId, spec.name) : null;
      if (existing) {
        await this.ensureFields(tenantId, existing, spec);
        byKey.set(spec.key, (await this.entityByName(tenantId, spec.name))!);
        reused.add(spec.key);
        result.entities.push({ id: existing.entity.id, label: existing.entity.label, reused: true });
        continue;
      }
      await tenantLimitsService.checkEntityLimit(tenantId);
      const created = await migrationService.createEntity(tenantId, {
        name: spec.name,
        label: spec.label,
        icon: spec.icon,
        fields: spec.fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: Boolean(f.required),
          unique: false,
          config: { ...(f.config ?? {}), ...(f.link ? { targetEntityId: byKey.get(f.link)!.entity.id } : {}) },
        })),
      } as any);
      const resolved = await entityCache.resolveEntity(tenantId, created.entity.id);
      await this.finishEntity(tenantId, resolved, spec);
      byKey.set(spec.key, await entityCache.resolveEntity(tenantId, created.entity.id));
      result.entities.push({ id: created.entity.id, label: spec.label, reused: false });
    }

    // 2. Sample data
    if (opts.sampleData && template.sampleData) {
      const samples = template.sampleData(today);
      const idsByKey = new Map<string, string[]>();
      for (const spec of template.entities) {
        const entity = byKey.get(spec.key)!;
        // A reused entity keeps its own records; samples link to those instead
        if (!(reused.has(spec.key) && (await this.recordIds(tenantId, entity)).length > 0)) {
          for (const row of samples[spec.key] ?? []) {
            const values = Object.fromEntries(
              Object.entries(row).map(([field, value]) => {
                if (!isSampleRef(value)) return [field, value];
                const targets = idsByKey.get(value.$ref) ?? [];
                return [field, targets.length ? targets[value.index % targets.length] : null];
              }),
            );
            try {
              await recordsService.createRecord(tenantId, entity.entity.id, values);
              result.sampleRecords++;
            } catch (err: any) {
              result.warnings.push(`A sample ${spec.label} wasn't added: ${err.message}`);
            }
          }
        }
        idsByKey.set(spec.key, await this.recordIds(tenantId, entity));
      }
    }

    // 3. Pages in the template's sidebar group, published
    if (template.pages.length) {
      const folder = await this.folder(tenantId, template.folder);
      for (const pageSpec of template.pages) {
        const entity = byKey.get(pageSpec.entity)!;
        const route = `/${folder.slug}/${pageSpec.slug}`;
        try {
          const erd = this.toErd(entity);
          const columnIds = template.entities
            .find((e) => e.key === pageSpec.entity)!
            .tableColumns.map((name) => entity.fieldByName.get(name)?.id)
            .filter((id): id is string => Boolean(id));
          const page = await pagesService.createPage(tenantId, {
            name: pageSpec.title,
            route,
            folderId: folder.id,
            draft: createTemplatePage('CRUD list', `p_${entity.entity.name}`, route, erd, { title: pageSpec.title, tableColumns: columnIds }),
          });
          await pagesService.publishPage(tenantId, page.id);
          result.pages.push({ id: page.id, name: pageSpec.title, route });
        } catch (err: any) {
          result.warnings.push(`The page '${pageSpec.title}' wasn't created: ${err.message}`);
        }
      }
    }

    // 4. Excel reports
    for (const reportSpec of template.reports) {
      const entity = byKey.get(reportSpec.entity)!;
      try {
        const report = await exportTemplateService.createTemplate(tenantId, {
          name: reportSpec.name,
          entityId: entity.entity.id,
          draft: buildExecutiveReportTemplate(this.toErd(entity)),
        });
        result.reports.push({ id: report.id, name: reportSpec.name });
      } catch (err: any) {
        result.warnings.push(`The report '${reportSpec.name}' wasn't created: ${err.message}`);
      }
    }
    return result;
  }

  /** The Production Tracker has its own set-up routines (entities, sample sheets, pages, tracker). */
  private async installProductionTracker(tenantId: string, template: SolutionTemplate, today: Date): Promise<InstallResult> {
    if (await this.entityByName(tenantId, 'production_sheet')) {
      throw new SolutionTemplateError(409, `${template.name} is already installed (the entity 'Production Sheet' exists).`);
    }
    const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const seeded = await seedProductionTracker(tenantId, {
      months: [ym(new Date(today.getFullYear(), today.getMonth() - 1, 1)), ym(today)],
      today,
    });
    const pages = await seedProductionPages(tenantId, { today });
    const machine = await this.entityByName(tenantId, 'machine');
    const sheet = await this.entityByName(tenantId, 'production_sheet');
    return {
      templateId: template.id,
      entities: [machine, sheet].filter(Boolean).map((e) => ({ id: e!.entity.id, label: e!.entity.label, reused: false })),
      pages: pages.pages.map((p) => ({ id: p.id, name: p.route, route: p.route })),
      reports: seeded.templateId ? [{ id: seeded.templateId, name: 'Production Target Tracker' }] : [],
      sampleRecords: seeded.sheetsCreated + seeded.machinesCreated,
      warnings: [],
    };
  }

  /** A reused shared entity gets the template's fields it lacks (never changes existing ones). */
  private async ensureFields(tenantId: string, existing: ResolvedEntity, spec: SolutionEntitySpec) {
    for (const field of spec.fields) {
      if (existing.fieldByName.has(field.name) || field.link) continue;
      await migrationService.addField(tenantId, {
        entityId: existing.entity.id,
        expectedVersion: await this.version(tenantId, existing.entity.id),
        name: field.name,
        label: field.label,
        type: field.type,
        required: false,
        unique: false,
        config: field.config ?? {},
      } as any);
    }
  }

  /** Display field and duplicate rules of a newly created entity. */
  private async finishEntity(tenantId: string, entity: ResolvedEntity, spec: SolutionEntitySpec) {
    const displayFieldId = entity.fieldByName.get(spec.displayField)?.id;
    if (displayFieldId) {
      await migrationService.updateEntity(tenantId, {
        entityId: entity.entity.id,
        expectedVersion: await this.version(tenantId, entity.entity.id),
        displayFieldId,
      } as any);
    }
    if (spec.uniqueRules?.length) {
      await migrationService.setUniqueRules(tenantId, {
        entityId: entity.entity.id,
        expectedVersion: await this.version(tenantId, entity.entity.id),
        rules: spec.uniqueRules.map((names) => ({ fields: names.map((n) => entity.fieldByName.get(n)!.id) })),
      });
    }
  }

  private async folder(tenantId: string, name: string) {
    const navigation = await pagesService.getNavigation(tenantId);
    const existing = navigation.folders.find((f) => !f.parentId && f.name.toLowerCase() === name.toLowerCase());
    return existing ?? pagesService.createFolder(tenantId, { name });
  }

  private toErd(entity: ResolvedEntity): ErdTable {
    return {
      id: entity.entity.id,
      name: entity.entity.name,
      label: entity.entity.label,
      physicalTableName: entity.entity.physicalTableName,
      version: entity.entity.version,
      columns: entity.fields.map((f) => ({ ...f, isPrimary: false, isForeignKey: f.type === 'reference' })) as any,
    };
  }

  private async entityByName(tenantId: string, name: string): Promise<ResolvedEntity | null> {
    const res = await pool.query(`SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`, [tenantId, name]);
    return res.rows[0] ? entityCache.resolveEntity(tenantId, res.rows[0].id) : null;
  }

  private async recordIds(tenantId: string, entity: ResolvedEntity): Promise<string[]> {
    const display = entity.fieldByName.get('name') ?? entity.fields[0];
    const page = await recordsService.getRecords(tenantId, entity.entity.id, { limit: '100', sort: display?.name ?? 'id' });
    return page.data.map((r) => String(r.id));
  }

  private async version(tenantId: string, entityId: string): Promise<number> {
    return (await pool.query(`SELECT version FROM public.entity_def WHERE id = $1`, [entityId])).rows[0].version;
  }
}

export const solutionTemplateService = new SolutionTemplateService();
