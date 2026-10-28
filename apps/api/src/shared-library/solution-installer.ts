/**
 * Installing a shared solution into a workspace. Entities whose name the workspace already uses
 * wait for the person to choose: use the workspace's own (adding the solution's fields it
 * lacks, as many as they tick) or make a new one under another name. Then, in order: the fields
 * added to existing entities, the new entities with the pages, and the export templates, pointed
 * at whichever entities and fields took each place.
 */
import { InstallSolutionInputSchema, type EntityChoice, type InstallPlan, type InstallResult, type SolutionContent, type SolutionField } from '@config-platform/schema';
import type { SessionPayload } from '../auth/auth-types.js';
import { pool } from '../db/pool.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { LiveSettingsError } from '../live/live-errors.js';
import { migrationService } from '../migrations/migration-service.js';
import { exportTemplateService } from '../records/export/export-template-service.js';
import { generateColumnId, generateTableId } from '../utils/id-gen.js';
import { deepWalkRemap, exportImportService, type WorkspaceBundle } from '../workspace/export-import-service.js';
import { workspaceEntities } from './template-entities.js';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A lower-case name for a new entity, from its label */
const nameFrom = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'entity';

export async function installPlan(tenantId: string, content: SolutionContent): Promise<InstallPlan> {
  const local = await workspaceEntities(tenantId);
  return {
    entities: content.entities.map((e) => {
      const match = local.find((l) => same(l.name, e.name));
      return {
        id: e.id,
        name: e.name,
        label: e.label,
        fieldCount: e.fields.length,
        existing: match ? { id: match.id, label: match.label, missingFields: e.fields.filter((f) => !match.fields.some((m) => same(m.name, f.name))).map((f) => ({ id: f.id, label: f.label })) } : null,
      };
    }),
    pages: content.pages.map((p) => p.name),
    exportTemplates: content.exportTemplates.map((t) => t.name),
  };
}

/** Routes the workspace already uses get "-2", "-3"… */
async function freeRoutes(tenantId: string, routes: string[]): Promise<string[]> {
  const res = await pool.query<{ route: string }>('SELECT route FROM public.page_def WHERE tenant_id = $1', [tenantId]);
  const taken = new Set(res.rows.map((r) => r.route));
  return routes.map((route) => {
    let candidate = route;
    for (let n = 2; taken.has(candidate); n++) candidate = `${route}-${n}`;
    taken.add(candidate);
    return candidate;
  });
}

/** `dryRun` checks everything the import would refuse (names, routes, plan limits) without changing anything */
async function importOrFail(tenantId: string, bundle: WorkspaceBundle, session: SessionPayload | undefined, dryRun = false) {
  const result = await exportImportService.importBundle(tenantId, bundle, dryRun, session);
  if (!result.success) throw new LiveSettingsError(`It couldn't be installed: ${result.conflicts.join(' ')}`, 409);
}

type LocalEntities = Map<string, Awaited<ReturnType<typeof workspaceEntities>>[number]>;

interface Decided {
  /** The solution's entity and field ids → the ids they'll have here */
  idMap: Map<string, string>;
  created: SolutionContent['entities'];
  toAdd: Array<{ entityId: string; field: SolutionField }>;
  result: InstallResult;
}

/** Where each of the solution's entities goes: onto one of the workspace's own (as chosen), or in as a new one */
function decide(content: SolutionContent, choices: Record<string, EntityChoice>, local: LocalEntities): Decided {
  const localNames = [...local.values()].map((e) => e.name);
  const decided: Decided = { idMap: new Map(), created: [], toAdd: [], result: { created: [], reused: [], pages: [], exportTemplates: [], missingFields: [] } };
  const undecided: string[] = [];

  for (const e of content.entities) {
    const choice = choices[e.id];
    if (choice?.action === 'reuse') {
      reuse(e, choice, local, decided);
    } else if (!choice && localNames.some((n) => same(n, e.name))) {
      undecided.push(e.label);
    } else {
      const label = choice?.action === 'create' ? choice.label : e.label;
      const name = choice?.action === 'create' ? nameFrom(label) : e.name;
      if (choice && localNames.some((n) => same(n, name))) throw new LiveSettingsError(`There's already an entity called "${name}". Choose another name for "${e.label}".`);
      // New ids now, so everything pointing at this entity can be pointed at it before it's imported
      decided.idMap.set(e.id, generateTableId());
      for (const f of e.fields) decided.idMap.set(f.id, generateColumnId());
      decided.created.push({ ...e, name, label });
      decided.result.created.push(label);
    }
  }
  if (undecided.length) throw new LiveSettingsError(`Choose what to do with ${undecided.map((l) => `"${l}"`).join(', ')}: your workspace already has an entity with that name.`);
  return decided;
}

/** The solution's entity onto the workspace's: same-named fields line up, ticked ones get added, the rest are missing */
function reuse(e: SolutionContent['entities'][number], choice: Extract<EntityChoice, { action: 'reuse' }>, local: LocalEntities, decided: Decided) {
  const target = local.get(choice.entityId);
  if (!target) throw new LiveSettingsError(`Entity "${choice.entityId}" not found`, 404);
  decided.idMap.set(e.id, target.id);
  for (const f of e.fields) {
    const match = target.fields.find((m) => same(m.name, f.name));
    if (match) decided.idMap.set(f.id, match.id);
    else if (choice.addFields?.includes(f.id)) decided.toAdd.push({ entityId: target.id, field: f });
    else decided.result.missingFields.push(`${target.label} → ${f.label}`);
  }
  decided.result.reused.push(target.label);
}

export async function installSolution(tenantId: string, content: SolutionContent, body: unknown, session?: SessionPayload): Promise<InstallResult> {
  const parsed = InstallSolutionInputSchema.safeParse(body ?? {});
  if (!parsed.success) throw new LiveSettingsError(parsed.error.issues.map((i) => i.message).join('; '));
  const local: LocalEntities = new Map((await workspaceEntities(tenantId)).map((e) => [e.id, e]));
  const { idMap, created, toAdd, result } = decide(content, parsed.data.choices, local);

  const exportedAt = new Date().toISOString();
  const ids = new Set(created.map((e) => e.id));
  const relations = content.relations.filter((r) => ids.has(r.sourceEntityId) && ids.has(r.targetEntityId));
  const routes = await freeRoutes(tenantId, content.pages.map((p) => p.route));
  const pages = content.pages.map((p, i) => ({ id: `p_${generateTableId().slice(2)}`, name: p.name, route: routes[i], draft: { ...(p.draft as object), route: routes[i] }, published: p.published ? { ...(p.published as object), route: routes[i] } : undefined }));
  const bundle = (withPages: boolean): WorkspaceBundle => deepWalkRemap({ bundleVersion: 2, exportedAt, entities: created, relations, pages: withPages ? pages : [] } as WorkspaceBundle, idMap);

  // Name clashes and plan limits are found before anything changes (pages are checked against the
  // entities they're imported with, so they're checked as they go in)
  if (created.length) await importOrFail(tenantId, bundle(false), session, true);
  if (pages.length) {
    const { plan, limits } = await tenantLimitsService.getTenantPlan(tenantId);
    const current = (await pool.query('SELECT 1 FROM public.page_def WHERE tenant_id = $1', [tenantId])).rowCount ?? 0;
    if (current + pages.length > limits.maxPages) {
      throw new LiveSettingsError(`It adds ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}, and the ${plan} plan allows ${limits.maxPages} (you have ${current}).`, 409);
    }
  }

  // 1. The ticked fields, on entities the workspace already had. Links to entities the solution is
  // about to create wait until those exist.
  const isNew = (field: SolutionField) => ids.has(String((field.config as { targetEntityId?: unknown })?.targetEntityId ?? ''));
  const addField = async ({ entityId, field }: { entityId: string; field: SolutionField }) => {
    const version = (await pool.query<{ version: number }>('SELECT version FROM public.entity_def WHERE id = $1', [entityId])).rows[0]?.version ?? 1;
    const added = await migrationService.addField(tenantId, {
      entityId,
      expectedVersion: version,
      name: field.name,
      label: field.label,
      type: field.type as never,
      required: false,
      unique: false,
      config: deepWalkRemap(field.config ?? {}, idMap) as never,
    });
    idMap.set(field.id, added.field.id);
  };
  for (const add of toAdd.filter((a) => !isNew(a.field))) await addField(add);

  // 2. The new entities and the pages together, all or nothing
  if (created.length || pages.length) {
    const installed = bundle(true);
    await importOrFail(tenantId, installed, session);
    result.pages = installed.pages.map((p) => ({ name: p.name, route: p.route }));
  }
  for (const add of toAdd.filter((a) => isNew(a.field))) await addField(add);

  // 3. Export templates, on whichever entities and fields took each place
  for (const t of content.exportTemplates) {
    const saved = await exportTemplateService.createTemplate(tenantId, { name: t.name, entityId: idMap.get(t.entityId) ?? t.entityId, draft: deepWalkRemap(t.draft, idMap) });
    if (t.published) await exportTemplateService.publishTemplate(tenantId, saved.id);
    result.exportTemplates.push(t.name);
  }
  return result;
}
