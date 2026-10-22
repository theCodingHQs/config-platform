import { z } from 'zod';

/**
 * "Start from an Excel sheet": looks at a spreadsheet's columns and suggests the data entity to
 * create (field names, types, choice lists), so a team's existing sheet becomes an app in minutes.
 */

/** What a column becomes. 'month' is a date field with month granularity. */
export const WIZARD_FIELD_KINDS = ['text', 'number', 'boolean', 'date', 'month', 'select'] as const;
export type WizardFieldKind = (typeof WIZARD_FIELD_KINDS)[number];

/** How date cells written as text are read (cells Excel stores as dates need no format). */
export type WizardDateFormat = 'ISO' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

/** Values read as ticked / unticked in yes/no (checkbox) columns. */
export const WIZARD_TRUE_WORDS = ['true', 'yes', 'y', '1', 'x', '✓', '✔', '☑', 'done', 'ok'];
export const WIZARD_FALSE_WORDS = ['false', 'no', 'n', '0', '-', '☐', '✗'];

export interface WizardColumnSuggestion {
  /** The column header in the file */
  header: string;
  include: boolean;
  name: string;
  label: string;
  kind: WizardFieldKind;
  /** Choice lists only */
  options?: string[];
  /** Up to five example values, as shown in the file */
  samples: string[];
  /** Rows with a value in this column */
  filled: number;
}

export interface WizardAnalysis {
  columns: WizardColumnSuggestion[];
  dateFormat: WizardDateFormat;
  /** Day and month order can't be told apart (e.g. only 01/02-style dates): ask the user */
  dateFormatAmbiguous: boolean;
}

const MAX_CHOICES = 12;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** A safe, unique field name from a header: "Planned Days" → planned_days, "Day 1" → day_1. */
export function fieldNameFromHeader(header: string, used: Set<string>): string {
  // Headers can be very long (Excel allows 32k characters); names only use the start
  let base = header
    .slice(0, 200)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/%/g, ' pct ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!base) base = 'field';
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  // Names the platform reserves for every record
  if (['id', 'created_at', 'updated_at'].includes(base)) base = `${base}_value`;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
  used.add(name);
  return name;
}

/** Plain numbers only ("1,234" stays text: the import reads numbers as written). */
function isNumberValue(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v));
}

/** Calendar date of a cell (ISO from Excel date cells, or text in the given order); null if not a date. */
export function wizardCellDate(v: string, format: WizardDateFormat): string | null {
  const iso = ISO_DATE.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = SLASH_DATE.exec(v);
  if (!m || format === 'ISO') return null;
  let [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  const [day, month] = format === 'MM/DD/YYYY' ? [b, a] : [a, b];
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The day/month order of text dates in the file: an unambiguous value (13+) decides. */
function detectDateFormat(values: string[]): { format: WizardDateFormat; ambiguous: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  let slashDates = 0;
  for (const v of values) {
    const m = SLASH_DATE.exec(v);
    if (!m) continue;
    slashDates++;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (slashDates === 0) return { format: 'ISO', ambiguous: false };
  if (dayFirst && !monthFirst) return { format: 'DD/MM/YYYY', ambiguous: false };
  if (monthFirst && !dayFirst) return { format: 'MM/DD/YYYY', ambiguous: false };
  return { format: 'DD/MM/YYYY', ambiguous: true };
}

/**
 * Suggests a field for every column. Suggestions are conservative: a column only becomes a
 * number, date or yes/no when every filled cell fits, so the import that follows succeeds.
 */
export function analyzeImportColumns(columns: string[], rows: Record<string, unknown>[]): WizardAnalysis {
  const allValues = columns.flatMap((c) => rows.map((r) => text(r[c])).filter(Boolean));
  const { format: dateFormat, ambiguous } = detectDateFormat(allValues);
  const used = new Set<string>();

  const suggestions = columns.map((header): WizardColumnSuggestion => {
    const values = rows.map((r) => text(r[header])).filter(Boolean);
    const distinct = [...new Set(values)];
    const lower = values.map((v) => v.toLowerCase());
    const label = header.trim() || 'Untitled';
    const base = { header, label, name: fieldNameFromHeader(label, used), samples: distinct.slice(0, 5), filled: values.length };

    if (values.length === 0) return { ...base, include: false, kind: 'text' };

    const allTrueFalse = lower.every((v) => WIZARD_TRUE_WORDS.includes(v) || WIZARD_FALSE_WORDS.includes(v));
    // Ticks: x / ✓ / yes … or 1/0 (a numeric 0/1 column is far more often a checkbox than a count)
    if (allTrueFalse && distinct.length <= 2) return { ...base, include: true, kind: 'boolean' };
    if (values.every(isNumberValue)) return { ...base, include: true, kind: 'number' };

    const dates = values.map((v) => wizardCellDate(v, dateFormat));
    if (dates.every(Boolean)) {
      const firstOfMonth = (dates as string[]).every((d) => d.endsWith('-01'));
      // A column of 1sts of the month is a month (e.g. a monthly sheet), if it varies
      return { ...base, include: true, kind: firstOfMonth && values.length > 1 ? 'month' : 'date' };
    }

    if (distinct.length <= MAX_CHOICES && values.length >= 4 && distinct.length <= Math.ceil(values.length / 2)) {
      return { ...base, include: true, kind: 'select', options: distinct.slice().sort((a, b) => a.localeCompare(b)) };
    }
    return { ...base, include: true, kind: 'text' };
  });

  return { columns: suggestions, dateFormat, dateFormatAmbiguous: ambiguous };
}

/** The field to create for a reviewed column. */
export function wizardFieldSpec(column: Pick<WizardColumnSuggestion, 'name' | 'label' | 'kind' | 'options'>) {
  switch (column.kind) {
    case 'month':
      return { name: column.name, label: column.label, type: 'date' as const, config: { granularity: 'month' as const } };
    case 'select':
      return {
        name: column.name,
        label: column.label,
        type: 'select' as const,
        config: { options: (column.options ?? []).map((o) => ({ label: o, value: o })) },
      };
    default:
      return { name: column.name, label: column.label, type: column.kind, config: {} };
  }
}

/** What the wizard sends to create the entity and import the sheet. */
export const WizardPlanSchema = z.object({
  entityName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'Use lowercase letters, numbers and underscores, starting with a letter'),
  entityLabel: z.string().trim().min(1).max(128),
  icon: z.string().max(64).optional(),
  sheetName: z.string().optional(),
  dateFormat: z.enum(['ISO', 'DD/MM/YYYY', 'MM/DD/YYYY']).default('ISO'),
  columns: z
    .array(
      z.object({
        header: z.string(),
        include: z.boolean(),
        name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
        label: z.string().trim().min(1).max(128),
        kind: z.enum(WIZARD_FIELD_KINDS),
        options: z.array(z.string().max(128)).max(100).optional(),
      }),
    )
    .min(1),
});
export type WizardPlan = z.infer<typeof WizardPlanSchema>;

/** Entity name from a sheet or file name: "Production Tracker 2026.xlsx" → production_tracker_2026. */
export function entityNameFromTitle(title: string): string {
  return fieldNameFromHeader(title.replace(/\.(xlsx|xlsm|xls|csv)$/i, ''), new Set());
}
