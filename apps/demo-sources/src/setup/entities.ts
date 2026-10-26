/**
 * Entities through the schema API: create one if it's missing, add fields that are missing, and
 * leave everything that exists alone (so a re-run never undoes someone's changes).
 */
import type { ApiClient } from './api-client.js';

export interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';
  required?: boolean;
  unique?: boolean;
  config?: Record<string, unknown>;
}

export interface EntityInfo {
  id: string;
  name: string;
  version: number;
  fields: Array<{ id: string; name: string; type: string; config?: Record<string, any> }>;
}

export async function findEntity(api: ApiClient, name: string): Promise<EntityInfo | null> {
  const entities = await api.get<EntityInfo[]>('/schema/entities');
  return entities.find((e) => e.name === name) ?? null;
}

export const select = (...options: Array<[value: string, label: string, color?: string]>) => ({
  options: options.map(([value, label, color]) => ({ value, label, ...(color ? { color } : {}) })),
});

export async function ensureEntity(
  api: ApiClient,
  spec: { name: string; label: string; icon: string; fields: FieldSpec[] },
  log: (line: string) => void,
): Promise<EntityInfo> {
  let entity = await findEntity(api, spec.name);
  if (!entity) {
    const [first, ...rest] = spec.fields;
    await api.post('/schema/entities', { name: spec.name, label: spec.label, icon: spec.icon, fields: [field(first)] });
    log(`+ entity ${spec.label}`);
    entity = (await findEntity(api, spec.name))!;
    spec = { ...spec, fields: rest };
  }
  for (const f of spec.fields) {
    if (entity.fields.some((x) => x.name === f.name)) continue;
    await api.post(`/schema/entities/${entity.id}/fields`, { ...field(f), expectedVersion: entity.version });
    log(`+ field ${spec.label} → ${f.label}`);
    entity = (await findEntity(api, spec.name))!;
  }
  return entity;
}

const field = (f: FieldSpec) => ({ required: false, unique: false, config: {}, ...f });

export const fieldId = (entity: EntityInfo, name: string): string => {
  const f = entity.fields.find((x) => x.name === name);
  if (!f) throw new Error(`${entity.name} has no field ${name}`);
  return f.id;
};
