import type { QueryResultRow } from 'pg';
import {
  calculateRecord,
  formulaReferences,
  planCalculatedFields,
  FormulaError,
  type FieldDef,
  type FormulaField,
} from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { entityCache, type ResolvedEntity } from './entity-cache.js';

/** Rows recalculated per query when a whole entity is backfilled. */
const BATCH_SIZE = 500;
/** Lookup chains (sheet → machine → line …) are followed at most this deep. */
const MAX_PROPAGATION_DEPTH = 3;
/** The formula map of a workspace is reused this long (schema changes rebuild it at once). */
const GRAPH_MAX_AGE_MS = 30_000;

export class CalculatedFieldError extends Error {
  public statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'Unprocessable Entity';
  }
}

export function isCalculatedField(field: Pick<FieldDef, 'config'>): boolean {
  return Boolean((field.config as any)?.formula);
}

/** Which entities have formulas, and which look up records of which (per workspace). */
interface FormulaGraph {
  builtAt: number;
  generation: number;
  /** Entity ids with at least one calculated field */
  calculated: Set<string>;
  /** Target entity id → entities whose formulas look up its records, with the link fields used */
  dependents: Map<string, Array<{ entityId: string; linkNames: string[] }>>;
}

/**
 * Keeps calculated fields (formulas and lookups) up to date. Values are stored in their
 * columns, so tables, filters, sorting, charts and exports all use them like typed-in values.
 */
export class CalculatedFieldsService {
  private graphs = new Map<string, FormulaGraph>();

  /**
   * Validates an entity's formulas as they would be with `fields`, returning them in
   * evaluation order. Throws CalculatedFieldError (422) explaining what's wrong.
   */
  async plan(tenantId: string, fields: FormulaField[]): Promise<FormulaField[]> {
    const targets = new Map<string, FormulaField[]>();
    for (const field of fields) {
      const targetId = (field.config as any)?.targetEntityId;
      if (field.type === 'reference' && targetId && !targets.has(targetId)) {
        try {
          targets.set(targetId, (await entityCache.resolveRecent(tenantId, targetId)).fields);
        } catch {
          // A missing target is reported by the formula check
        }
      }
    }
    try {
      return planCalculatedFields(fields, (link) => targets.get((link.config as any)?.targetEntityId));
    } catch (err) {
      if (err instanceof FormulaError) throw new CalculatedFieldError(err.message);
      throw err;
    }
  }

  /**
   * Recalculates the given records (or all of them) and stores changed values. Then refreshes
   * records in other entities that look these up (e.g. sheets showing a renamed machine).
   * Returns how many records changed in this entity. Does no database work for entities that
   * have no formulas and that nothing looks up.
   */
  async recalculate(tenantId: string, entityIdOrName: string, ids?: string[], depth = 0): Promise<number> {
    const graph = await this.graph(tenantId);
    if (graph.calculated.size === 0) return 0;
    const resolved = await entityCache.resolveRecent(tenantId, entityIdOrName);
    const entityId = resolved.entity.id;
    const hasFormulas = graph.calculated.has(entityId);
    const dependents = graph.dependents.get(entityId) ?? [];
    if (!hasFormulas && dependents.length === 0) return 0;

    let changed = 0;
    if (hasFormulas) {
      const ordered = await this.plan(tenantId, resolved.fields);
      if (ids) {
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          changed += await this.recalculateRows(tenantId, resolved, ordered, ids.slice(i, i + BATCH_SIZE));
        }
      } else {
        let afterId = '';
        for (;;) {
          const page = await this.query<{ id: string }>(
            tenantId,
            `SELECT id FROM ${this.table(tenantId, resolved)} WHERE id::text > $1 ORDER BY id::text LIMIT ${BATCH_SIZE}`,
            [afterId],
          );
          if (page.length === 0) break;
          changed += await this.recalculateRows(tenantId, resolved, ordered, page.map((r) => r.id));
          afterId = String(page.at(-1)!.id);
        }
      }
    }
    if (depth < MAX_PROPAGATION_DEPTH) await this.refreshDependents(tenantId, dependents, ids, depth + 1);
    return changed;
  }

  /** Formulas (as "Entity.field") that use `fieldName` of this entity, directly or via lookups. */
  async usagesOf(tenantId: string, resolved: ResolvedEntity, fieldName: string): Promise<string[]> {
    const usages: string[] = [];
    const names = resolved.fields.map((f) => f.name);
    for (const field of resolved.fields.filter(isCalculatedField)) {
      if (field.name === fieldName) continue;
      const refs = this.references(field);
      if (!refs) continue;
      const inRange = refs.ranges.some(([from, to]) => {
        const [a, b, i] = [names.indexOf(from), names.indexOf(to), names.indexOf(fieldName)];
        return a >= 0 && b >= 0 && i >= a && i <= b;
      });
      if (refs.fields.has(fieldName) || inRange || refs.lookups.some((l) => l.link === fieldName)) {
        usages.push(`${resolved.entity.label}.${field.name}`);
      }
    }
    const graph = await this.graph(tenantId, true);
    for (const dependent of graph.dependents.get(resolved.entity.id) ?? []) {
      const other = await entityCache.resolveEntity(tenantId, dependent.entityId);
      for (const field of other.fields.filter(isCalculatedField)) {
        const refs = this.references(field);
        if (refs?.lookups.some((l) => dependent.linkNames.includes(l.link) && l.field === fieldName)) {
          usages.push(`${other.entity.label}.${field.name}`);
        }
      }
    }
    return usages;
  }

  private async recalculateRows(
    tenantId: string,
    resolved: ResolvedEntity,
    ordered: FormulaField[],
    ids: string[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.query<Record<string, any>>(
      tenantId,
      `SELECT * FROM ${this.table(tenantId, resolved)} WHERE id::text = ANY($1::text[])`,
      [ids],
    );

    // Linked records used by lookups, fetched once per link field
    const lookupLinks = new Set<string>();
    for (const field of ordered) {
      for (const lookup of this.references(field)?.lookups ?? []) lookupLinks.add(lookup.link);
    }
    const linked = new Map<string, Map<string, Record<string, unknown>>>();
    for (const linkName of lookupLinks) {
      const linkField = resolved.fieldByName.get(linkName)!;
      const target = await entityCache.resolveRecent(tenantId, (linkField.config as any).targetEntityId);
      const targetIds = [...new Set(rows.map((r) => r[linkField.physicalColumnName]).filter(Boolean).map(String))];
      const targetRows = targetIds.length
        ? await this.query<Record<string, any>>(tenantId, `SELECT * FROM ${this.table(tenantId, target)} WHERE id::text = ANY($1::text[])`, [targetIds])
        : [];
      linked.set(linkName, new Map(targetRows.map((r) => [String(r.id), this.byName(target, r)])));
    }

    let changed = 0;
    for (const row of rows) {
      const record = this.byName(resolved, row);
      const linkedRecords: Record<string, Record<string, unknown> | null> = {};
      for (const [linkName, targets] of linked) {
        const id = row[resolved.fieldByName.get(linkName)!.physicalColumnName];
        linkedRecords[linkName] = id ? targets.get(String(id)) ?? null : null;
      }
      const results = calculateRecord(ordered, resolved.fields, record, linkedRecords);
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [name, value] of Object.entries(results)) {
        const field = resolved.fieldByName.get(name)!;
        if (!this.sameValue(row[field.physicalColumnName], value)) {
          params.push(value);
          sets.push(`"${field.physicalColumnName}" = $${params.length}`);
        }
      }
      if (sets.length === 0) continue;
      params.push(row.id);
      await this.query(tenantId, `UPDATE ${this.table(tenantId, resolved)} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      changed++;
    }
    return changed;
  }

  /** Recalculates records elsewhere whose lookups point at the changed records. */
  private async refreshDependents(
    tenantId: string,
    dependents: Array<{ entityId: string; linkNames: string[] }>,
    ids: string[] | undefined,
    depth: number,
  ) {
    for (const dependent of dependents) {
      if (!ids) {
        await this.recalculate(tenantId, dependent.entityId, undefined, depth);
        continue;
      }
      const other = await entityCache.resolveRecent(tenantId, dependent.entityId);
      const conditions = dependent.linkNames
        .map((name) => `"${other.fieldByName.get(name)!.physicalColumnName}"::text = ANY($1::text[])`)
        .join(' OR ');
      const rows = await this.query<{ id: string }>(tenantId, `SELECT id FROM ${this.table(tenantId, other)} WHERE ${conditions}`, [ids]);
      if (rows.length) await this.recalculate(tenantId, dependent.entityId, rows.map((r) => String(r.id)), depth);
    }
  }

  /** The workspace's formula map: one query, rebuilt after schema changes or 30 seconds. */
  private async graph(tenantId: string, fresh = false): Promise<FormulaGraph> {
    const generation = entityCache.generation(tenantId);
    const cached = this.graphs.get(tenantId);
    if (!fresh && cached && cached.generation === generation && Date.now() - cached.builtAt < GRAPH_MAX_AGE_MS) return cached;

    const res = await pool.query<{ entity_id: string; name: string; type: string; config: any }>(
      `SELECT entity_id, name, type, config FROM public.field_def
        WHERE tenant_id = $1 AND (config ? 'formula' OR type = 'reference')`,
      [tenantId],
    );
    const graph: FormulaGraph = { builtAt: Date.now(), generation, calculated: new Set(), dependents: new Map() };
    const linksByEntity = new Map<string, Map<string, string>>(); // entity → link name → target entity
    for (const row of res.rows) {
      if (row.type === 'reference' && row.config?.targetEntityId) {
        if (!linksByEntity.has(row.entity_id)) linksByEntity.set(row.entity_id, new Map());
        linksByEntity.get(row.entity_id)!.set(row.name, row.config.targetEntityId);
      }
    }
    for (const row of res.rows) {
      if (!row.config?.formula) continue;
      graph.calculated.add(row.entity_id);
      const refs = this.references({ config: row.config } as any);
      for (const lookup of refs?.lookups ?? []) {
        const target = linksByEntity.get(row.entity_id)?.get(lookup.link);
        if (!target) continue;
        const list = graph.dependents.get(target) ?? [];
        const entry = list.find((d) => d.entityId === row.entity_id);
        if (entry) {
          if (!entry.linkNames.includes(lookup.link)) entry.linkNames.push(lookup.link);
        } else {
          list.push({ entityId: row.entity_id, linkNames: [lookup.link] });
        }
        graph.dependents.set(target, list);
      }
    }
    this.graphs.set(tenantId, graph);
    return graph;
  }

  private references(field: { config?: unknown }) {
    try {
      return formulaReferences((field.config as any).formula);
    } catch {
      return null; // an invalid formula elsewhere is reported when it's edited
    }
  }

  private byName(resolved: ResolvedEntity, row: Record<string, any>): Record<string, unknown> {
    const record: Record<string, unknown> = { id: row.id };
    for (const field of resolved.fields) {
      let value = row[field.physicalColumnName];
      // NUMERIC columns arrive as strings
      if (field.type === 'number' && typeof value === 'string' && value.trim() !== '') value = Number(value);
      record[field.name] = value;
    }
    return record;
  }

  private sameValue(stored: unknown, next: unknown): boolean {
    const storedBlank = stored === null || stored === undefined;
    const nextBlank = next === null || next === undefined;
    if (storedBlank || nextBlank) return storedBlank && nextBlank;
    // NUMERIC columns arrive as strings ("53.8")
    if (typeof next === 'number') return Number(stored) === next;
    return stored === next;
  }

  private table(tenantId: string, resolved: ResolvedEntity) {
    return `"${defaultStorageAdapter.getTenantSchemaName(tenantId)}"."${resolved.entity.physicalTableName}"`;
  }

  private query<T extends QueryResultRow = any>(tenantId: string, sql: string, params: unknown[]): Promise<T[]> {
    return defaultStorageAdapter.query<T>(tenantId, sql, params as any[]);
  }
}

export const calculatedFieldsService = new CalculatedFieldsService();
