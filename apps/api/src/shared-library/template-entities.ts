/**
 * Page and export templates are built on the publishing workspace's entities and fields. Publishing
 * records which ones a layout uses; using it in a workspace points them at that workspace's own
 * entities (chosen by the person) and fields (matched by name, then label).
 */
import type { TemplateContent, TemplateEntity, UsedTemplate } from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { LiveSettingsError } from '../live/live-errors.js';
import { deepWalkRemap } from '../workspace/export-import-service.js';

/** The workspace's entities with their fields */
export async function workspaceEntities(tenantId: string): Promise<TemplateEntity[]> {
  const res = await pool.query<{ id: string; name: string; label: string; field_id: string | null; field_name: string | null; field_label: string | null; field_type: string | null }>(
    `SELECT e.id, e.name, e.label, f.id AS field_id, f.name AS field_name, f.label AS field_label, f.type AS field_type
     FROM public.entity_def e LEFT JOIN public.field_def f ON f.entity_id = e.id
     WHERE e.tenant_id = $1 ORDER BY e.name, f.position`,
    [tenantId],
  );
  const byId = new Map<string, TemplateEntity>();
  for (const r of res.rows) {
    const entity = byId.get(r.id) ?? { id: r.id, name: r.name, label: r.label, fields: [] };
    byId.set(r.id, entity);
    if (r.field_id) entity.fields.push({ id: r.field_id, name: r.field_name ?? '', label: r.field_label ?? '', type: r.field_type ?? '' });
  }
  return [...byId.values()];
}

/** The entities a layout refers to (by their own id or one of their fields'), each with only the fields it uses */
export async function entitiesUsedBy(tenantId: string, definition: unknown, alsoEntityId?: string): Promise<TemplateEntity[]> {
  const text = JSON.stringify(definition);
  const used: TemplateEntity[] = [];
  for (const e of await workspaceEntities(tenantId)) {
    const fields = e.fields.filter((f) => text.includes(f.id));
    if (e.id === alsoEntityId || text.includes(e.id) || fields.length) used.push({ ...e, fields });
  }
  return used;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The layout pointed at this workspace's entities. `entityMap` chooses the stand-in for each of the
 * template's entities; one this workspace already has (the one it was published from) needs none.
 */
export async function remapTemplate(tenantId: string, content: TemplateContent, entityMap: Record<string, string>, primaryEntityId?: string): Promise<UsedTemplate & { entityId?: string }> {
  const local = new Map((await workspaceEntities(tenantId)).map((e) => [e.id, e]));
  const idMap = new Map<string, string>();
  const missingFields: string[] = [];
  const unchosen: string[] = [];

  for (const source of content.entities) {
    const target = local.get(entityMap[source.id] ?? source.id);
    if (!target) {
      unchosen.push(source.label);
      continue;
    }
    if (target.id !== source.id) idMap.set(source.id, target.id);
    for (const field of source.fields) {
      const match = target.fields.find((f) => sameText(f.name, field.name)) ?? target.fields.find((f) => sameText(f.label, field.label));
      if (!match) missingFields.push(`${target.label} → ${field.label}`);
      else if (match.id !== field.id) idMap.set(field.id, match.id);
    }
  }
  if (unchosen.length) throw new LiveSettingsError(`Choose which of your entities to use for ${unchosen.map((l) => `"${l}"`).join(', ')}`);

  return {
    definition: idMap.size ? deepWalkRemap(content.definition, idMap) : content.definition,
    missingFields,
    ...(primaryEntityId ? { entityId: idMap.get(primaryEntityId) ?? primaryEntityId } : {}),
  };
}
