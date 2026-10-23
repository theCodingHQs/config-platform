import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  formatInstant,
  formatPlainDate,
  formatPlainMonth,
  formatTimeOfDay,
  instantToZonedParts,
  localeDateOrder,
  normalizePlainDate,
  parseDisplayDate,
  parseTimeOfDay,
  resolveWeekStartDay,
  todayPlainDate,
  zonedDateTimeToInstant,
  type DateDisplayPrefs,
} from "@config-platform/schema";
import { useDateDisplayPrefs } from "../context/date-display-context";

export type DateInputKind = "day" | "month" | "datetime";

export interface DateInputProps {
  id?: string;
  /**
   * day: "YYYY-MM-DD"; month: "YYYY-MM-DD" (the 1st) or "YYYY-MM"; datetime: an ISO instant.
   * Empty/undefined = no value.
   */
  value: string | null | undefined;
  /** Same forms as `value`; undefined when cleared. */
  onChange: (value: string | undefined) => void;
  kind?: DateInputKind;
  disabled?: boolean;
  invalid?: boolean;
  /** Extra style for the text box (e.g. room for a leading icon). */
  inputStyle?: React.CSSProperties;
  "aria-label"?: string;
  "data-testid"?: string;
}

/**
 * Date, month or date & time entry in the viewer's own format (Settings → Regional and
 * "Date & time preferences"): type it ("01/10/2026", "2:05 pm") or pick it from a calendar.
 * Values go out in ISO form, so storage never depends on how the date was written.
 */
export function DateInput({ id, value, onChange, kind = "day", disabled, invalid, inputStyle, ...rest }: DateInputProps) {
  const prefs = useDateDisplayPrefs();
  const generatedId = useId();
  const inputId = id ?? `date-input-${generatedId}`;
  const popoverId = `${inputId}-calendar`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  // The value's calendar date (and time, for datetime) as the viewer sees it
  const parts = useMemo(() => valueParts(value, kind, prefs), [value, kind, prefs]);
  const displayText = useMemo(() => formatValue(value, kind, prefs), [value, kind, prefs]);
  const [text, setText] = useState(displayText);
  const [timeText, setTimeText] = useState(parts?.time ? formatTimeOfDay(parts.time.hour, parts.time.minute, prefs) : "");
  const [typedInvalid, setTypedInvalid] = useState(false);
  useEffect(() => {
    setText(kind === "datetime" ? (parts ? formatPlainDate(parts.date, prefs) : "") : displayText);
    setTimeText(parts?.time ? formatTimeOfDay(parts.time.hour, parts.time.minute, prefs) : "");
    setTypedInvalid(false);
  }, [displayText, parts, kind, prefs]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const emit = (date: string | undefined, time = parts?.time ?? { hour: 9, minute: 0 }) => {
    if (!date) return onChange(undefined);
    if (kind === "month") return onChange(normalizePlainDate(date, "month") ?? undefined);
    if (kind === "datetime") return onChange(zonedDateTimeToInstant(date, time.hour, time.minute, prefs.timeZone).toISOString());
    onChange(date);
  };

  // Typed text is read when the field is left (or Enter): in the viewer's format, or ISO
  const commitText = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setTypedInvalid(false);
      if (value) emit(undefined);
      return;
    }
    const date = kind === "month" ? parseMonthText(trimmed, prefs) : parseDisplayDate(trimmed, prefs);
    if (!date) return setTypedInvalid(true);
    setTypedInvalid(false);
    emit(date);
  };
  const commitTime = () => {
    if (!parts) return;
    const time = parseTimeOfDay(timeText);
    if (!time) return setTypedInvalid(true);
    setTypedInvalid(false);
    emit(parts.date, time);
  };

  const placeholder = kind === "month" ? monthPlaceholder(prefs) : datePlaceholder(prefs);
  const showInvalid = invalid || typedInvalid;

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", gap: "var(--space-2)", width: "100%" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          className={`form-input${showInvalid ? " is-invalid" : ""}`}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={showInvalid || undefined}
          aria-label={rest["aria-label"]}
          data-testid={rest["data-testid"]}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            }
            if (e.key === "ArrowDown" && e.altKey) setOpen(true);
          }}
          style={{ paddingRight: "calc(var(--control-height-md) - var(--space-1))", ...inputStyle }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          aria-label={kind === "month" ? "Choose month" : "Choose date"}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          style={{ position: "absolute", right: "var(--space-1)", top: "50%", transform: "translateY(-50%)" }}
        >
          <CalendarDays size="1.1em" />
        </button>
      </div>
      {kind === "datetime" && (
        <input
          type="text"
          className={`form-input${showInvalid ? " is-invalid" : ""}`}
          aria-label="Time"
          value={timeText}
          placeholder={formatTimeOfDay(9, 0, prefs)}
          disabled={disabled || !parts}
          onChange={(e) => setTimeText(e.target.value)}
          onBlur={commitTime}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitTime())}
          style={{ width: "7.5em", flex: "0 0 auto" }}
        />
      )}
      {open && (
        <CalendarPopover
          id={popoverId}
          kind={kind}
          selected={parts?.date}
          prefs={prefs}
          onSelect={(date) => {
            emit(date);
            setOpen(false);
          }}
          onClear={() => {
            emit(undefined);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Calendar ───────────────────────────────────────────────────────────────

function CalendarPopover({
  id,
  kind,
  selected,
  prefs,
  onSelect,
  onClear,
  onClose,
}: {
  id: string;
  kind: DateInputKind;
  selected?: string;
  prefs: DateDisplayPrefs;
  onSelect: (plainDate: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const today = todayPlainDate(prefs.timeZone);
  const [focus, setFocus] = useState(selected ?? today);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const monthMode = kind === "month";

  // Keep keyboard focus on the focused day/month
  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus();
  }, [focus]);

  const [year, month] = focus.split("-").map(Number);
  const weekStart = resolveWeekStartDay(prefs.weekStart, prefs.locale);
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(prefs.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + ((weekStart + i) % 7)))),
  );
  const firstOfMonth = `${focus.slice(0, 7)}-01`;
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() - weekStart + 7) % 7;
  const gridStart = addDays(firstOfMonth, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const move = (deltaDays: number) => setFocus((f) => addDays(f, deltaDays));
  const moveMonths = (delta: number) =>
    setFocus((f) => {
      const target = addMonths(f.slice(0, 7), delta);
      const [ty, tm] = target.split("-").map(Number);
      const day = Math.min(Number(f.slice(8, 10)), new Date(Date.UTC(ty, tm, 0)).getUTCDate());
      return `${target}-${String(day).padStart(2, "0")}`;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = monthMode
      ? { ArrowLeft: () => moveMonths(-1), ArrowRight: () => moveMonths(1), ArrowUp: () => moveMonths(-3), ArrowDown: () => moveMonths(3), PageUp: () => moveMonths(-12), PageDown: () => moveMonths(12) }
      : { ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: () => move(-7), ArrowDown: () => move(7), PageUp: () => moveMonths(-1), PageDown: () => moveMonths(1) };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const title = monthMode
    ? String(year)
    : new Intl.DateTimeFormat(prefs.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <div
      id={id}
      role="dialog"
      aria-label={monthMode ? "Choose month" : "Choose date"}
      className="date-picker-popover"
      onKeyDown={onKeyDown}
    >
      <div className="date-picker-header">
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={monthMode ? "Previous year" : "Previous month"} onClick={() => moveMonths(monthMode ? -12 : -1)}>
          <ChevronLeft size="1.1em" />
        </button>
        <span aria-live="polite" style={{ fontWeight: 600 }}>{title}</span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={monthMode ? "Next year" : "Next month"} onClick={() => moveMonths(monthMode ? 12 : 1)}>
          <ChevronRight size="1.1em" />
        </button>
      </div>

      {monthMode ? (
        <div ref={gridRef} role="grid" className="date-picker-months">
          {Array.from({ length: 12 }, (_, i) => {
            const value = `${year}-${String(i + 1).padStart(2, "0")}-01`;
            const isSelected = selected?.slice(0, 7) === value.slice(0, 7);
            const isFocused = focus.slice(0, 7) === value.slice(0, 7);
            return (
              <button
                key={value}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                data-focused={isFocused}
                tabIndex={isFocused ? 0 : -1}
                className="date-picker-cell"
                data-today={today.slice(0, 7) === value.slice(0, 7)}
                onClick={() => onSelect(value)}
              >
                {new Intl.DateTimeFormat(prefs.locale, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, i, 1)))}
              </button>
            );
          })}
        </div>
      ) : (
        <div ref={gridRef} role="grid" className="date-picker-days">
          {weekdayNames.map((name) => (
            <span key={name} role="columnheader" className="date-picker-weekday">{name}</span>
          ))}
          {days.map((day) => {
            const isSelected = day === selected;
            const isFocused = day === focus;
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={formatPlainDate(day, { ...prefs, dateFormat: "D MMM YYYY" })}
                data-focused={isFocused}
                data-today={day === today}
                data-outside={day.slice(0, 7) !== focus.slice(0, 7)}
                tabIndex={isFocused ? 0 : -1}
                className="date-picker-cell"
                onClick={() => onSelect(day)}
              >
                {Number(day.slice(8, 10))}
              </button>
            );
          })}
        </div>
      )}

      <div className="date-picker-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelect(monthMode ? `${today.slice(0, 7)}-01` : today)}>
          {monthMode ? "This month" : "Today"}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function valueParts(value: string | null | undefined, kind: DateInputKind, prefs: DateDisplayPrefs) {
  if (!value) return null;
  if (kind === "datetime") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const zoned = instantToZonedParts(date, prefs.timeZone);
    return { date: zoned.date, time: { hour: zoned.hour, minute: zoned.minute } };
  }
  const date = normalizePlainDate(value, kind === "month" ? "month" : "day");
  return date ? { date, time: undefined } : null;
}

function formatValue(value: string | null | undefined, kind: DateInputKind, prefs: DateDisplayPrefs): string {
  if (!value) return "";
  if (kind === "month") return formatPlainMonth(value, prefs);
  if (kind === "datetime") return formatInstant(value, prefs);
  return formatPlainDate(value, prefs);
}

function datePlaceholder(prefs: DateDisplayPrefs): string {
  const format = prefs.dateFormat && prefs.dateFormat !== "auto" ? prefs.dateFormat : localeDateOrder(prefs.locale);
  return format === "D MMM YYYY" || format === "MMM D, YYYY" ? formatPlainDate(todayPlainDate(), prefs) : format;
}

function monthPlaceholder(prefs: DateDisplayPrefs): string {
  return formatPlainMonth(todayPlainDate(), prefs);
}

/** "10/2026", "2026-10", "Oct 2026", "October 2026" → the 1st of that month. */
function parseMonthText(text: string, prefs: DateDisplayPrefs): string | null {
  const iso = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (iso) return normalizePlainDate(`${iso[1]}-${iso[2].padStart(2, "0")}`, "month");
  const numeric = /^(\d{1,2})[./\-\s](\d{4})$/.exec(text);
  if (numeric) return normalizePlainDate(`${numeric[2]}-${numeric[1].padStart(2, "0")}`, "month");
  const named = /^([^\d\s,.]+)\.?,?\s+(\d{4})$/.exec(text);
  if (named) {
    const wanted = named[1].toLowerCase();
    for (let m = 1; m <= 12; m++) {
      for (const style of ["short", "long"] as const) {
        const name = new Intl.DateTimeFormat(prefs.locale, { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, m - 1, 1)));
        if (name.toLowerCase().replace(".", "") === wanted.replace(".", "")) {
          return `${named[2]}-${String(m).padStart(2, "0")}-01`;
        }
      }
    }
  }
  return parseDisplayDate(text, prefs) ? normalizePlainDate(parseDisplayDate(text, prefs), "month") : null;
}
