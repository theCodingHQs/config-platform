/**
 * Scheduled report emails: a report (export template) is built on a schedule and emailed as an
 * Excel attachment. Times are wall-clock times in the workspace time zone.
 */
import { z } from 'zod';
import { addDays, daysInMonth, plainDateInTimeZone, zonedDateTimeToInstant } from './dates.js';

export const REPORT_SCHEDULE_FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type ReportScheduleFrequency = (typeof REPORT_SCHEDULE_FREQUENCIES)[number];

export const MAX_SCHEDULE_RECIPIENTS = 20;

/**
 * Date parameters can follow the calendar instead of a fixed day, so "this month's production
 * report" is always the current month when it's sent.
 */
export const RELATIVE_DATE_TOKENS = [
  { value: '@today', label: 'Today' },
  { value: '@yesterday', label: 'Yesterday' },
  { value: '@this_week_start', label: 'Start of this week' },
  { value: '@last_week_start', label: 'Start of last week' },
  { value: '@this_month_start', label: 'Start of this month' },
  { value: '@last_month_start', label: 'Start of last month' },
] as const;
export type RelativeDateToken = (typeof RELATIVE_DATE_TOKENS)[number]['value'];

export function isRelativeDateToken(value: unknown): value is RelativeDateToken {
  return typeof value === 'string' && RELATIVE_DATE_TOKENS.some((t) => t.value === value);
}

/** Day of week of a 'YYYY-MM-DD' date: 0 = Sunday … 6 = Saturday. */
export function plainDateWeekday(plainDate: string): number {
  return new Date(`${plainDate}T00:00:00Z`).getUTCDay();
}

/** Turns a relative token into a 'YYYY-MM-DD' date counted from `today`; other values pass through. */
export function resolveRelativeDate(value: unknown, today: string, weekStartDay = 1): unknown {
  if (!isRelativeDateToken(value)) return value;
  const back = (plainDateWeekday(today) - weekStartDay + 7) % 7;
  const monthStart = `${today.slice(0, 8)}01`;
  switch (value) {
    case '@today':
      return today;
    case '@yesterday':
      return addDays(today, -1);
    case '@this_week_start':
      return addDays(today, -back);
    case '@last_week_start':
      return addDays(today, -back - 7);
    case '@this_month_start':
      return monthStart;
    case '@last_month_start':
      return `${addDays(monthStart, -1).slice(0, 8)}01`;
  }
}

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour)');

export const ReportScheduleTimingSchema = z
  .object({
    frequency: z.enum(REPORT_SCHEDULE_FREQUENCIES),
    timeOfDay: TimeOfDaySchema,
    /** weekly: 0 = Sunday … 6 = Saturday */
    weekday: z.number().int().min(0).max(6).optional(),
    /** monthly: 1–31; months that are shorter use their last day */
    dayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.frequency === 'weekly' && t.weekday === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekday'], message: 'Choose the day of the week' });
    }
    if (t.frequency === 'monthly' && t.dayOfMonth === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfMonth'], message: 'Choose the day of the month' });
    }
  });
export type ReportScheduleTiming = z.infer<typeof ReportScheduleTimingSchema>;

export const ReportScheduleInputSchema = z.object({
  templateId: z.string().min(1, 'Choose a report'),
  name: z.string().trim().max(120).optional(),
  timing: ReportScheduleTimingSchema,
  recipients: z
    .array(z.string().trim().email('Not a valid email address'))
    .min(1, 'Add at least one recipient')
    .max(MAX_SCHEDULE_RECIPIENTS, `At most ${MAX_SCHEDULE_RECIPIENTS} recipients`),
  subject: z.string().trim().max(200).optional(),
  message: z.string().max(2000).optional(),
  /** Report parameter values by parameter name; date parameters may use a relative token */
  parameters: z.record(z.string(), z.union([z.string(), z.number()])).optional().default({}),
  enabled: z.boolean().optional().default(true),
});
export type ReportScheduleInput = z.infer<typeof ReportScheduleInputSchema>;

export interface ReportSchedule extends ReportScheduleInput {
  id: string;
  templateName: string;
  createdBy: string | null;
  createdByEmail: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'sent' | 'failed' | null;
  lastError: string | null;
}

function runsOn(timing: ReportScheduleTiming, plainDate: string): boolean {
  const weekday = plainDateWeekday(plainDate);
  switch (timing.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return weekday === timing.weekday;
    case 'monthly': {
      const [y, m, d] = plainDate.split('-').map(Number);
      return d === Math.min(timing.dayOfMonth ?? 1, daysInMonth(y, m));
    }
  }
}

/** The first time strictly after `after` that the schedule should send. */
export function computeNextRun(timing: ReportScheduleTiming, timeZone: string, after: Date): Date {
  const [hour, minute] = timing.timeOfDay.split(':').map(Number);
  const start = plainDateInTimeZone(after, timeZone);
  // Starts a day early: in zones behind UTC "today" there can still be due later on
  for (let i = -1; i <= 62; i++) {
    const day = addDays(start, i);
    if (!runsOn(timing, day)) continue;
    const at = zonedDateTimeToInstant(day, hour, minute, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('Schedule never runs');
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Every Monday at 07:00", "On day 1 of each month at 08:30" */
export function describeScheduleTiming(timing: ReportScheduleTiming): string {
  const at = `at ${timing.timeOfDay}`;
  switch (timing.frequency) {
    case 'daily':
      return `Every day ${at}`;
    case 'weekdays':
      return `Monday to Friday ${at}`;
    case 'weekly':
      return `Every ${WEEKDAY_NAMES[timing.weekday ?? 1]} ${at}`;
    case 'monthly':
      return timing.dayOfMonth && timing.dayOfMonth >= 29
        ? `On day ${timing.dayOfMonth} of each month (or its last day) ${at}`
        : `On day ${timing.dayOfMonth ?? 1} of each month ${at}`;
  }
}

/**
 * How a workspace's emails are sent:
 * - platform: through the email service the platform operator set up (nothing to configure)
 * - smtp: through the workspace's own mail provider (Microsoft 365, Google Workspace, a company server)
 */
export const EmailDeliveryModeSchema = z.enum(['platform', 'smtp']);
export type EmailDeliveryMode = z.infer<typeof EmailDeliveryModeSchema>;

export const SmtpSettingsSchema = z.object({
  host: z.string().trim().min(1, 'Server address is required').max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().max(255).optional().default(''),
  /** Write-only: omitted on save keeps the stored password */
  password: z.string().max(1024).optional(),
  fromAddress: z.string().trim().email('Sender address must be an email address'),
  fromName: z.string().trim().max(120).optional().default(''),
});
export type SmtpSettings = z.infer<typeof SmtpSettingsSchema>;

export const EmailDeliverySettingsInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('platform') }),
  z.object({ mode: z.literal('smtp'), smtp: SmtpSettingsSchema }),
]);
export type EmailDeliverySettingsInput = z.infer<typeof EmailDeliverySettingsInputSchema>;

/** What the settings screen sees: never the password itself */
export interface EmailDeliverySettings {
  mode: EmailDeliveryMode;
  smtp?: Omit<SmtpSettings, 'password'> & { hasPassword: boolean };
  /** Whether the platform's own sending is set up on this server (else emails are only logged) */
  platformConfigured: boolean;
  platformFromAddress: string | null;
}
