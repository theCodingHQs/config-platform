import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, X } from "lucide-react";
import {
  installSolutionTemplate,
  listSolutionTemplates,
  type SolutionInstallResult,
  type SolutionTemplateCard,
} from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { DynamicIcon } from "../components/dynamic-icon";

/**
 * Template gallery: ready-made apps for factories (Production Tracker, Maintenance Log, Quality
 * Inspections, Shift Handover, Downtime Log). Installing one adds its data, pages and reports.
 */
export function TemplateGallery({
  tenantId,
  onClose,
  onInstalled,
}: {
  tenantId: string;
  onClose: () => void;
  onInstalled: (result: SolutionInstallResult) => void;
}) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { data: templates = [], isLoading } = useQuery({ queryKey: ["solution-templates"], queryFn: listSolutionTemplates });
  const [chosen, setChosen] = useState<SolutionTemplateCard | null>(null);
  const [sampleData, setSampleData] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<SolutionInstallResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !installing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, installing]);

  const install = async () => {
    if (!chosen) return;
    setInstalling(true);
    try {
      const installed = await installSolutionTemplate(chosen.id, sampleData);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schema-entities", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["page-navigation", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["published-pages", tenantId] }),
      ]);
      setResult(installed);
      onInstalled(installed);
      notify("success", `${chosen.name} is installed.`);
    } catch (err: any) {
      notify("error", err.message || "The template couldn't be installed", { durationMs: 0 });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "var(--space-4)" }}
      onMouseDown={(e) => e.target === e.currentTarget && !installing && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Templates"
        style={{ backgroundColor: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius-surface)", border: "var(--border-width) solid var(--border)", boxShadow: "var(--shadow-xl)", width: "min(60rem, 100%)", maxHeight: "calc(100vh - 2 * var(--space-4))", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) var(--space-6)", borderBottom: "var(--border-width-sm) solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <LayoutGrid size="1.1em" style={{ color: "var(--accent)" }} /> Templates
          </h3>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose} disabled={installing}>
            <X size="1.1em" />
          </button>
        </div>

        <div style={{ padding: "var(--space-4) var(--space-6)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {result && chosen ? (
            <div role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <p style={{ margin: 0, fontSize: "var(--font-size-base)" }}>
                <strong>{chosen.name}</strong> is ready{result.sampleRecords ? ` with ${result.sampleRecords} sample records` : ""}.
              </p>
              <ul style={{ margin: 0, paddingLeft: "var(--space-5)", fontSize: "var(--font-size-sm)" }}>
                <li>
                  Data: {result.entities.map((e) => `${e.label}${e.reused ? " (your existing one)" : ""}`).join(", ")}, in Data Entities.
                </li>
                {result.pages.length > 0 && <li>Pages: {result.pages.map((p) => p.name).join(", ")}, in the sidebar under {chosen.folder}.</li>}
                {result.reports.length > 0 && <li>Excel reports: {result.reports.map((r) => r.name).join(", ")}, in Export Templates.</li>}
              </ul>
              {result.warnings.map((w) => (
                <p key={w} style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--warning)" }}>{w}</p>
              ))}
            </div>
          ) : (
            <>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                Ready-made apps for factory and operations teams. Each adds its data, pages and an Excel report, which you can change afterwards like anything you build yourself.
              </p>
              {isLoading && <p style={{ margin: 0, color: "var(--text-muted)" }}>Loading templates…</p>}
              <div role="radiogroup" aria-label="Templates" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "var(--space-3)" }}>
                {templates.map((t) => {
                  const active = chosen?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setChosen(t)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-2)",
                        textAlign: "left",
                        padding: "var(--space-3)",
                        borderRadius: "var(--radius-surface)",
                        border: active ? "var(--border-width-md) solid var(--accent)" : "var(--border-width-sm) solid var(--border)",
                        background: active ? "var(--accent-subtle)" : "var(--surface)",
                        color: "var(--text)",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 600 }}>
                        <DynamicIcon name={t.icon} size="1.2em" style={{ color: "var(--accent)" }} /> {t.name}
                      </span>
                      <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{t.summary}</span>
                    </button>
                  );
                })}
              </div>

              {chosen && (
                <section aria-label={`${chosen.name} details`} style={{ borderTop: "var(--border-width-sm) solid var(--border)", paddingTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
                  <p style={{ margin: 0 }}>{chosen.description}</p>
                  <ul style={{ margin: 0, paddingLeft: "var(--space-5)", color: "var(--text-muted)" }}>
                    <li>Data: {chosen.entities.join(", ")}</li>
                    <li>Pages ({chosen.folder} in the sidebar): {chosen.pages.join(", ")}</li>
                    <li>Excel report: {chosen.reports.join(", ")}</li>
                  </ul>
                  {chosen.hasSampleData && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <input type="checkbox" checked={sampleData} onChange={(e) => setSampleData(e.target.checked)} />
                      Add sample data to explore it (delete it before going live)
                    </label>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", padding: "var(--space-4) var(--space-6)", borderTop: "var(--border-width-sm) solid var(--border)" }}>
          {result ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={installing}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={install} disabled={!chosen || installing}>
                {installing ? "Installing…" : chosen ? `Install ${chosen.name}` : "Choose a template"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
