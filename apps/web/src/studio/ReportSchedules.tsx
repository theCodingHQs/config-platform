import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, Mail, Pause, Pencil, Play, Plus, Send, Trash2 } from "lucide-react";
import {
  MAX_SCHEDULE_RECIPIENTS,
  RELATIVE_DATE_TOKENS,
  ReportScheduleInputSchema,
  describeScheduleTiming,
  formatInstant,
  isRelativeDateToken,
  sameTimeZone,
  type ReportSchedule,
  type ReportScheduleInput,
  type ReportScheduleTiming,
} from "@config-platform/schema";
import {
  deleteReportSchedule,
  fetchEmailSettings,
  fetchWorkspaceDateSettings,
  listExportTemplates,
  listReportSchedules,
  saveReportSchedule,
  sendReportScheduleNow,
  type ExportTemplateItem,
} from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { useDateDisplayPrefs } from "../context/date-display-context";
import { WORKSPACE_DATE_SETTINGS_KEY } from "../context/date-settings-provider";
import { useAuth } from "../context/auth-context";
import { DateInput } from "../components/date-input";

const SCHEDULES_KEY = ["report-schedules"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Splits "a@x.com, b@y.com; c@z.com" (or one per line) into addresses */
export function parseRecipients(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)));
}

/** Studio → Report emails: reports sent automatically as Excel attachments. */
export function ReportSchedules() {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const prefs = useDateDisplayPrefs();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const { data: schedules = [], isLoading } = useQuery({ queryKey: SCHEDULES_KEY, queryFn: listReportSchedules });
  const { data: templates = [] } = useQuery({ queryKey: ["export-templates"], queryFn: () => listExportTemplates() });
  const { data: email } = useQuery({ queryKey: ["email-settings"], queryFn: fetchEmailSettings });
  const [editing, setEditing] = useState<ReportSchedule | "new" | null>(null);

  const refresh = (next?: ReportSchedule) => {
    if (next) queryClient.setQueryData<ReportSchedule[]>(SCHEDULES_KEY, (list = []) => list.map((s) => (s.id === next.id ? next : s)));
    queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY });
  };

  const sendNow = useMutation({
    mutationFn: (id: string) => sendReportScheduleNow(id),
    onSuccess: (s) => {
      refresh(s);
      if (s.lastStatus === "sent") notify("success", `${s.templateName} sent to ${s.recipients.length} recipient${s.recipients.length === 1 ? "" : "s"}.`);
      else notify("error", s.lastError || "The report could not be sent");
    },
    onError: (err: Error) => notify("error", err.message),
  });
  const toggle = useMutation({
    mutationFn: (s: ReportSchedule) => saveReportSchedule(toInput(s, { enabled: !s.enabled }), s.id),
    onSuccess: (s) => {
      refresh(s);
      notify("success", s.enabled ? "Schedule resumed." : "Schedule paused. Nothing will be sent until you resume it.");
    },
    onError: (err: Error) => notify("error", err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteReportSchedule(id),
    onSuccess: () => {
      refresh();
      notify("success", "Schedule deleted.");
    },
    onError: (err: Error) => notify("error", err.message),
  });

  // Schedules run on the workspace clock; when the viewer's differs, say which one the times use
  const { data: workspaceDates } = useQuery({ queryKey: WORKSPACE_DATE_SETTINGS_KEY, queryFn: fetchWorkspaceDateSettings });
  const viewerZone = prefs.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const workspaceZoneLabel = workspaceDates?.timeZone && !sameTimeZone(workspaceDates.timeZone, viewerZone) ?`${workspaceDates.timeZone.replace(/_/g, " ")} time` : null;

  const emailsOnlyLogged = email && email.mode === "platform" && !email.platformConfigured;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div>
          <Link to="/studio/export-templates" className="btn btn-ghost btn-sm" style={{ marginBottom: "var(--space-2)" }}>
            <ArrowLeft size="1em" /> Export Templates
          </Link>
          <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Mail size="1em" style={{ color: "var(--accent)" }} /> Report emails
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
            Send reports automatically as Excel attachments, for example the production report every Monday at 7:00.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")} disabled={templates.length === 0}>
          <Plus size="1em" /> New schedule
        </button>
      </div>

      {emailsOnlyLogged && (
        <div role="note" style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start", padding: "var(--space-3) var(--space-4)", background: "var(--warning-subtle)", borderRadius: "var(--radius-surface)", fontSize: "var(--font-size-sm)" }}>
          <Info size="1.1em" style={{ flexShrink: 0, color: "var(--warning)" }} />
          <span>
            Email sending isn't set up on this server yet, so reports are prepared but not delivered.{" "}
            {isAdmin ? (
              <>
                Use your own email account under <Link to="/studio/settings?tab=email">Settings → Email</Link>
                {user?.isPlatformAdmin ? (
                  <>, or set up built-in sending under <Link to="/studio/platform">Platform setup</Link>.</>
                ) : (
                  ", or ask your platform owner to set up built-in sending."
                )}
              </>
            ) : (
              "Ask an admin to set it up under Settings → Email."
            )}
          </span>
        </div>
      )}

      {isLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading schedules…</p>
      ) : schedules.length === 0 ? (
        <div style={{ padding: "var(--space-8) var(--space-4)", textAlign: "center", border: "var(--border-width) dashed var(--border)", borderRadius: "var(--radius-surface)", color: "var(--text-muted)" }}>
          <Mail size="2em" style={{ marginBottom: "var(--space-2)" }} />
          <p style={{ margin: 0 }}>
            {templates.length === 0 ? "Create a report under Export Templates first, then schedule it here." : "No reports are scheduled yet."}
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th>Report</th>
                <th>When</th>
                <th>Recipients</th>
                <th>Last sent</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td data-label="Report" style={dimmed(s)}>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {s.name || s.templateName}
                      {!s.enabled && <span className="badge">Paused</span>}
                    </div>
                    {s.name && <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{s.templateName}</div>}
                  </td>
                  <td data-label="When" style={dimmed(s)}>
                    <div>
                      {describeScheduleTiming(s.timing)}
                      {workspaceZoneLabel && <span style={{ color: "var(--text-muted)" }}> ({workspaceZoneLabel})</span>}
                    </div>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
                      {s.enabled ? (s.nextRunAt ? `Next: ${formatInstant(s.nextRunAt, prefs)}${workspaceZoneLabel ? " your time" : ""}` : "") : "Not sent automatically while paused"}
                    </div>
                  </td>
                  <td data-label="Recipients" title={s.recipients.join(", ")} style={dimmed(s)}>
                    {s.recipients.slice(0, 2).join(", ")}
                    {s.recipients.length > 2 && <span style={{ color: "var(--text-muted)" }}> +{s.recipients.length - 2} more</span>}
                  </td>
                  <td data-label="Last sent" style={dimmed(s)}>
                    {s.lastRunAt ? (
                      <>
                        <span className={`badge ${s.lastStatus === "sent" ? "badge-success" : "badge-danger"}`}>
                          {s.lastStatus === "sent" ? "Sent" : "Failed"}
                        </span>{" "}
                        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{formatInstant(s.lastRunAt, prefs)}</span>
                        {s.lastError && (
                          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--danger)", marginTop: "var(--space-1)", maxWidth: "28rem" }}>{s.lastError}</div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>Not yet</span>
                    )}
                  </td>
                  <td data-label="">
                    <div style={{ display: "flex", gap: "var(--space-1)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={sendNow.isPending} onClick={() => sendNow.mutate(s.id)} title={s.enabled ? "Send it now (doesn't change the schedule)" : "Send it once now (the schedule stays paused)"}>
                        <Send size="1em" /> {sendNow.isPending && sendNow.variables === s.id ? "Sending…" : "Send now"}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle.mutate(s)} aria-label={s.enabled ? "Pause" : "Resume"} title={s.enabled ? "Pause" : "Resume"}>
                        {s.enabled ? <Pause size="1em" /> : <Play size="1em" />}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(s)} aria-label="Edit" title="Edit">
                        <Pencil size="1em" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        style={{ color: "var(--danger)" }}
                        aria-label="Delete"
                        title="Delete"
                        onClick={() => confirm(`Stop emailing "${s.name || s.templateName}" and delete this schedule?`) && remove.mutate(s.id)}
                      >
                        <Trash2 size="1em" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ScheduleDialog
          schedule={editing === "new" ? null : editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            refresh(s);
            setEditing(null);
            notify("success", `Saved. ${describeScheduleTiming(s.timing)}.`);
          }}
        />
      )}
    </div>
  );
}

/** A paused schedule's details are faded; its buttons stay as they are, since they all still work */
function dimmed(s: ReportSchedule): React.CSSProperties | undefined {
  return s.enabled ? undefined : { opacity: 0.6 };
}

function toInput(s: ReportSchedule, patch: Partial<ReportScheduleInput> = {}): ReportScheduleInput {
  return {
    templateId: s.templateId,
    name: s.name,
    timing: s.timing,
    recipients: s.recipients,
    subject: s.subject,
    message: s.message,
    parameters: s.parameters,
    enabled: s.enabled,
    ...patch,
  };
}

interface TemplateParameter {
  id: string;
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  defaultValue?: unknown;
}

function templateParameters(t: ExportTemplateItem | undefined): TemplateParameter[] {
  const def = t?.published || t?.draft;
  return Array.isArray(def?.parameters) ? def.parameters : [];
}

function ScheduleDialog({
  schedule,
  templates,
  onClose,
  onSaved,
}: {
  schedule: ReportSchedule | null;
  templates: ExportTemplateItem[];
  onClose: () => void;
  onSaved: (s: ReportSchedule) => void;
}) {
  const { user } = useAuth();
  const { data: workspace } = useQuery({ queryKey: WORKSPACE_DATE_SETTINGS_KEY, queryFn: fetchWorkspaceDateSettings });
  const [templateId, setTemplateId] = useState(schedule?.templateId ?? templates[0]?.id ?? "");
  const [name, setName] = useState(schedule?.name ?? "");
  const [timing, setTiming] = useState<ReportScheduleTiming>(schedule?.timing ?? { frequency: "weekly", weekday: 1, timeOfDay: "07:00" });
  const [recipientsText, setRecipientsText] = useState(schedule?.recipients.join(", ") ?? user?.email ?? "");
  const [subject, setSubject] = useState(schedule?.subject ?? "");
  const [message, setMessage] = useState(schedule?.message ?? "");
  const [parameters, setParameters] = useState<Record<string, string | number>>(schedule?.parameters ?? {});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const template = templates.find((t) => t.id === templateId);
  const params = useMemo(() => templateParameters(template), [template]);

  // Date inputs of a newly chosen report default to following the calendar
  useEffect(() => {
    if (schedule && schedule.templateId === templateId) return;
    setParameters(
      Object.fromEntries(
        params.filter((p) => p.type === "date").map((p) => [p.name, p.name.toLowerCase().includes("month") ? "@this_month_start" : "@today"]),
      ),
    );
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const input: ReportScheduleInput = {
    templateId,
    name: name.trim() || undefined,
    timing,
    recipients: parseRecipients(recipientsText),
    subject: subject.trim() || undefined,
    message: message.trim() || undefined,
    parameters: Object.fromEntries(Object.entries(parameters).filter(([, v]) => v !== "")),
    enabled: schedule?.enabled ?? true,
  };

  const save = useMutation({
    mutationFn: () => {
      const parsed = ReportScheduleInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      return saveReportSchedule(parsed.data, schedule?.id);
    },
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  const label: React.CSSProperties = { display: "block", fontSize: "var(--font-size-sm)", fontWeight: 600, marginBottom: "var(--space-1)" };
  const hint: React.CSSProperties = { margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" };
  const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "var(--space-3)" };

  return (
    <div
      className="runtime-modal-overlay"
      style={{ position: "fixed", inset: 0, backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "var(--space-4)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={schedule ? "Edit report email" : "New report email"}
        className="runtime-modal"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
        style={{ backgroundColor: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius-surface)", border: "var(--border-width) solid var(--border)", boxShadow: "var(--shadow-xl)", width: "min(40rem, 100%)", maxHeight: "calc(100vh - 2 * var(--space-4))", overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ padding: "var(--space-5) var(--space-6) 0" }}>
          <h3 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600 }}>{schedule ? "Edit report email" : "New report email"}</h3>
          <p style={hint}>
            Times are in the workspace time zone{workspace?.timeZone ? ` (${workspace.timeZone})` : ""}. The report is built with your
            permissions each time it's sent.
          </p>
        </div>

        <div style={{ padding: "var(--space-4) var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={row}>
            <div>
              <label style={label} htmlFor="rs-report">Report</label>
              <select id="rs-report" className="form-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label} htmlFor="rs-name">Name (optional)</label>
              <input id="rs-name" className="form-input" value={name} placeholder={template?.name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div style={row}>
            <div>
              <label style={label} htmlFor="rs-frequency">How often</label>
              <select
                id="rs-frequency"
                className="form-select"
                value={timing.frequency}
                onChange={(e) => {
                  const frequency = e.target.value as ReportScheduleTiming["frequency"];
                  setTiming({
                    frequency,
                    timeOfDay: timing.timeOfDay,
                    ...(frequency === "weekly" ? { weekday: timing.weekday ?? 1 } : {}),
                    ...(frequency === "monthly" ? { dayOfMonth: timing.dayOfMonth ?? 1 } : {}),
                  });
                }}
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Monday to Friday</option>
                <option value="weekly">Once a week</option>
                <option value="monthly">Once a month</option>
              </select>
            </div>
            {timing.frequency === "weekly" && (
              <div>
                <label style={label} htmlFor="rs-weekday">On</label>
                <select id="rs-weekday" className="form-select" value={timing.weekday} onChange={(e) => setTiming({ ...timing, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            )}
            {timing.frequency === "monthly" && (
              <div>
                <label style={label} htmlFor="rs-day">On day</label>
                <select id="rs-day" className="form-select" value={timing.dayOfMonth} onChange={(e) => setTiming({ ...timing, dayOfMonth: Number(e.target.value) })}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d >= 29 ? `${d} (or the month's last day)` : d}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={label} htmlFor="rs-time">At</label>
              <input id="rs-time" type="time" className="form-input" value={timing.timeOfDay} required onChange={(e) => setTiming({ ...timing, timeOfDay: e.target.value })} />
            </div>
          </div>

          {params.length > 0 && (
            <fieldset style={{ border: "var(--border-width) solid var(--border)", borderRadius: "var(--radius-surface)", padding: "var(--space-3)", margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <legend style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, padding: "0 var(--space-1)" }}>Report inputs</legend>
              {params.map((p) => (
                <ParameterField key={p.id} param={p} value={parameters[p.name]} onChange={(v) => setParameters({ ...parameters, [p.name]: v })} />
              ))}
            </fieldset>
          )}

          <div>
            <label style={label} htmlFor="rs-to">Send to</label>
            <textarea id="rs-to" className="form-input" rows={2} value={recipientsText} placeholder="plant.manager@company.com, quality@company.com" onChange={(e) => setRecipientsText(e.target.value)} />
            <p style={hint}>Separate addresses with commas. Up to {MAX_SCHEDULE_RECIPIENTS}; they don't need an account.</p>
          </div>

          <div>
            <label style={label} htmlFor="rs-subject">Subject (optional)</label>
            <input id="rs-subject" className="form-input" value={subject} placeholder={`${template?.name ?? "Report"} – <today's date>`} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="rs-message">Message (optional)</label>
            <textarea id="rs-message" className="form-input" rows={3} value={message} placeholder={`Please find the ${template?.name ?? "report"} attached.`} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {error && (
            <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{error}</p>
          )}
        </div>

        <div style={{ padding: "0 var(--space-6) var(--space-5)", display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !templateId}>
            {save.isPending ? "Saving…" : schedule ? "Save changes" : "Schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A report input: date inputs can follow the calendar ("start of this month") or be a fixed day */
function ParameterField({ param, value, onChange }: { param: TemplateParameter; value: string | number | undefined; onChange: (v: string) => void }) {
  const id = `rs-param-${param.id}`;
  const title = `${param.label || param.name}${param.required ? "" : " (optional)"}`;
  const label: React.CSSProperties = { display: "block", fontSize: "var(--font-size-sm)", fontWeight: 500, marginBottom: "var(--space-1)" };

  const relative = isRelativeDateToken(value);
  const [fixed, setFixed] = useState(!relative && Boolean(value));
  if (param.type === "date") {
    const mode = relative ? String(value) : fixed ? "fixed" : "";
    return (
      <div>
        <label style={label} htmlFor={id}>{title}</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "var(--space-2)" }}>
          <select
            id={id}
            className="form-select"
            value={mode}
            onChange={(e) => {
              setFixed(e.target.value === "fixed");
              onChange(e.target.value === "fixed" ? "" : e.target.value);
            }}
          >
            {(!param.required || mode === "") && <option value="">Report default</option>}
            {RELATIVE_DATE_TOKENS.map((t) => (
              <option key={t.value} value={t.value}>{t.label} (on the day it's sent)</option>
            ))}
            <option value="fixed">A fixed date…</option>
          </select>
          {mode === "fixed" && (
            <DateInput value={(value as string) || null} onChange={(v) => onChange(v ?? "")} aria-label={`${title}: fixed date`} />
          )}
        </div>
      </div>
    );
  }
  return (
    <div>
      <label style={label} htmlFor={id}>{title}</label>
      <input id={id} className="form-input" type={param.type === "number" ? "number" : "text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
