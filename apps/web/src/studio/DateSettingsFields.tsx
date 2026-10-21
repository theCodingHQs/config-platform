import React, { useId, useMemo } from "react";
import {
  DATE_DISPLAY_FORMATS,
  TIME_DISPLAY_FORMATS,
  WEEK_START_OPTIONS,
  formatInstant,
  formatPlainDate,
  isValidTimeZone,
  todayPlainDate,
  type DateDisplayFormat,
  type TimeDisplayFormat,
  type WeekStart,
} from "@config-platform/schema";
import { deviceDateContext } from "../context/date-settings-provider";

export interface DateSettingsValue {
  dateFormat?: DateDisplayFormat;
  timeFormat?: TimeDisplayFormat;
  weekStart?: WeekStart;
  /** IANA zone; 'auto' (personal only) = the device's zone. */
  timeZone?: string;
}

const DATE_FORMAT_NAMES: Record<DateDisplayFormat, string> = {
  auto: "Auto (from each person's region)",
  "DD/MM/YYYY": "Day / Month / Year",
  "MM/DD/YYYY": "Month / Day / Year",
  "YYYY-MM-DD": "Year-Month-Day (ISO)",
  "D MMM YYYY": "Day Month Year",
  "MMM D, YYYY": "Month Day, Year",
};
const TIME_FORMAT_NAMES: Record<TimeDisplayFormat, string> = {
  auto: "Auto (from region)",
  "12h": "12-hour",
  "24h": "24-hour",
};
const WEEK_START_NAMES: Record<WeekStart, string> = {
  auto: "Auto (from region)",
  monday: "Monday",
  sunday: "Sunday",
  saturday: "Saturday",
};

function allTimeZones(): string[] {
  const supported = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
  return supported?.length ? supported : ["UTC"];
}

/**
 * Date & time display choices. "workspace" edits the workspace defaults; "personal" adds a
 * "Workspace default" choice to each setting (an empty value) and "This device" for the zone.
 */
export function DateSettingsFields({
  mode,
  value,
  onChange,
  workspaceDefaults,
  disabled,
}: {
  mode: "workspace" | "personal";
  value: DateSettingsValue;
  onChange: (next: DateSettingsValue) => void;
  /** Personal mode: the workspace values, named in the "Workspace default" choices. */
  workspaceDefaults?: DateSettingsValue;
  disabled?: boolean;
}) {
  const ids = { date: useId(), time: useId(), week: useId(), zone: useId(), zones: useId() };
  const device = deviceDateContext();
  const today = todayPlainDate();
  const zones = useMemo(allTimeZones, []);
  const personal = mode === "personal";
  const set = (patch: Partial<DateSettingsValue>) => onChange({ ...value, ...patch });

  const dateExample = (format: DateDisplayFormat) => formatPlainDate(today, { locale: device.locale, dateFormat: format });
  const timeExample = (format: TimeDisplayFormat) =>
    formatInstant(new Date(), { locale: device.locale, dateFormat: "YYYY-MM-DD", timeFormat: format }).split(" ").slice(1).join(" ");
  const inherited = (text: string | undefined) => `Workspace default${text ? ` (${text})` : ""}`;

  const zoneValue = value.timeZone ?? (personal ? "" : "UTC");
  const zoneInvalid = Boolean(zoneValue) && zoneValue !== "auto" && !isValidTimeZone(zoneValue);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: "var(--space-4)" }}>
      <div>
        <label className="form-label" htmlFor={ids.date}>Date format</label>
        <select
          id={ids.date}
          className="form-select"
          value={value.dateFormat ?? ""}
          disabled={disabled}
          onChange={(e) => set({ dateFormat: (e.target.value || undefined) as DateDisplayFormat | undefined })}
        >
          {personal && (
            <option value="">
              {inherited(workspaceDefaults?.dateFormat && `${DATE_FORMAT_NAMES[workspaceDefaults.dateFormat]}: ${dateExample(workspaceDefaults.dateFormat)}`)}
            </option>
          )}
          {DATE_DISPLAY_FORMATS.map((format) => (
            <option key={format} value={format}>
              {DATE_FORMAT_NAMES[format]}: {dateExample(format)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="form-label" htmlFor={ids.time}>Time format</label>
        <select
          id={ids.time}
          className="form-select"
          value={value.timeFormat ?? ""}
          disabled={disabled}
          onChange={(e) => set({ timeFormat: (e.target.value || undefined) as TimeDisplayFormat | undefined })}
        >
          {personal && <option value="">{inherited(workspaceDefaults?.timeFormat && TIME_FORMAT_NAMES[workspaceDefaults.timeFormat])}</option>}
          {TIME_DISPLAY_FORMATS.map((format) => (
            <option key={format} value={format}>
              {TIME_FORMAT_NAMES[format]}: {timeExample(format)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="form-label" htmlFor={ids.week}>First day of the week</label>
        <select
          id={ids.week}
          className="form-select"
          value={value.weekStart ?? ""}
          disabled={disabled}
          onChange={(e) => set({ weekStart: (e.target.value || undefined) as WeekStart | undefined })}
        >
          {personal && <option value="">{inherited(workspaceDefaults?.weekStart && WEEK_START_NAMES[workspaceDefaults.weekStart])}</option>}
          {WEEK_START_OPTIONS.map((start) => (
            <option key={start} value={start}>{WEEK_START_NAMES[start]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="form-label" htmlFor={ids.zone}>Time zone</label>
        {personal ? (
          <select
            id={ids.zone}
            className="form-select"
            value={zoneValue === "" || zoneValue === "auto" ? "auto" : zoneValue}
            disabled={disabled}
            onChange={(e) => set({ timeZone: e.target.value === "auto" ? undefined : e.target.value })}
          >
            <option value="auto">This device ({device.timeZone})</option>
            {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
          </select>
        ) : (
          <>
            <input
              id={ids.zone}
              className={`form-input${zoneInvalid ? " is-invalid" : ""}`}
              list={ids.zones}
              value={zoneValue}
              disabled={disabled}
              placeholder="e.g. Asia/Kolkata"
              onChange={(e) => set({ timeZone: e.target.value })}
              aria-invalid={zoneInvalid}
            />
            <datalist id={ids.zones}>
              {zones.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </>
        )}
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: zoneInvalid ? "var(--danger)" : "var(--text-muted)" }}>
          {zoneInvalid
            ? "Unknown time zone. Pick one from the list."
            : personal
              ? "Times (date & time fields, activity) are shown in this zone."
              : "Defines \"today\" and day boundaries for the workspace, e.g. in exports."}
        </p>
      </div>
    </div>
  );
}
