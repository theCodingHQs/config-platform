/**
 * What a shared solution holds: the entities chosen and every entity they link to, with their
 * fields; and the pages and export templates built only on those entities. Taken from the
 * workspace export, without the workspace's own settings (theme, regional, roles, navigation).
 */
import type { SolutionContent } from '@config-platform/schema';
import { LiveSettingsError } from '../live/live-errors.js';
import { exportImportService } from '../workspace/export-import-service.js';

export async function buildSolution(tenantId: string, entityIds: readonly string[]): Promise<SolutionContent> {
  if (!entityIds.length) throw new LiveSettingsError('Choose at least one entity for the solution');
  const bundle = await exportImportService.exportBundle(tenantId);
  const byId = new Map(bundle.entities.map((e) => [e.id, e]));

  // The chosen entities, and what their link fields point at, however far that goes
  const included = new Set<string>();
  const queue = [...entityIds];
  while (queue.length) {
    const id = queue.pop()!;
    if (included.has(id)) continue;
    const entity = byId.get(id);
    if (!entity) throw new LiveSettingsError(`Entity "${id}" not found`, 404);
    included.add(id);
    for (const f of entity.fields) {
      const target = (f.config as { targetEntityId?: unknown } | null)?.targetEntityId;
      if (f.type === 'reference' && typeof target === 'string') queue.push(target);
    }
  }

  // A page or export belongs only if it's built on these entities and uses nothing outside them
  const outside = bundle.entities.filter((e) => !included.has(e.id)).flatMap((e) => [e.id, ...e.fields.map((f) => f.id)]);
  const usesOutside = (definition: unknown) => {
    const text = JSON.stringify(definition);
    return outside.some((id) => text.includes(id));
  };
  const usesIncluded = (definition: unknown) => {
    const text = JSON.stringify(definition);
    return [...included].some((id) => text.includes(id));
  };

  return {
    entities: bundle.entities
      .filter((e) => included.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, label: e.label, icon: e.icon ?? null, displayFieldId: e.displayFieldId ?? null, uniqueRules: e.uniqueRules ?? [], fields: e.fields })),
    relations: bundle.relations.filter((r) => included.has(r.sourceEntityId) && included.has(r.targetEntityId)),
    pages: bundle.pages.filter((p) => usesIncluded(p.draft) && !usesOutside(p.draft)).map((p) => ({ name: p.name, route: p.route, draft: p.draft, published: p.published ?? undefined })),
    exportTemplates: (bundle.exportTemplates ?? [])
      // An export's own entity is kept beside its layout, not in it
      .filter((t) => included.has(t.entityId) && !usesOutside(t.draft))
      .map((t) => ({ name: t.name, entityId: t.entityId, draft: t.draft, published: t.published ?? undefined })),
  };
}
