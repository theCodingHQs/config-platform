import React, { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import {
  buildExecutiveReportTemplate,
  formatPlainDate,
  formatPlainMonth,
  normalizePlainDate,
  WIZARD_FIELD_KINDS,
  type DateDisplayPrefs,
  type ErdTable,
  type WizardColumnSuggestion,
  type WizardDateFormat,
  type WizardFieldKind,
} from "@config-platform/schema";
import {
  ApiError,
  analyzeSheet,
  createExportTemplate,
  createFromSheet,
  createPage,
  publishPage,
  type SheetAnalysis,
} from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { useDateDisplayPrefs } from "../context/date-display-context";
import { IconPicker } from "../components/icon-picker";
import { createTemplatePage } from "./templates";

/**
 * An example cell as people will see it: real spreadsheet dates (read as 2026-10-01T00:00:00.000Z)
 * in the viewer's date format; dates typed as text stay as written (how they're read is chosen above).
 */
export function exampleText(sample: unknown, kind: WizardFieldKind, prefs: DateDisplayPrefs): string {
  const text = String(sample);
  if ((kind === "date" || kind === "month") && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const plain = normalizePlainDate(text, kind === "month" ? "month" : "day");
    if (plain) return kind === "month" ? formatPlainMonth(plain, prefs) : formatPlainDate(plain, prefs);
  }
  return text;
}

const KIND_LABELS: Record<WizardFieldKind, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / No (checkbox)",
  date: "Date",
  month: "Month",
  select: "Choice list",
};

export interface ImportWizardResult {
  entityId: string;
  insertedCount: number;
  pageId?: string;
  reportId?: string;
  /** Extras that couldn't be created (the entity and its records were) */
  warnings?: string[];
}

type Step = "file" | "review" | "done";

/**
 * "Start from an Excel sheet": upload a spreadsheet, review the suggested fields, and get a
 * data entity with every row imported, plus (optionally) a page to work with it and an Excel
 * report, in one go.
 */
export function ImportWizard({
  tenantId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  onClose: () => void;
  /** Called after creation (e.g. to select the new entity) */
  onCreated: (result: ImportWizardResult) => void;
}) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const ids = { file: useId(), label: useId(), name: useId(), sheet: useId(), dates: useId() };

  const datePrefs = useDateDisplayPrefs();
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [columns, setColumns] = useState<WizardColumnSuggestion[]>([]);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [icon, setIcon] = useState("Table");
  const [dateFormat, setDateFormat] = useState<WizardDateFormat>("ISO");
  const [makePage, setMakePage] = useState(true);
  const [makeReport, setMakeReport] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Array<{ row?: number; column?: string; message: string }>>([]);
  const [result, setResult] = useState<ImportWizardResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const analyze = async (chosen: File, sheetName?: string) => {
    setBusy("Reading the sheet…");
    setRowErrors([]);
    try {
      const res = await analyzeSheet(chosen, sheetName);
      setAnalysis(res);
      setColumns(res.columns);
      setDateFormat(res.dateFormat);
      if (!sheetName) {
        setLabel(res.suggestedLabel);
        if (!nameTouched) setName(res.suggestedName);
      }
      setStep("review");
    } catch (err: any) {
      notify("error", err.message || "Couldn't read that file");
    } finally {
      setBusy(null);
    }
  };

  const slug = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(?=\d)/, "e_").slice(0, 60) || "imported_data";

  const updateColumn = (index: number, patch: Partial<WizardColumnSuggestion>) =>
    setColumns((cols) => cols.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const included = columns.filter((c) => c.include);
  const hasDates = included.some((c) => c.kind === "date" || c.kind === "month");

  const create = async () => {
    if (!file || !analysis) return;
    setRowErrors([]);
    setBusy(`Creating ${label} and importing ${analysis.rowCount} rows…`);
    try {
      const created = await createFromSheet(file, {
        entityName: name,
        entityLabel: label.trim(),
        icon,
        sheetName: analysis.selectedSheet,
        dateFormat,
        columns: columns.map(({ header, include, name: fieldName, label: fieldLabel, kind, options }) => ({
          header, include, name: fieldName, label: fieldLabel, kind, ...(options ? { options } : {}),
        })),
      });
      const entity: ErdTable = {
        id: created.entity.id,
        name: created.entity.name,
        label: created.entity.label,
        physicalTableName: created.entity.physicalTableName,
        version: created.entity.version,
        columns: created.fields.map((f) => ({ ...f, isPrimary: false, isForeignKey: f.type === "reference" })),
      };
      const done: ImportWizardResult = { entityId: entity.id, insertedCount: created.insertedCount };
      const warnings: string[] = [];

      // The page and report are extras: if one can't be made, the entity and its records stay
      if (makePage) {
        setBusy("Creating the page…");
        try {
          const route = `/${entity.name.replace(/_/g, "-")}`;
          const page = await createPage(tenantId, {
            name: entity.label,
            route,
            draft: createTemplatePage("CRUD list", `p_${entity.name}`, route, entity),
          });
          await publishPage(tenantId, page.id);
          done.pageId = page.id;
        } catch (err: any) {
          warnings.push(`The page wasn't created: ${err.message}. You can build one in Pages.`);
        }
      }
      if (makeReport) {
        setBusy("Creating the Excel report…");
        try {
          const report = await createExportTemplate({
            name: `${entity.label} report`,
            entityId: entity.id,
            draft: buildExecutiveReportTemplate(entity),
          });
          done.reportId = report.id;
        } catch (err: any) {
          warnings.push(`The report wasn't created: ${err.message}. You can create one in Export Templates.`);
        }
      }
      if (warnings.length) done.warnings = warnings;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schema-entities", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["page-navigation", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["published-pages", tenantId] }),
      ]);
      setResult(done);
      setStep("done");
      onCreated(done);
    } catch (err: any) {
      if (err instanceof ApiError && Array.isArray(err.errors) && err.errors.length) {
        // Rows that don't fit the chosen types: nothing was created, adjust and try again
        setRowErrors(err.errors);
        notify("error", err.message);
      } else {
        notify("error", err.message || "Couldn't create it");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "var(--space-4)" }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start from an Excel sheet"
        style={{ backgroundColor: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius-surface)", border: "var(--border-width) solid var(--border)", boxShadow: "var(--shadow-xl)", width: "min(64rem, 100%)", maxHeight: "calc(100vh - 2 * var(--space-4))", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) var(--space-6)", borderBottom: "var(--border-width-sm) solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <FileSpreadsheet size="1.1em" style={{ color: "var(--accent)" }} /> Start from an Excel sheet
          </h3>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose} disabled={Boolean(busy)}>
            <X size="1.1em" />
          </button>
        </div>

        <div style={{ padding: "var(--space-4) var(--space-6)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {busy && <p role="status" style={{ margin: 0, color: "var(--text-muted)" }}>{busy}</p>}

          {step === "file" && !busy && (
            <label
              htmlFor={ids.file}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-8) var(--space-4)", border: "var(--border-width-md) dashed var(--border)", borderRadius: "var(--radius-surface)", cursor: "pointer", textAlign: "center" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) {
                  setFile(dropped);
                  analyze(dropped);
                }
              }}
            >
              <Upload size="2em" style={{ color: "var(--accent)" }} />
              <strong>Choose an Excel or CSV file</strong>
              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
                or drop it here. The first row should hold the column titles. Nothing is created until you confirm.
              </span>
              <input
                id={ids.file}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                className="sr-only"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) {
                    setFile(chosen);
                    analyze(chosen);
                  }
                }}
              />
            </label>
          )}

          {step === "review" && analysis && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--space-3)" }}>
                <div>
                  <label className="form-label" htmlFor={ids.label}>Name</label>
                  <input
                    id={ids.label}
                    className="form-input"
                    value={label}
                    onChange={(e) => {
                      setLabel(e.target.value);
                      if (!nameTouched) setName(slug(e.target.value));
                    }}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor={ids.name}>System name</label>
                  <input
                    id={ids.name}
                    className="form-input"
                    value={name}
                    style={{ fontFamily: "var(--font-mono)" }}
                    onChange={(e) => {
                      setNameTouched(true);
                      setName(e.target.value.toLowerCase());
                    }}
                  />
                </div>
                <IconPicker label="Icon" value={icon} onChange={setIcon} />
                {analysis.sheets.length > 1 && (
                  <div>
                    <label className="form-label" htmlFor={ids.sheet}>Sheet</label>
                    <select
                      id={ids.sheet}
                      className="form-select"
                      value={analysis.selectedSheet}
                      onChange={(e) => file && analyze(file, e.target.value)}
                    >
                      {analysis.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {hasDates && (
                  <div>
                    <label className="form-label" htmlFor={ids.dates}>Dates typed as text are written</label>
                    <select id={ids.dates} className="form-select" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as WizardDateFormat)}>
                      <option value="ISO">Year-Month-Day (2026-10-25)</option>
                      <option value="DD/MM/YYYY">Day/Month/Year (25/10/2026)</option>
                      <option value="MM/DD/YYYY">Month/Day/Year (10/25/2026)</option>
                    </select>
                    {analysis.dateFormatAmbiguous && (
                      <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--warning)" }}>
                        The file's dates could be either order. Check this.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
                {analysis.rowCount} rows found. Check what each column becomes; untick columns you don't need.
              </p>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Import</th>
                      <th>Column in the file</th>
                      <th>Field name</th>
                      <th>Type</th>
                      <th>Examples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col, index) => (
                      <tr key={col.header} style={{ opacity: col.include ? 1 : 0.55 }}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Import ${col.header}`}
                            checked={col.include}
                            onChange={(e) => updateColumn(index, { include: e.target.checked })}
                          />
                        </td>
                        <td style={{ color: "var(--text-muted)" }}>{col.header || "(no title)"}</td>
                        <td>
                          <input
                            className="form-input form-control-sm"
                            aria-label={`Field name for ${col.header}`}
                            value={col.label}
                            disabled={!col.include}
                            onChange={(e) => updateColumn(index, { label: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="form-select form-control-sm"
                            aria-label={`Type for ${col.header}`}
                            value={col.kind}
                            disabled={!col.include}
                            onChange={(e) => {
                              const kind = e.target.value as WizardFieldKind;
                              updateColumn(index, {
                                kind,
                                options: kind === "select" ? col.options ?? [...new Set(col.samples)] : col.options,
                              });
                            }}
                          >
                            {WIZARD_FIELD_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                          </select>
                        </td>
                        <td style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", maxWidth: "16rem" }}>
                          {col.kind === "select" && col.options
                            ? `${col.options.length} choices: ${col.options.slice(0, 4).join(", ")}${col.options.length > 4 ? "…" : ""}`
                            : col.samples.map((sample) => exampleText(sample, col.kind, datePrefs)).join(", ") || "(empty)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <legend className="form-label">Also create</legend>
                <label style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
                  <input type="checkbox" checked={makePage} onChange={(e) => setMakePage(e.target.checked)} />
                  A page to see, add and edit {label || "records"} (published)
                </label>
                <label style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
                  <input type="checkbox" checked={makeReport} onChange={(e) => setMakeReport(e.target.checked)} />
                  An Excel report of {label || "the records"}
                </label>
              </fieldset>

              {rowErrors.length > 0 && (
                <div role="alert" style={{ border: "var(--border-width-sm) solid var(--danger)", borderRadius: "var(--radius-control)", padding: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
                  <strong>Nothing was created: some rows don't fit the chosen types.</strong>
                  <p style={{ margin: "var(--space-1) 0" }}>Change those columns' type (Text accepts anything), or fix the file, then create again.</p>
                  <ul style={{ margin: 0, paddingLeft: "var(--space-5)" }}>
                    {rowErrors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e.row ? `Row ${e.row}` : "Row"}{e.column ? `, ${e.column}` : ""}: {e.message}</li>
                    ))}
                  </ul>
                  {rowErrors.length > 10 && <p style={{ margin: "var(--space-1) 0 0" }}>…and {rowErrors.length - 10} more.</p>}
                </div>
              )}
            </>
          )}

          {step === "done" && result && (
            <div role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <p style={{ margin: 0, fontSize: "var(--font-size-base)" }}>
                <strong>{label}</strong> is ready with {result.insertedCount} records.
              </p>
              <ul style={{ margin: 0, paddingLeft: "var(--space-5)", fontSize: "var(--font-size-sm)" }}>
                <li>Its fields are listed in Data Entities, where you can add calculated fields or duplicate rules.</li>
                {result.pageId && <li>The page is in Pages and the sidebar.</li>}
                {result.reportId && <li>The Excel report is in Export Templates.</li>}
              </ul>
              {result.warnings?.map((warning) => (
                <p key={warning} style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--warning)" }}>{warning}</p>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-4) var(--space-6)", borderTop: "var(--border-width-sm) solid var(--border)" }}>
          <div>
            {step === "review" && (
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setStep("file"); setAnalysis(null); setRowErrors([]); }}>
                Choose another file
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {step === "done" ? (
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
                {step === "review" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={Boolean(busy) || included.length === 0 || !label.trim() || !/^[a-z][a-z0-9_]*$/.test(name)}
                    onClick={create}
                  >
                    Create {label || "entity"} ({analysis?.rowCount ?? 0} rows)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
