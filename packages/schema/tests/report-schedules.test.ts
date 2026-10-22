import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRun,
  resolveRelativeDate,
  describeScheduleTiming,
  ReportScheduleInputSchema,
  EmailDeliverySettingsInputSchema,
} from '../dist/report-schedules.js';

const next = (timing: any, zone: string, after: string) => computeNextRun(timing, zone, new Date(after)).toISOString();

describe('Report schedule timing', () => {
  it('daily: later today if the time has not passed, else tomorrow, in the workspace time zone', () => {
    // 07:00 in Kolkata is 01:30 UTC
    assert.equal(next({ frequency: 'daily', timeOfDay: '07:00' }, 'Asia/Kolkata', '2026-10-22T00:00:00Z'), '2026-10-22T01:30:00.000Z');
    assert.equal(next({ frequency: 'daily', timeOfDay: '07:00' }, 'Asia/Kolkata', '2026-10-22T01:30:00Z'), '2026-10-23T01:30:00.000Z');
  });

  it('zones behind UTC: "today" there can still be the previous UTC day', () => {
    // 23:00 on Oct 21 in Los Angeles (PDT) is 06:00 UTC on Oct 22
    assert.equal(next({ frequency: 'daily', timeOfDay: '23:00' }, 'America/Los_Angeles', '2026-10-22T05:00:00Z'), '2026-10-22T06:00:00.000Z');
  });

  it('weekdays skip the weekend', () => {
    // Fri 2026-10-23 08:00 UTC has passed → Monday 26th
    assert.equal(next({ frequency: 'weekdays', timeOfDay: '08:00' }, 'UTC', '2026-10-23T09:00:00Z'), '2026-10-26T08:00:00.000Z');
  });

  it('weekly on the chosen day', () => {
    // 2026-10-22 is a Thursday; next Monday is the 26th
    assert.equal(next({ frequency: 'weekly', weekday: 1, timeOfDay: '06:30' }, 'UTC', '2026-10-22T12:00:00Z'), '2026-10-26T06:30:00.000Z');
  });

  it('monthly on day 31 uses the last day of shorter months', () => {
    assert.equal(next({ frequency: 'monthly', dayOfMonth: 31, timeOfDay: '18:00' }, 'UTC', '2026-11-01T00:00:00Z'), '2026-11-30T18:00:00.000Z');
    assert.equal(next({ frequency: 'monthly', dayOfMonth: 31, timeOfDay: '18:00' }, 'UTC', '2027-02-01T00:00:00Z'), '2027-02-28T18:00:00.000Z');
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // Europe/Berlin leaves summer time on 2026-10-25: 07:00 is 05:00 UTC before, 06:00 UTC after
    assert.equal(next({ frequency: 'daily', timeOfDay: '07:00' }, 'Europe/Berlin', '2026-10-24T06:00:00Z'), '2026-10-25T06:00:00.000Z');
  });

  it('describes the timing in plain words', () => {
    assert.equal(describeScheduleTiming({ frequency: 'weekly', weekday: 1, timeOfDay: '07:00' }), 'Every Monday at 07:00');
    assert.equal(describeScheduleTiming({ frequency: 'weekdays', timeOfDay: '08:15' }), 'Monday to Friday at 08:15');
  });
});

describe('Relative report dates', () => {
  it('resolves calendar tokens from today (a Thursday)', () => {
    const today = '2026-10-22';
    assert.equal(resolveRelativeDate('@today', today), '2026-10-22');
    assert.equal(resolveRelativeDate('@yesterday', today), '2026-10-21');
    assert.equal(resolveRelativeDate('@this_week_start', today), '2026-10-19');
    assert.equal(resolveRelativeDate('@this_week_start', today, 0), '2026-10-18');
    assert.equal(resolveRelativeDate('@last_week_start', today), '2026-10-12');
    assert.equal(resolveRelativeDate('@this_month_start', today), '2026-10-01');
    assert.equal(resolveRelativeDate('@last_month_start', '2026-01-15'), '2025-12-01');
    assert.equal(resolveRelativeDate('2026-05-01', today), '2026-05-01');
  });
});

describe('Schedule and email settings validation', () => {
  it('requires a weekday for weekly schedules and valid recipients', () => {
    const base = { templateId: 't1', recipients: ['a@b.com'], timing: { frequency: 'weekly', timeOfDay: '07:00' } };
    assert.equal(ReportScheduleInputSchema.safeParse(base).success, false);
    assert.equal(ReportScheduleInputSchema.safeParse({ ...base, timing: { ...base.timing, weekday: 1 } }).success, true);
    assert.equal(ReportScheduleInputSchema.safeParse({ ...base, timing: { frequency: 'daily', timeOfDay: '7am' } }).success, false);
    assert.equal(ReportScheduleInputSchema.safeParse({ ...base, recipients: ['not-an-email'] }).success, false);
  });

  it('accepts built-in sending or a complete mail server', () => {
    assert.equal(EmailDeliverySettingsInputSchema.safeParse({ mode: 'platform' }).success, true);
    assert.equal(EmailDeliverySettingsInputSchema.safeParse({ mode: 'smtp', smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls', fromAddress: 'reports@acme.com' } }).success, true);
    assert.equal(EmailDeliverySettingsInputSchema.safeParse({ mode: 'smtp', smtp: { host: '', port: 587, security: 'starttls', fromAddress: 'reports@acme.com' } }).success, false);
  });
});
