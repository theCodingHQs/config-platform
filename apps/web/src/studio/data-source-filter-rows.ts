import { FILTER_OPS_BY_FIELD_TYPE, type DataSourceDefinition, type ErdColumn, type FilterOp } from '@config-platform/schema';

/** One editable filter condition: field, operator and value (a literal or {{ expression }}). */
export interface FilterRow {
  field: string;
  op: FilterOp;
  value: unknown;
}

type DataSourceFilter = NonNullable<DataSourceDefinition['filter']>;

/** Operators offered in the editor; isNull needs no value, so it isn't offered there. */
export const FILTER_OP_LABELS: Partial<Record<FilterOp, string>> = {
  eq: 'equals',
  neq: 'not equal',
  contains: 'contains',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  in: 'is one of (a, b, …)',
};

/** Operators a field accepts (as the records API checks them), in label order. */
export function filterOpsForColumn(column?: Pick<ErdColumn, 'type'>): FilterOp[] {
  const allowed = column ? FILTER_OPS_BY_FIELD_TYPE[column.type] ?? ['eq'] : ['eq'];
  return (Object.keys(FILTER_OP_LABELS) as FilterOp[]).filter((op) => allowed.includes(op));
}

/** A filter key may be a field id or a field name; both are accepted by the records API. */
export function findFilterColumn<C extends Pick<ErdColumn, 'id' | 'name'>>(columns: C[], key: string): C | undefined {
  return columns.find((c) => c.id === key) ?? columns.find((c) => c.name === key);
}

/** `{ month: '{{ state.month }}', name: { contains: '{{ state.q }}' } }` → one row per condition. */
export function filterToRows(filter: DataSourceFilter | undefined): FilterRow[] {
  const rows: FilterRow[] = [];
  for (const [field, value] of Object.entries(filter ?? {})) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [op, operand] of Object.entries(value)) rows.push({ field, op: op as FilterOp, value: operand });
    } else {
      rows.push({ field, op: 'eq', value });
    }
  }
  return rows;
}

/** Rows back to a filter: a lone "equals" stays a plain value, anything else uses operator form. */
export function rowsToFilter(rows: FilterRow[]): DataSourceFilter {
  const byField = new Map<string, FilterRow[]>();
  for (const row of rows) {
    if (!row.field) continue;
    byField.set(row.field, [...(byField.get(row.field) ?? []), row]);
  }
  const filter: DataSourceFilter = {};
  for (const [field, fieldRows] of byField) {
    if (fieldRows.length === 1 && fieldRows[0].op === 'eq') {
      filter[field] = fieldRows[0].value as DataSourceFilter[string];
    } else {
      filter[field] = Object.fromEntries(fieldRows.map((r) => [r.op, r.value]));
    }
  }
  return filter;
}

/** Separates the fields of a condition that matches any of several fields (`machine_name,work_center`). */
export const FILTER_ANY_OF_SEPARATOR = ',';

export function splitFilterFields(key: string): string[] {
  return key.split(FILTER_ANY_OF_SEPARATOR).map((f) => f.trim()).filter(Boolean);
}

export function joinFilterFields(fields: string[]): string {
  return fields.join(FILTER_ANY_OF_SEPARATOR);
}

/** Operators every selected field accepts, so the condition is valid for each of them. */
export function filterOpsForColumns(columns: Array<Pick<ErdColumn, 'type'> | undefined>): FilterOp[] {
  if (columns.length === 0) return filterOpsForColumn(undefined);
  return columns.map(filterOpsForColumn).reduce((common, ops) => common.filter((op) => ops.includes(op)));
}
