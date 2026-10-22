import jsep from 'jsep';
import { evaluateRawExpression, MAX_EXPRESSION_LENGTH, PURE_FUNCTIONS, type ExpressionFunctions } from './expression.js';

/**
 * Calculated fields: a field whose value comes from a formula over the record's other fields,
 * or from a linked record ("lookup"), instead of being typed in.
 *
 *   days_met        countTrue(range("day_01", "day_31"))
 *   gap_days        max(planned_days - days_met, 0)
 *   attainment_pct  if(planned_days > 0, round(days_met * 100 / planned_days, 1), 0)
 *   machine_name    machine.name            (machine is a link field; name is on Machine)
 *
 * Formulas refer to fields by their name (not label). The server recalculates on every save,
 * when the formula changes, and when a linked record changes.
 */

/** Field types a calculated field can produce. */
export const CALCULATED_FIELD_TYPES = ['number', 'text', 'boolean'] as const;

export interface FormulaField {
  name: string;
  type: string;
  config?: { formula?: string; targetEntityId?: string; [key: string]: unknown } | null;
}

const flatten = (args: any[]): any[] => args.flatMap((a) => (Array.isArray(a) ? flatten(a) : [a]));
const isBlank = (v: any) => v === null || v === undefined || v === '';
const toNumber = (v: any) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));

/** Functions formulas can use besides the expression basics (round, min, max, concat, upper…). */
export const FORMULA_FUNCTIONS: ExpressionFunctions = {
  /** Number of truthy values (ticked checkboxes, non-zero numbers): countTrue(range("day_01","day_31")) */
  countTrue: (...args: any[]) => flatten(args).filter((v) => v === true || v === 'true' || (typeof v === 'number' && v !== 0)).length,
  /** Number of values that are filled in */
  count: (...args: any[]) => flatten(args).filter((v) => !isBlank(v)).length,
  sum: (...args: any[]) => flatten(args).reduce((total, v) => total + (isBlank(v) || Number.isNaN(toNumber(v)) ? 0 : toNumber(v)), 0),
  avg: (...args: any[]) => {
    const nums = flatten(args).filter((v) => !isBlank(v) && !Number.isNaN(toNumber(v))).map(toNumber);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  },
  /** if(condition, valueWhenTrue, valueWhenFalse) */
  if: (condition: any, whenTrue: any, whenFalse: any) => (condition ? whenTrue : whenFalse),
  isBlank: (v: any) => isBlank(v),
};

/** Every function name a formula may call. */
export const FORMULA_FUNCTION_NAMES = [...Object.keys(FORMULA_FUNCTIONS), 'range', ...Object.keys(PURE_FUNCTIONS)];

export interface FormulaReferences {
  /** Own fields used (including both ends and everything between in range()). */
  fields: Set<string>;
  /** Lookups through link fields: machine.name → { link: 'machine', field: 'name' } */
  lookups: Array<{ link: string; field: string }>;
  /** range("a", "b") pairs */
  ranges: Array<[string, string]>;
}

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** Parses a formula and lists what it refers to; throws FormulaError on syntax errors. */
export function formulaReferences(formula: string): FormulaReferences {
  if (!formula.trim()) throw new FormulaError('The formula is empty');
  if (formula.length > MAX_EXPRESSION_LENGTH) throw new FormulaError(`Formulas can be at most ${MAX_EXPRESSION_LENGTH} characters`);
  let ast: any;
  try {
    ast = jsep(formula);
  } catch (err: any) {
    throw new FormulaError(`Formula syntax error: ${err.message}`);
  }
  const refs: FormulaReferences = { fields: new Set(), lookups: [], ranges: [] };
  const walk = (node: any, isCallee = false): void => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'Identifier':
        if (!isCallee && !['true', 'false', 'null'].includes(node.name)) refs.fields.add(node.name);
        return;
      case 'MemberExpression':
        if (node.object?.type === 'Identifier' && !node.computed && node.property?.type === 'Identifier') {
          refs.lookups.push({ link: node.object.name, field: node.property.name });
          return;
        }
        throw new FormulaError('Only one level of lookup is supported, e.g. machine.name');
      case 'CallExpression': {
        if (node.callee?.type !== 'Identifier') throw new FormulaError('Only built-in functions can be called');
        const name = node.callee.name;
        if (!FORMULA_FUNCTION_NAMES.includes(name)) throw new FormulaError(`Unknown function '${name}'`);
        if (name === 'range') {
          const [from, to] = node.arguments ?? [];
          if (node.arguments?.length !== 2 || from?.type !== 'Literal' || to?.type !== 'Literal' || typeof from.value !== 'string' || typeof to.value !== 'string') {
            throw new FormulaError('range() takes two field names in quotes, e.g. range("day_01", "day_31")');
          }
          refs.ranges.push([from.value, to.value]);
          return;
        }
        for (const arg of node.arguments ?? []) walk(arg);
        return;
      }
      case 'BinaryExpression':
      case 'LogicalExpression':
        walk(node.left);
        walk(node.right);
        return;
      case 'UnaryExpression':
        walk(node.argument);
        return;
      case 'ConditionalExpression':
        walk(node.test);
        walk(node.consequent);
        walk(node.alternate);
        return;
      case 'ArrayExpression':
        for (const el of node.elements ?? []) walk(el);
        return;
      case 'Literal':
        return;
      default:
        throw new FormulaError(`Unsupported formula syntax (${node.type})`);
    }
  };
  walk(ast);
  return refs;
}

/** Field names from `from` to `to` (inclusive) in the entity's field order. */
export function rangeFieldNames(fields: FormulaField[], from: string, to: string): string[] {
  const start = fields.findIndex((f) => f.name === from);
  const end = fields.findIndex((f) => f.name === to);
  if (start < 0) throw new FormulaError(`range(): unknown field '${from}'`);
  if (end < 0) throw new FormulaError(`range(): unknown field '${to}'`);
  if (end < start) throw new FormulaError(`range(): '${from}' comes after '${to}'`);
  return fields.slice(start, end + 1).map((f) => f.name);
}

/**
 * Checks every calculated field of an entity: syntax, known fields and functions, lookups
 * through link fields to existing target fields, and no formula depending on itself.
 * Returns the calculated fields in the order they must be evaluated.
 */
export function planCalculatedFields(
  fields: FormulaField[],
  /** Fields of a link field's target entity (for lookups). */
  targetFieldsOf: (linkField: FormulaField) => FormulaField[] | undefined,
): FormulaField[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const calculated = fields.filter((f) => f.config?.formula);
  const deps = new Map<string, Set<string>>();

  for (const field of calculated) {
    const where = `Formula for '${field.name}'`;
    if (!(CALCULATED_FIELD_TYPES as readonly string[]).includes(field.type)) {
      throw new FormulaError(`${where}: only number, text and yes/no fields can be calculated`);
    }
    let refs: FormulaReferences;
    try {
      refs = formulaReferences(field.config!.formula!);
    } catch (err: any) {
      throw new FormulaError(`${where}: ${err.message}`);
    }
    const used = new Set<string>();
    for (const name of refs.fields) {
      if (!byName.has(name)) throw new FormulaError(`${where}: unknown field '${name}'`);
      used.add(name);
    }
    for (const [from, to] of refs.ranges) {
      try {
        for (const name of rangeFieldNames(fields, from, to)) used.add(name);
      } catch (err: any) {
        throw new FormulaError(`${where}: ${err.message}`);
      }
    }
    for (const { link, field: targetName } of refs.lookups) {
      const linkField = byName.get(link);
      if (!linkField) throw new FormulaError(`${where}: unknown field '${link}'`);
      if (linkField.type !== 'reference') throw new FormulaError(`${where}: '${link}' is not a link field, so '${link}.${targetName}' can't look anything up`);
      const targetFields = targetFieldsOf(linkField);
      if (!targetFields?.some((f) => f.name === targetName)) {
        throw new FormulaError(`${where}: the linked record has no field '${targetName}'`);
      }
      used.add(link);
    }
    if (used.has(field.name)) throw new FormulaError(`${where}: a formula can't use its own field`);
    deps.set(field.name, new Set([...used].filter((name) => byName.get(name)?.config?.formula)));
  }

  // Dependency order; a cycle (a → b → a) can't be calculated
  const ordered: FormulaField[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new FormulaError(`Formulas depend on each other in a loop: ${[...path, name].join(' → ')}`);
    }
    state.set(name, 'visiting');
    for (const dep of deps.get(name) ?? []) visit(dep, [...path, name]);
    state.set(name, 'done');
    ordered.push(byName.get(name)!);
  };
  for (const field of calculated) visit(field.name, []);
  return ordered;
}

/** Turns a formula result into a value the field's column can store (null when it can't). */
export function coerceCalculatedValue(value: unknown, type: string): number | string | boolean | null {
  if (value === null || value === undefined) return null;
  if (type === 'number') {
    const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return Boolean(value);
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * Calculates every calculated field of one record, in dependency order.
 * `record` and the linked records are keyed by field name. Returns { fieldName: value }.
 * A formula that fails at run time (e.g. text where a number is needed) yields null.
 */
export function calculateRecord(
  orderedCalculated: FormulaField[],
  allFields: FormulaField[],
  record: Record<string, unknown>,
  linkedRecords: Record<string, Record<string, unknown> | null | undefined> = {},
): Record<string, number | string | boolean | null> {
  const values: Record<string, unknown> = { ...record };
  const results: Record<string, number | string | boolean | null> = {};
  const functions: ExpressionFunctions = {
    ...FORMULA_FUNCTIONS,
    range: (from: string, to: string) => rangeFieldNames(allFields, from, to).map((name) => values[name]),
  };
  for (const field of orderedCalculated) {
    const scope: Record<string, unknown> = { ...values };
    // A link field used in a lookup stands for the linked record (machine.name)
    for (const [link, linked] of Object.entries(linkedRecords)) scope[link] = linked ?? undefined;
    const { value, error } = evaluateRawExpression(field.config!.formula!, scope, functions);
    const result = error ? null : coerceCalculatedValue(value, field.type);
    results[field.name] = result;
    values[field.name] = result;
  }
  return results;
}
