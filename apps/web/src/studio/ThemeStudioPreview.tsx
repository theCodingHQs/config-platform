import React from "react";
import { TrendingUp } from "lucide-react";
import type { ThemeDensityOverride, ThemeLayoutOverride } from "@config-platform/schema";
import type { ThemeTabId } from "./ThemeSettingsTabs";
import { ThemeLayoutPreview } from "./ThemeLayoutPreview";

type PreviewPart = "modal" | "card" | "input" | "buttons" | "badges" | "table" | "typeScale" | "controlRow" | "layout";

/** The preview parts that respond to each settings tab. */
const PARTS_BY_TAB: Record<ThemeTabId, PreviewPart[]> = {
  colors: ["buttons", "badges", "card", "input", "table"],
  shape: ["modal", "card", "input", "buttons", "table"],
  spacing: ["typeScale", "controlRow", "card", "table"],
  layout: ["layout"],
};

export const PREVIEW_HINT: Record<ThemeTabId, string> = {
  colors: "Accent and semantic colors on buttons, badges, focus rings and data.",
  shape: "Corner radius on surfaces and controls.",
  spacing: "Type scale, control heights and spacing at the current density.",
  layout: "How published pages use the screen.",
};

const cell: React.CSSProperties = {
  // Spacing tokens, so density changes show in the preview
  padding: "var(--spacing-2) var(--spacing-3)",
  textAlign: "left",
};

export function ThemeStudioPreview({
  tab,
  layout,
  density,
  onOpenModal,
}: {
  tab: ThemeTabId;
  layout: ThemeLayoutOverride;
  density: ThemeDensityOverride | undefined;
  onOpenModal: () => void;
}) {
  const parts = PARTS_BY_TAB[tab];
  const show = (part: PreviewPart) => parts.includes(part);

  return (
    <div data-testid={`preview-${tab}`} style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-5)" }}>
      {show("layout") && <ThemeLayoutPreview layout={layout} density={density} />}

      {show("typeScale") && (
        <div data-testid="preview-type-scale">
          <span className="form-label">Type Scale</span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-2)",
              padding: "var(--spacing-4)",
              border: "var(--border-width-sm) solid var(--border)",
              borderRadius: "var(--radius-surface)",
              backgroundColor: "var(--surface)",
            }}
          >
            {[
              { label: "Page title", size: "--font-size-2xl", weight: 600 },
              { label: "Section heading", size: "--font-size-xl", weight: 600 },
              { label: "Card title", size: "--font-size-lg", weight: 600 },
              { label: "Body text for labels, inputs and table cells", size: "--font-size-sm", weight: 400 },
              { label: "Caption and helper text", size: "--font-size-xs", weight: 400 },
            ].map((row) => (
              <div key={row.size} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--spacing-3)" }}>
                <span style={{ fontSize: `var(${row.size})`, fontWeight: row.weight, color: "var(--text)" }}>{row.label}</span>
                <code style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{row.size.replace("--font-size-", "")}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {show("controlRow") && (
        <div data-testid="preview-control-row">
          <span className="form-label">Controls in a Row</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--spacing-2)" }}>
            <input aria-label="Preview search" type="text" className="form-input" placeholder="Search…" style={{ flex: "1 1 160px", width: "auto" }} />
            <select aria-label="Preview filter" className="form-select" style={{ flex: "0 1 140px", width: "auto" }}>
              <option>All statuses</option>
            </select>
            <button type="button" className="btn btn-primary">Apply</button>
            <button type="button" className="btn btn-secondary btn-sm">Small</button>
          </div>
          <p style={{ margin: "var(--spacing-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
            Inputs and buttons share one height per size, so mixed rows line up.
          </p>
        </div>
      )}

      {show("modal") && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-2)" }}>
            <span className="form-label" style={{ margin: 0 }}>Modal (radius capped at 16px)</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenModal}>
              Open Overlay
            </button>
          </div>
          <div
            data-testid="preview-modal-box"
            style={{
              backgroundColor: "var(--surface)",
              borderRadius: "var(--radius-surface)",
              border: "var(--border-width-sm) solid var(--border)",
              boxShadow: "var(--shadow-md)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "var(--spacing-3) var(--spacing-4)",
                borderBottom: "var(--border-width-sm) solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--surface-2)",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>Modal Header</span>
              <span aria-hidden="true" style={{ color: "var(--text-muted)", fontSize: "var(--font-size-xs)" }}>✕</span>
            </div>
            <div style={{ padding: "var(--spacing-3) var(--spacing-4)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
              Surfaces cap their radius so “Full” doesn&apos;t turn windows into pills.
            </div>
          </div>
        </div>
      )}

      {show("card") && (
        <div>
          <span className="form-label">Card Surface</span>
          <div
            data-testid="preview-card-box"
            style={{
              padding: "var(--spacing-5)",
              borderRadius: "var(--radius-surface)",
              backgroundColor: "var(--surface-2)",
              border: "var(--border-width-sm) solid var(--border)",
            }}
          >
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", marginBottom: "var(--spacing-1)" }}>
              MONTHLY ACTIVE USERS
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--spacing-3)" }}>
              <span style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--text)" }}>24,580</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--spacing-1)", fontSize: "var(--font-size-xs)", color: "var(--success)", fontWeight: 600 }}>
                <TrendingUp size={14} /> +12.4%
              </span>
            </div>
          </div>
        </div>
      )}

      {show("input") && (
        <div>
          <label className="form-label" htmlFor="preview-input">
            Input (focus it to see the accent ring)
          </label>
          <input id="preview-input" type="text" className="form-input" defaultValue="Editable theme input" />
        </div>
      )}

      {show("buttons") && (
        <div>
          <span className="form-label">Buttons</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-2)" }}>
            <button type="button" className="btn btn-primary">Primary Accent</button>
            <button type="button" className="btn btn-secondary">Secondary</button>
            <button type="button" className="btn btn-danger">Danger</button>
            <button type="button" className="btn btn-ghost">Ghost</button>
          </div>
        </div>
      )}

      {show("badges") && (
        <div>
          <span className="form-label">Semantic Badges</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-2)" }}>
            <span className="badge badge-accent">Accent</span>
            <span className="badge badge-success">Success</span>
            <span className="badge badge-warning">Warning</span>
            <span className="badge badge-danger">Danger</span>
          </div>
        </div>
      )}

      {show("table") && (
        <div>
          <span className="form-label">Table Surface</span>
          <div
            data-testid="preview-table-box"
            style={{ overflow: "hidden", borderRadius: "var(--radius-surface)", border: "var(--border-width-sm) solid var(--border)" }}
          >
            <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--surface-2)", borderBottom: "var(--border-width-sm) solid var(--border)" }}>
                  <th style={{ ...cell, fontSize: "var(--font-size-xs)", fontWeight: 600 }}>Entity</th>
                  <th style={{ ...cell, fontSize: "var(--font-size-xs)", fontWeight: 600 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "var(--border-width-sm) solid var(--border-subtle)" }}>
                  <td style={{ ...cell, fontSize: "var(--font-size-sm)" }}>Orders</td>
                  <td style={cell}><span className="badge badge-success">Active</span></td>
                </tr>
                <tr>
                  <td style={{ ...cell, fontSize: "var(--font-size-sm)" }}>Customers</td>
                  <td style={cell}><span className="badge badge-accent">Syncing</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
