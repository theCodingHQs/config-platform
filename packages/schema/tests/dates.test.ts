import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlainDate,
  isPlainDate,
  isPlainMonth,
  addDays,
  addMonths,
  plainDateInTimeZone,
  formatPlainDate,
  formatPlainMonth,
  formatInstant,
  formatDateFieldValue,
  parseDisplayDate,
  localeDateOrder,
  instantToZonedParts,
  zonedDateTimeToInstant,
  formatTimeOfDay,
  parseTimeOfDay,
  resolveDateDisplayPrefs,
  resolveWeekStartDay,
  WorkspaceDateSettingsSchema,
  UserDatePreferencesSchema,
} from '../src/dates.ts';

// The suite is run under several TZ values (see package.json): none of these results may change.
describe(`dates (TZ=${process.env.TZ ?? 'system'})`, () => {
  it('keeps calendar dates as written, whatever the time zone', () => {
    assert.equal(normalizePlainDate('2026-10-01'), '2026-10-01');
    assert.equal(normalizePlainDate('2026-10-01T00:00:00.000Z'), '2026-10-01');
    assert.equal(normalizePlainDate('2026-10-01T23:30:00+05:30'), '2026-10-01');
    // Spreadsheet dates arrive as UTC midnight
    assert.equal(normalizePlainDate(new Date(Date.UTC(2026, 9, 1))), '2026-10-01');
    assert.equal(normalizePlainDate('2026-10'), '2026-10-01');
    assert.equal(normalizePlainDate('2026-10-21', 'month'), '2026-10-01');
    for (const bad of ['2026-02-30', '2026-13-01', '01/10/2026', '', 'x', 42, null]) {
      assert.equal(normalizePlainDate(bad), null, String(bad));
    }
    assert.ok(isPlainDate('2028-02-29'));
    assert.ok(!isPlainDate('2027-02-29'));
    assert.ok(isPlainMonth('2026-10'));
  });

  it('does date maths on calendar dates without time zones', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(addMonths('2026-01', -1), '2025-12');
  });

  it('finds the calendar date of a moment in a given time zone', () => {
    const instant = '2026-10-21T20:00:00Z';
    assert.equal(plainDateInTimeZone(instant, 'Asia/Kolkata'), '2026-10-22');
    assert.equal(plainDateInTimeZone(instant, 'America/Los_Angeles'), '2026-10-21');
    assert.equal(plainDateInTimeZone(instant, 'UTC'), '2026-10-21');
  });

  it('shows dates in the chosen format or the viewer locale', () => {
    assert.equal(formatPlainDate('2026-10-01', { dateFormat: 'DD/MM/YYYY' }), '01/10/2026');
    assert.equal(formatPlainDate('2026-10-01', { dateFormat: 'MM/DD/YYYY' }), '10/01/2026');
    assert.equal(formatPlainDate('2026-10-01', { dateFormat: 'YYYY-MM-DD' }), '2026-10-01');
    assert.equal(formatPlainDate('2026-10-01', { dateFormat: 'D MMM YYYY', locale: 'en-GB' }), '1 Oct 2026');
    assert.equal(formatPlainDate('2026-10-01', { dateFormat: 'MMM D, YYYY', locale: 'en-US' }), 'Oct 1, 2026');
    // Auto: the locale decides the order; the day never shifts
    assert.equal(formatPlainDate('2026-10-01', { locale: 'en-US' }), '10/01/2026');
    assert.equal(formatPlainDate('2026-10-01', { locale: 'en-GB' }), '01/10/2026');
    assert.equal(formatPlainDate('2026-10-01', { locale: 'de-DE' }), '01.10.2026');
    assert.equal(formatPlainDate('2026-10-01', { locale: 'ja-JP' }), '2026/10/01');
    // Timestamps of a calendar date (as the API used to send them) show the written date
    assert.equal(formatPlainDate('2026-10-01T00:00:00.000Z', { dateFormat: 'YYYY-MM-DD' }), '2026-10-01');
    assert.equal(formatPlainDate('not a date'), 'not a date');
  });

  it('shows months and moments', () => {
    assert.equal(formatPlainMonth('2026-10-01', { locale: 'en-US' }), 'Oct 2026');
    assert.equal(formatPlainMonth('2026-10', { dateFormat: 'MM/DD/YYYY' }), '10/2026');
    assert.equal(formatPlainMonth('2026-10', { dateFormat: 'YYYY-MM-DD' }), '2026-10');

    const instant = '2026-10-21T20:05:00Z';
    assert.equal(formatInstant(instant, { locale: 'en-GB', timeZone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' }), '22/10/2026 01:35');
    assert.match(formatInstant(instant, { locale: 'en-US', timeZone: 'America/New_York', dateFormat: 'MM/DD/YYYY', timeFormat: '12h' }), /^10\/21\/2026 4:05\sPM$/);

    assert.equal(formatDateFieldValue('2026-10-01', { granularity: 'month' }, { dateFormat: 'YYYY-MM-DD' }), '2026-10');
    assert.equal(formatDateFieldValue('2026-10-01', {}, { dateFormat: 'DD/MM/YYYY' }), '01/10/2026');
    assert.match(formatDateFieldValue(instant, { includeTime: true }, { timeZone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' }), /^2026-10-21 20:05$/);
  });

  it('reads typed dates in the viewer format', () => {
    assert.equal(parseDisplayDate('01/10/2026', { dateFormat: 'DD/MM/YYYY' }), '2026-10-01');
    assert.equal(parseDisplayDate('10/01/2026', { dateFormat: 'MM/DD/YYYY' }), '2026-10-01');
    assert.equal(parseDisplayDate('1.10.26', { locale: 'de-DE' }), '2026-10-01');
    assert.equal(parseDisplayDate('10/1/2026', { locale: 'en-US' }), '2026-10-01');
    assert.equal(parseDisplayDate('2026-10-01', { dateFormat: 'MM/DD/YYYY' }), '2026-10-01');
    assert.equal(parseDisplayDate('31/02/2026', { dateFormat: 'DD/MM/YYYY' }), null);
    assert.equal(localeDateOrder('en-US'), 'MM/DD/YYYY');
    assert.equal(localeDateOrder('en-IN'), 'DD/MM/YYYY');
  });

  it('converts wall-clock times in a time zone to moments and back, across daylight saving', () => {
    assert.equal(zonedDateTimeToInstant('2026-10-22', 14, 5, 'Asia/Kolkata').toISOString(), '2026-10-22T08:35:00.000Z');
    assert.equal(zonedDateTimeToInstant('2026-01-15', 9, 0, 'America/New_York').toISOString(), '2026-01-15T14:00:00.000Z');
    // Summer time: New York is UTC-4
    assert.equal(zonedDateTimeToInstant('2026-07-15', 9, 0, 'America/New_York').toISOString(), '2026-07-15T13:00:00.000Z');
    assert.deepEqual(instantToZonedParts('2026-10-22T08:35:00Z', 'Asia/Kolkata'), { date: '2026-10-22', hour: 14, minute: 5 });
    assert.deepEqual(instantToZonedParts('2026-10-22T20:00:00Z', 'Pacific/Auckland'), { date: '2026-10-23', hour: 9, minute: 0 });
  });

  it('formats and reads times of day', () => {
    assert.equal(formatTimeOfDay(14, 5, { timeFormat: '24h', locale: 'en-GB' }), '14:05');
    assert.match(formatTimeOfDay(14, 5, { timeFormat: '12h', locale: 'en-US' }), /^2:05\sPM$/);
    assert.deepEqual(parseTimeOfDay('14:05'), { hour: 14, minute: 5 });
    assert.deepEqual(parseTimeOfDay('2:05 pm'), { hour: 14, minute: 5 });
    assert.deepEqual(parseTimeOfDay('12am'), { hour: 0, minute: 0 });
    assert.deepEqual(parseTimeOfDay('0930'), { hour: 9, minute: 30 });
    assert.equal(parseTimeOfDay('25:00'), null);
    assert.equal(parseTimeOfDay('13pm'), null);
  });

  it('resolves what a viewer sees: own choice, else workspace default, else device', () => {
    const workspace = WorkspaceDateSettingsSchema.parse({ dateFormat: 'DD/MM/YYYY', timeZone: 'Asia/Kolkata' });
    assert.deepEqual(resolveDateDisplayPrefs(workspace, {}, { locale: 'en-US', timeZone: 'America/Chicago' }), {
      locale: 'en-US', dateFormat: 'DD/MM/YYYY', timeFormat: 'auto', weekStart: 'auto', timeZone: 'America/Chicago',
    });
    const mine = UserDatePreferencesSchema.parse({ dateFormat: 'YYYY-MM-DD', timeZone: 'Europe/Berlin', weekStart: 'sunday' });
    const resolved = resolveDateDisplayPrefs(workspace, mine, { locale: 'en-US', timeZone: 'America/Chicago' });
    assert.equal(resolved.dateFormat, 'YYYY-MM-DD');
    assert.equal(resolved.timeZone, 'Europe/Berlin');
    assert.equal(resolveWeekStartDay(resolved.weekStart), 0);
    assert.equal(resolveWeekStartDay('monday'), 1);
    assert.equal(UserDatePreferencesSchema.safeParse({ timeZone: 'Mars/Base' }).success, false);
  });
});
