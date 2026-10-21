import { z } from 'zod';

/**
 * Dates, shared by the API and the web app.
 *
 * Three different things are kept apart:
 * - a calendar date ("PlainDate", e.g. a production day): `YYYY-MM-DD`, never time-zone shifted;
 * - a calendar month ("PlainMonth", e.g. a production sheet's month): `YYYY-MM`, stored as the 1st;
 * - a moment in time (an instant, e.g. created at): ISO 8601 with `Z`, shown in a time zone.
 *
 * Values move between systems only in these ISO forms. How they look on screen is a viewer
 * preference (`DateDisplayPrefs`), applied with the browser's `Intl` formatting.
 */

export type DateGranularity = 'day' | 'month';

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLAIN_MONTH_RE = /^(\d{4})-(\d{2})$/;
/** Leading calendar date of an ISO date or date-time string, taken as written (no time zone maths). */
const ISO_DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validParts(year: number, month: number, day: number): boolean {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isPlainDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = PLAIN_DATE_RE.exec(value);
  return Boolean(m && validParts(Number(m[1]), Number(m[2]), Number(m[3])));
}

export function isPlainMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = PLAIN_MONTH_RE.exec(value);
  return Boolean(m && validParts(Number(m[1]), Number(m[2]), 1));
}

/**
 * Normalizes a value for a date-only field to `YYYY-MM-DD` (or the 1st of the month for month
 * granularity). Accepts `YYYY-MM-DD`, `YYYY-MM`, an ISO date-time (its written calendar date is
 * kept: `2026-10-01T00:00:00Z` → `2026-10-01`) or a Date (its UTC calendar date, which is how
 * spreadsheets and ISO midnight values carry dates). Returns null when it isn't a valid date.
 */
export function normalizePlainDate(value: unknown, granularity: DateGranularity = 'day'): string | null {
  let year: number;
  let month: number;
  let day: number;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else if (typeof value === 'string') {
    const text = value.trim();
    const monthOnly = PLAIN_MONTH_RE.exec(text);
    const datePrefix = ISO_DATE_PREFIX_RE.exec(text);
    if (monthOnly) {
      year = Number(monthOnly[1]);
      month = Number(monthOnly[2]);
      day = 1;
    } else if (datePrefix) {
      year = Number(datePrefix[1]);
      month = Number(datePrefix[2]);
      day = Number(datePrefix[3]);
    } else {
      return null;
    }
  } else {
    return null;
  }
  if (!validParts(year, month, day)) return null;
  return `${pad(year, 4)}-${pad(month)}-${granularity === 'month' ? '01' : pad(day)}`;
}

/** `2026-10-01` → `2026-10`. */
export function toPlainMonth(plainDate: string): string {
  return plainDate.slice(0, 7);
}

/** Calendar date of an instant in a time zone (e.g. "today" in the workspace's zone). */
export function plainDateInTimeZone(instant: Date | string | number, timeZone?: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayPlainDate(timeZone?: string): string {
  return plainDateInTimeZone(new Date(), timeZone);
}

export function addDays(plainDate: string, days: number): string {
  const [y, m, d] = plainDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(plainMonth: string, months: number): string {
  const [y, m] = plainMonth.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}`;
}

// ─── Display ────────────────────────────────────────────────────────────────

/** How dates are written on screen. `auto` follows the viewer's locale (e.g. 01/10/2026 in en-GB). */
export const DATE_DISPLAY_FORMATS = ['auto', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY', 'MMM D, YYYY'] as const;
export type DateDisplayFormat = (typeof DATE_DISPLAY_FORMATS)[number];

export const TIME_DISPLAY_FORMATS = ['auto', '12h', '24h'] as const;
export type TimeDisplayFormat = (typeof TIME_DISPLAY_FORMATS)[number];

export const WEEK_START_OPTIONS = ['auto', 'monday', 'sunday', 'saturday'] as const;
export type WeekStart = (typeof WEEK_START_OPTIONS)[number];

export interface DateDisplayPrefs {
  /** BCP 47 locale, e.g. "en-IN", "de-DE"; defaults to the runtime's locale. */
  locale?: string;
  dateFormat?: DateDisplayFormat;
  timeFormat?: TimeDisplayFormat;
  /** IANA zone for showing instants, e.g. "Asia/Kolkata"; defaults to the runtime's zone. */
  timeZone?: string;
  /** First day of the week in calendars; 'auto' follows the locale. */
  weekStart?: WeekStart;
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Whether the runtime knows this IANA time zone (e.g. "Asia/Kolkata"). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const TimeZoneSchema = z.string().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone');

/**
 * Workspace defaults (Settings → Regional). The time zone also defines "today" and day
 * boundaries for the workspace (exports, "this month", date-only defaults).
 */
export const WorkspaceDateSettingsSchema = z.object({
  dateFormat: z.enum(DATE_DISPLAY_FORMATS).default('auto'),
  timeFormat: z.enum(TIME_DISPLAY_FORMATS).default('auto'),
  weekStart: z.enum(WEEK_START_OPTIONS).default('auto'),
  timeZone: TimeZoneSchema.default('UTC'),
});
export type WorkspaceDateSettings = z.infer<typeof WorkspaceDateSettingsSchema>;

/**
 * A user's own choices. Absent = use the workspace default; timeZone 'auto' = this device's zone.
 */
export const UserDatePreferencesSchema = z.object({
  dateFormat: z.enum(DATE_DISPLAY_FORMATS).optional(),
  timeFormat: z.enum(TIME_DISPLAY_FORMATS).optional(),
  weekStart: z.enum(WEEK_START_OPTIONS).optional(),
  timeZone: z.union([z.literal('auto'), TimeZoneSchema]).optional(),
});
export type UserDatePreferences = z.infer<typeof UserDatePreferencesSchema>;

/**
 * The prefs a viewer sees: their own choice, else the workspace default; the time zone for
 * moments is the user's, else this device's (moments are personal), while the locale is the
 * device's (it only matters for 'auto' formats and month names).
 */
export function resolveDateDisplayPrefs(
  workspace: Partial<WorkspaceDateSettings> | undefined,
  user: UserDatePreferences | undefined,
  device: { locale?: string; timeZone?: string } = {},
): DateDisplayPrefs {
  const userZone = user?.timeZone && user.timeZone !== 'auto' ? user.timeZone : undefined;
  return {
    locale: device.locale,
    dateFormat: user?.dateFormat ?? workspace?.dateFormat ?? 'auto',
    timeFormat: user?.timeFormat ?? workspace?.timeFormat ?? 'auto',
    weekStart: user?.weekStart ?? workspace?.weekStart ?? 'auto',
    timeZone: userZone ?? device.timeZone,
  };
}

/** First day of the week as 0 = Sunday … 6 = Saturday ('auto' asks the locale, else Monday). */
export function resolveWeekStartDay(weekStart: WeekStart | undefined, locale?: string): number {
  if (weekStart === 'sunday') return 0;
  if (weekStart === 'saturday') return 6;
  if (weekStart === 'monday') return 1;
  try {
    // Intl.Locale weekInfo (firstDay: 1 = Monday … 7 = Sunday) where the runtime supports it
    const info = (new Intl.Locale(locale ?? new Intl.DateTimeFormat().resolvedOptions().locale) as any);
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (typeof firstDay === 'number') return firstDay % 7;
  } catch {
    // fall through
  }
  return 1;
}

function monthName(month: number, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));
}

function formatParts(year: number, month: number, day: number, prefs: DateDisplayPrefs): string {
  switch (prefs.dateFormat ?? 'auto') {
    case 'DD/MM/YYYY':
      return `${pad(day)}/${pad(month)}/${year}`;
    case 'MM/DD/YYYY':
      return `${pad(month)}/${pad(day)}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${pad(month)}-${pad(day)}`;
    case 'D MMM YYYY':
      return `${day} ${monthName(month, prefs.locale)} ${year}`;
    case 'MMM D, YYYY':
      return `${monthName(month, prefs.locale)} ${day}, ${year}`;
    default:
      // The calendar date is formatted in UTC so no time zone can move it to another day
      return new Intl.DateTimeFormat(prefs.locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, day)));
  }
}

/** A calendar date for display; values that aren't dates are returned unchanged. */
export function formatPlainDate(value: unknown, prefs: DateDisplayPrefs = {}): string {
  const plain = normalizePlainDate(value);
  if (!plain) return value === null || value === undefined ? '' : String(value);
  const [y, m, d] = plain.split('-').map(Number);
  return formatParts(y, m, d, prefs);
}

/** A calendar month for display: "Oct 2026" (auto) or the numeric/ISO form of the chosen format. */
export function formatPlainMonth(value: unknown, prefs: DateDisplayPrefs = {}): string {
  const plain = normalizePlainDate(value, 'month');
  if (!plain) return value === null || value === undefined ? '' : String(value);
  const [y, m] = plain.split('-').map(Number);
  switch (prefs.dateFormat ?? 'auto') {
    case 'DD/MM/YYYY':
    case 'MM/DD/YYYY':
      return `${pad(m)}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${pad(m)}`;
    default:
      return new Intl.DateTimeFormat(prefs.locale, { year: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(y, m - 1, 1)));
  }
}

/** A moment in time for display, in the viewer's time zone: date as preferred, then the time. */
export function formatInstant(value: unknown, prefs: DateDisplayPrefs = {}): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (value === null || value === undefined || Number.isNaN(date.getTime())) {
    return value === null || value === undefined ? '' : String(value);
  }
  const [y, m, d] = plainDateInTimeZone(date, prefs.timeZone).split('-').map(Number);
  const cycle: Intl.DateTimeFormatOptions =
    prefs.timeFormat === '12h' ? { hour12: true } : prefs.timeFormat === '24h' ? { hourCycle: 'h23' } : {};
  // 24-hour clocks are written with two-digit hours (01:35); 12-hour ones aren't (1:35 AM)
  const uses24h = new Intl.DateTimeFormat(prefs.locale, { hour: 'numeric', ...cycle }).resolvedOptions().hourCycle;
  const time = new Intl.DateTimeFormat(prefs.locale, {
    hour: uses24h === 'h23' || uses24h === 'h24' ? '2-digit' : 'numeric',
    minute: '2-digit',
    timeZone: prefs.timeZone,
    ...cycle,
  }).format(date);
  return `${formatParts(y, m, d, prefs)} ${time}`;
}

/** Display a date field value according to its granularity (day or month) or time setting. */
export function formatDateFieldValue(
  value: unknown,
  config: { includeTime?: boolean; granularity?: DateGranularity } | undefined,
  prefs: DateDisplayPrefs = {},
): string {
  if (config?.includeTime) return formatInstant(value, prefs);
  if (config?.granularity === 'month') return formatPlainMonth(value, prefs);
  return formatPlainDate(value, prefs);
}

/**
 * Reads a date typed in the given display format (e.g. "01/10/2026" as DD/MM/YYYY) and returns
 * `YYYY-MM-DD`, or null. ISO input is always accepted. `auto` uses the locale's day/month order.
 */
export function parseDisplayDate(text: string, prefs: DateDisplayPrefs = {}): string | null {
  const trimmed = text.trim();
  const iso = normalizePlainDate(trimmed);
  if (iso && PLAIN_DATE_RE.test(trimmed)) return iso;
  const m = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})$/.exec(trimmed);
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let order = prefs.dateFormat ?? 'auto';
  if (order === 'auto' || order === 'D MMM YYYY' || order === 'MMM D, YYYY') order = localeDateOrder(prefs.locale);
  let year: number;
  let month: number;
  let day: number;
  if (m[1].length === 4) [year, month, day] = [a, b, c];
  else if (order === 'MM/DD/YYYY') [month, day, year] = [a, b, c];
  else [day, month, year] = [a, b, c];
  if (year < 100) year += 2000;
  return validParts(year, month, day) ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : null;
}

/** Whether a locale writes month before day (en-US) or day before month (most others). */
export function localeDateOrder(locale?: string): 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2026, 10, 22)));
  const order = parts.filter((p) => p.type === 'year' || p.type === 'month' || p.type === 'day').map((p) => p.type);
  if (order[0] === 'year') return 'YYYY-MM-DD';
  return order[0] === 'month' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
}

// ─── Wall-clock time in a time zone ─────────────────────────────────────────

/** The calendar date and wall-clock time of an instant in a time zone. */
export function instantToZonedParts(
  instant: Date | string | number,
  timeZone?: string,
): { date: string; hour: number; minute: number } {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { date: `${pad(get('year'), 4)}-${pad(get('month'))}-${pad(get('day'))}`, hour: get('hour') % 24, minute: get('minute') };
}

/**
 * The instant at which the wall clock in `timeZone` shows `plainDate hour:minute`
 * (e.g. 14:05 on 2026-10-22 in Asia/Kolkata → 2026-10-22T08:35:00Z). Handles daylight saving.
 */
export function zonedDateTimeToInstant(plainDate: string, hour: number, minute: number, timeZone?: string): Date {
  const [y, m, d] = plainDate.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const offsetAt = (t: number) => {
    const p = instantToZonedParts(new Date(t), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number);
    return Date.UTC(py, pm - 1, pd, p.hour, p.minute) - t;
  };
  // Two passes settle the zone offset, including across a daylight-saving change
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}

/** "14:05" / "2:05 PM" for a time of day, following the 12/24-hour preference. */
export function formatTimeOfDay(hour: number, minute: number, prefs: DateDisplayPrefs = {}): string {
  const cycle: Intl.DateTimeFormatOptions =
    prefs.timeFormat === '12h' ? { hour12: true } : prefs.timeFormat === '24h' ? { hourCycle: 'h23' } : {};
  const uses24h = new Intl.DateTimeFormat(prefs.locale, { hour: 'numeric', ...cycle }).resolvedOptions().hourCycle;
  return new Intl.DateTimeFormat(prefs.locale, {
    hour: uses24h === 'h23' || uses24h === 'h24' ? '2-digit' : 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    ...cycle,
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** Reads a typed time: "14:05", "1405", "2:05 pm", "2pm", "14.05". */
export function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}
