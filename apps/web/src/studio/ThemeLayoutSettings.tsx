import React, { useEffect, useState } from "react";
import {
  CONTENT_WIDTH_PRESETS,
  LAYOUT_CONTENT_WIDTH_MIN,
  LAYOUT_CONTENT_WIDTH_MAX,
  LAYOUT_PAGE_PADDING_MAX,
  LAYOUT_SIDEBAR_WIDTH_MIN,
  LAYOUT_SIDEBAR_WIDTH_MAX,
  ThemeLayoutOverrideSchema,
  resolveLayout,
  type ThemeDensityOverride,
  type ThemeLayoutOverride,
} from "@config-platform/schema";

type NumericKey = "contentWidth" | "pagePadding" | "sidebarWidth";

interface ThemeLayoutSettingsProps {
  layout: ThemeLayoutOverride;
  density: ThemeDensityOverride | undefined;
  canEdit: boolean;
  onChange: (next: ThemeLayoutOverride) => void;
  /** Reports whether any typed value is invalid, so the page can block saving. */
  onValidityChange: (valid: boolean) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  color: "var(--text)",
};
const hintStyle: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "var(--font-size-xs)",
  color: "var(--text-muted)",
};

function cardStyle(isSelected: boolean): React.CSSProperties {
  return {
    padding: "var(--spacing-2)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-control)",
    border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border)",
    backgroundColor: isSelected ? "var(--accent-subtle)" : "var(--surface)",
  };
}

function SettingHeader({
  htmlFor,
  label,
  isOverridden,
  canEdit,
  onClear,
}: {
  htmlFor?: string;
  label: string;
  isOverridden: boolean;
  canEdit: boolean;
  onClear: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
      <label htmlFor={htmlFor} style={labelStyle}>{label}</label>
      {isOverridden && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canEdit}
          onClick={onClear}
          style={{ fontSize: "var(--font-size-xs)", padding: "0.15rem 0.5rem", color: "var(--text-muted)" }}
        >
          Clear override
        </button>
      )}
    </div>
  );
}

/** Slider + number field for a px setting; invalid typed values are shown but not applied. */
function PxField({
  id,
  value,
  min,
  max,
  step = 1,
  canEdit,
  error,
  onInput,
  ariaLabel,
}: {
  id: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  canEdit: boolean;
  error: string | null;
  onInput: (raw: string) => void;
  ariaLabel: string;
}) {
  const numeric = Number(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <input
        type="range"
        aria-label={`${ariaLabel} slider`}
        min={min}
        max={max}
        step={step}
        disabled={!canEdit}
        value={Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min}
        onChange={(e) => onInput(e.target.value)}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <input
        id={id}
        type="number"
        className={`form-input${error ? " is-invalid" : ""}`}
        min={min}
        max={max}
        step={step}
        disabled={!canEdit}
        value={value}
        onChange={(e) => onInput(e.target.value)}
        style={{ width: "96px" }}
      />
      <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>px</span>
    </div>
  );
}

export function ThemeLayoutSettings({ layout, density, canEdit, onChange, onValidityChange }: ThemeLayoutSettingsProps) {
  const resolved = resolveLayout(layout, density);

  // Raw text per numeric field, so intermediate keystrokes are allowed
  const rawFrom = (key: NumericKey) => {
    const v = resolved[key];
    return v === "full" ? "" : String(v);
  };
  const [raw, setRaw] = useState<Record<NumericKey, string>>({
    contentWidth: rawFrom("contentWidth"),
    pagePadding: rawFrom("pagePadding"),
    sidebarWidth: rawFrom("sidebarWidth"),
  });
  const [errors, setErrors] = useState<Record<NumericKey, string | null>>({
    contentWidth: null,
    pagePadding: null,
    sidebarWidth: null,
  });

  // Re-sync the fields when the effective values change (preset click, clear, density change)
  useEffect(() => {
    setRaw({
      contentWidth: rawFrom("contentWidth"),
      pagePadding: rawFrom("pagePadding"),
      sidebarWidth: rawFrom("sidebarWidth"),
    });
    setErrors({ contentWidth: null, pagePadding: null, sidebarWidth: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.contentWidth, resolved.pagePadding, resolved.sidebarWidth]);

  useEffect(() => {
    onValidityChange(!errors.contentWidth && !errors.pagePadding && !errors.sidebarWidth);
  }, [errors, onValidityChange]);

  const set = <K extends keyof ThemeLayoutOverride>(key: K, value: ThemeLayoutOverride[K] | undefined) => {
    const next = { ...layout };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const handleInput = (key: NumericKey, value: string) => {
    setRaw((prev) => ({ ...prev, [key]: value }));
    const parsed = ThemeLayoutOverrideSchema.shape[key].safeParse(value.trim() === "" ? undefined : Number(value));
    if (value.trim() === "" || !parsed.success) {
      setErrors((prev) => ({
        ...prev,
        [key]: value.trim() === "" ? "Enter a value" : (parsed.error?.issues[0]?.message ?? "Invalid value"),
      }));
      return;
    }
    setErrors((prev) => ({ ...prev, [key]: null }));
    set(key, parsed.data as never);
  };

  const isFull = resolved.contentWidth === "full";

  return (
    <div>
      <h3 style={{ fontSize: "var(--font-size-md)", fontWeight: 600, margin: "0 0 0.25rem" }}>Layout</h3>
      <p style={{ ...hintStyle, margin: "0 0 1.25rem" }}>
        Applies to every standard screen and published page. The Page Builder and Grid Designer always use the full width.
      </p>

      {/* Content width */}
      <div style={{ marginBottom: "1.75rem" }}>
        <SettingHeader
          htmlFor="theme-content-width"
          label="Content Width"
          isOverridden={layout.contentWidth !== undefined}
          canEdit={canEdit}
          onClear={() => set("contentWidth", undefined)}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.5rem" }}>
          {CONTENT_WIDTH_PRESETS.map((opt) => {
            const isSelected = layout.contentWidth !== undefined && layout.contentWidth === opt.value;
            const isAuto = layout.contentWidth === undefined && resolved.contentWidth === opt.value;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!canEdit}
                onClick={() => set("contentWidth", opt.value)}
                className={`btn ${isSelected ? "btn-secondary active" : "btn-ghost"}`}
                style={cardStyle(isSelected)}
              >
                <span style={{ fontWeight: 600, fontSize: "var(--font-size-xs)" }}>{opt.label}</span>
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
                  {opt.value === "full" ? "100%" : `${opt.value}px`}
                  {isAuto ? " (Default)" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {!isFull && (
          <div style={{ marginTop: "0.75rem" }}>
            <PxField
              id="theme-content-width"
              ariaLabel="Content width"
              value={raw.contentWidth}
              min={LAYOUT_CONTENT_WIDTH_MIN}
              max={LAYOUT_CONTENT_WIDTH_MAX}
              step={10}
              canEdit={canEdit}
              error={errors.contentWidth}
              onInput={(v) => handleInput("contentWidth", v)}
            />
          </div>
        )}
        <p role={errors.contentWidth ? "alert" : undefined} style={{ ...hintStyle, color: errors.contentWidth ? "var(--danger)" : hintStyle.color }}>
          {errors.contentWidth ??
            (isFull
              ? "Content stretches to the full window width."
              : `Maximum width of the main area (${LAYOUT_CONTENT_WIDTH_MIN}–${LAYOUT_CONTENT_WIDTH_MAX}px). The width stays fixed whatever the content.`)}
        </p>
      </div>

      {/* Alignment (only meaningful when the width is limited) */}
      <div style={{ marginBottom: "1.75rem" }}>
        <SettingHeader
          label="Content Alignment"
          isOverridden={layout.contentAlign !== undefined}
          canEdit={canEdit}
          onClear={() => set("contentAlign", undefined)}
        />
        <div role="radiogroup" aria-label="Content alignment" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
          {(["center", "start"] as const).map((align) => {
            const isSelected = layout.contentAlign === align;
            const isAuto = layout.contentAlign === undefined && resolved.contentAlign === align;
            return (
              <button
                key={align}
                type="button"
                role="radio"
                aria-checked={resolved.contentAlign === align}
                disabled={!canEdit || isFull}
                onClick={() => set("contentAlign", align)}
                className={`btn ${isSelected ? "btn-secondary active" : "btn-ghost"}`}
                style={cardStyle(isSelected)}
              >
                <span style={{ fontWeight: 600, fontSize: "var(--font-size-xs)" }}>{align === "center" ? "Centered" : "Left aligned"}</span>
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
                  {align === "center" ? "Equal space on both sides" : "Starts at the left edge"}
                  {isAuto ? " (Default)" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {isFull && <p style={hintStyle}>Not used while content is full width.</p>}
      </div>

      {/* Page padding */}
      <div style={{ marginBottom: "1.75rem" }}>
        <SettingHeader
          htmlFor="theme-page-padding"
          label="Page Padding"
          isOverridden={layout.pagePadding !== undefined}
          canEdit={canEdit}
          onClear={() => set("pagePadding", undefined)}
        />
        <PxField
          id="theme-page-padding"
          ariaLabel="Page padding"
          value={raw.pagePadding}
          min={0}
          max={LAYOUT_PAGE_PADDING_MAX}
          canEdit={canEdit}
          error={errors.pagePadding}
          onInput={(v) => handleInput("pagePadding", v)}
        />
        <p role={errors.pagePadding ? "alert" : undefined} style={{ ...hintStyle, color: errors.pagePadding ? "var(--danger)" : hintStyle.color }}>
          {errors.pagePadding ??
            (layout.pagePadding === undefined
              ? `Auto: ${resolved.pagePadding}px, the default for the selected density. Space between the content and the window edges.`
              : "Space between the content and the window edges; top and bottom are slightly larger.")}
        </p>
      </div>

      {/* Sidebar width */}
      <div>
        <SettingHeader
          htmlFor="theme-sidebar-width"
          label="Sidebar Width"
          isOverridden={layout.sidebarWidth !== undefined}
          canEdit={canEdit}
          onClear={() => set("sidebarWidth", undefined)}
        />
        <PxField
          id="theme-sidebar-width"
          ariaLabel="Sidebar width"
          value={raw.sidebarWidth}
          min={LAYOUT_SIDEBAR_WIDTH_MIN}
          max={LAYOUT_SIDEBAR_WIDTH_MAX}
          step={4}
          canEdit={canEdit}
          error={errors.sidebarWidth}
          onInput={(v) => handleInput("sidebarWidth", v)}
        />
        <p role={errors.sidebarWidth ? "alert" : undefined} style={{ ...hintStyle, color: errors.sidebarWidth ? "var(--danger)" : hintStyle.color }}>
          {errors.sidebarWidth ??
            `Expanded width of the navigation sidebar on published pages (${LAYOUT_SIDEBAR_WIDTH_MIN}–${LAYOUT_SIDEBAR_WIDTH_MAX}px).`}
        </p>
      </div>
    </div>
  );
}
