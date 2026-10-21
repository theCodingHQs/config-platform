import React, { useState, useEffect, useMemo } from "react";
import {
  THEME_PRESETS,
  type ThemePresetId,
  type ThemeRadiusOverride,
  type ThemeDensityOverride,
  type WorkspaceThemeConfig,
  validateAccentContrast,
  ThemeTextSizeOverrideSchema,
  TEXT_SIZE_PRESETS,
  TEXT_SIZE_MIN,
  TEXT_SIZE_MAX,
  getDensityDefaultTextSize,
  type ThemeLayoutOverride,
} from "@config-platform/schema";
import { ThemeLayoutSettings } from "./ThemeLayoutSettings";
import {
  ThemeSettingsTabs,
  themePanelId,
  themeTabId,
  type ThemeTabId,
} from "./ThemeSettingsTabs";
import { ThemeStudioPreview, PREVIEW_HINT } from "./ThemeStudioPreview";

const EMPTY_LAYOUT: ThemeLayoutOverride = {};
import { useTheme } from "../context/theme-context";
import { useAuth } from "../context/auth-context";
import { updateWorkspaceTheme } from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import {
  Palette,
  RotateCcw,
  Save,
  Check,
  AlertTriangle,
  Lock,
  Sun,
  Moon,
  Tv,
} from "lucide-react";

const RADIUS_OPTIONS: Array<{
  id: ThemeRadiusOverride;
  label: string;
  desc: string;
}> = [
  { id: "none", label: "None", desc: "0px" },
  { id: "sm", label: "Small", desc: "4px" },
  { id: "md", label: "Medium", desc: "6px (Default)" },
  { id: "lg", label: "Large", desc: "8px" },
  { id: "xl", label: "Extra Large", desc: "12px" },
  { id: "full", label: "Full", desc: "Pill / 9999px" },
];

const DENSITY_OPTIONS: Array<{
  id: ThemeDensityOverride;
  label: string;
  factor: string;
}> = [
  { id: "dense", label: "Dense", factor: "0.6x spacing" },
  { id: "compact", label: "Compact", factor: "0.8x spacing" },
  { id: "normal", label: "Normal", factor: "1.0x spacing (Default)" },
  { id: "comfortable", label: "Comfortable", factor: "1.25x spacing" },
];

export function ThemeStudio() {
  const { user } = useAuth();
  const {
    workspaceTheme,
    setWorkspaceTheme,
    themeEditing,
    theme,
    setTheme,
    resolvedTheme,
  } = useTheme();

  // Local draft state for editing before saving
  const [selectedPreset, setSelectedPreset] = useState<ThemePresetId>(
    workspaceTheme.presetId || "neutral",
  );
  const [accentColor, setAccentColor] = useState<string>(
    workspaceTheme.overrides?.accent || "",
  );
  const [radius, setRadius] = useState<ThemeRadiusOverride | undefined>(
    workspaceTheme.overrides?.radius,
  );
  const [density, setDensity] = useState<ThemeDensityOverride | undefined>(
    workspaceTheme.overrides?.density,
  );
  const [textSize, setTextSize] = useState<number | undefined>(
    workspaceTheme.overrides?.textSize,
  );
  // Raw text of the custom size field, so intermediate keystrokes ("1" on the way to "16") are allowed
  const [textSizeInput, setTextSizeInput] = useState<string>(
    String(
      workspaceTheme.overrides?.textSize ??
        getDensityDefaultTextSize(workspaceTheme.overrides?.density),
    ),
  );

  const [layout, setLayout] = useState<ThemeLayoutOverride>(
    workspaceTheme.overrides?.layout ?? EMPTY_LAYOUT,
  );
  const [layoutValid, setLayoutValid] = useState(true);
  const [activeTab, setActiveTab] = useState<ThemeTabId>("colors");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Save feedback goes to the status bar, so nothing appears above the settings
  const notify = useStatusNotify();
  const [modalPreviewOpen, setModalPreviewOpen] = useState(false);

  // Sync draft state if workspaceTheme loads or changes from server
  useEffect(() => {
    setSelectedPreset(workspaceTheme.presetId || "neutral");
    setAccentColor(workspaceTheme.overrides?.accent || "");
    setRadius(workspaceTheme.overrides?.radius);
    setDensity(workspaceTheme.overrides?.density);
    setTextSize(workspaceTheme.overrides?.textSize);
    // Shared empty constant (not a new {}) so this sync can't loop with the live preview
    setLayout(workspaceTheme.overrides?.layout ?? EMPTY_LAYOUT);
  }, [workspaceTheme]);

  // Text size the density recommends; used whenever there is no explicit override
  const autoTextSize = getDensityDefaultTextSize(density);
  const effectiveTextSize = textSize ?? autoTextSize;

  // Keep the custom field showing the effective size when it follows density
  useEffect(() => {
    setTextSizeInput(String(textSize ?? autoTextSize));
  }, [textSize, autoTextSize]);

  const applyTextSize = (value: number | undefined) => setTextSize(value);

  // Choosing a density resets text size to that density's default; a size picked afterwards still wins
  const applyDensity = (value: ThemeDensityOverride | undefined) => {
    setDensity(value);
    setTextSize(undefined);
  };

  const textSizeError = useMemo(() => {
    if (textSizeInput.trim() === "") return "Enter a text size";
    const parsed = ThemeTextSizeOverrideSchema.safeParse(Number(textSizeInput));
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid text size");
  }, [textSizeInput]);

  const isLocked = themeEditing === "locked";
  const canEdit =
    !isLocked &&
    (user?.role === "admin" ||
      user?.role === "builder" ||
      user?.role === "owner");

  // Compute live draft config
  const draftConfig: WorkspaceThemeConfig = useMemo(() => {
    const overrides: WorkspaceThemeConfig["overrides"] = {};
    if (accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      overrides.accent = accentColor;
    }
    if (radius) overrides.radius = radius;
    if (density) overrides.density = density;
    if (textSize !== undefined) overrides.textSize = textSize;
    if (Object.keys(layout).length > 0) overrides.layout = layout;
    return {
      presetId: selectedPreset,
      overrides,
    };
  }, [selectedPreset, accentColor, radius, density, textSize, layout]);

  // Contrast validation for custom accent
  const contrastInfo = useMemo(() => {
    if (!accentColor || !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      return null;
    }
    return validateAccentContrast(accentColor);
  }, [accentColor]);

  // Apply draft config live to preview while on this page
  useEffect(() => {
    setWorkspaceTheme(draftConfig);
  }, [draftConfig, setWorkspaceTheme]);

  const handleReset = () => {
    setAccentColor("");
    setRadius(undefined);
    setDensity(undefined);
    applyTextSize(undefined);
    setLayout(EMPTY_LAYOUT);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    try {
      setSaving(true);
      setSaveSuccess(false);

      const result = await updateWorkspaceTheme(draftConfig);
      if (result.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
        notify("success", "Workspace theme saved and logged to the audit trail.");
      }
    } catch (err: any) {
      notify("error", err.message || "Failed to save workspace theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "2rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "0.25rem",
            }}
          >
            <h1
              style={{
                fontSize: "var(--font-size-2xl)",
                fontWeight: 700,
                margin: 0,
                color: "var(--text)",
              }}
            >
              Workspace Theme
            </h1>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                padding: "0.2rem 0.6rem",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-subtle)",
                color: "var(--accent)",
              }}
            >
              Preset: {THEME_PRESETS[selectedPreset]?.name}
            </span>
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              margin: 0,
              fontSize: "var(--font-size-sm)",
            }}
          >
            Choose an immutable design preset and tune workspace overrides for
            accent color, radius, density, text size, and layout.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={saving || !canEdit}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
            title="Reset overrides to preset default"
          >
            <RotateCcw size={15} />
            <span>Reset Overrides</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !canEdit || !!textSizeError || !layoutValid}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            {saving ? (
              <span>Saving...</span>
            ) : saveSuccess ? (
              <>
                <Check size={16} />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save Theme</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Lock or Permission Warning Banner */}
      {isLocked && (
        <div
          role="alert"
          style={{
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            borderRadius: "var(--radius-surface)",
            backgroundColor: "var(--warning-subtle)",
            border: "1px solid var(--warning)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            color: "var(--text)",
          }}
        >
          <Lock size={20} color="var(--warning)" />
          <div>
            <div style={{ fontWeight: 600 }}>Theme Editing Locked</div>
            <div
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--text-muted)",
              }}
            >
              Theme modifications are locked on this platform instance (
              <code style={{ fontFamily: "var(--font-mono)" }}>
                THEME_EDITING=locked
              </code>
              ). Current settings are read-only.
            </div>
          </div>
        </div>
      )}

      {!isLocked && !canEdit && (
        <div
          role="alert"
          style={{
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            borderRadius: "var(--radius-surface)",
            backgroundColor: "var(--surface-2)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            color: "var(--text)",
          }}
        >
          <AlertTriangle size={20} color="var(--text-muted)" />
          <div>
            <div style={{ fontWeight: 600 }}>Read-Only Access</div>
            <div
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--text-muted)",
              }}
            >
              Your current role ({user?.role}) has read-only permission. Only
              Builder or Admin roles can update workspace theme configurations.
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Settings tabs (left half) + Live Preview (right half) */}
      <div className="theme-studio-grid">
        {/* Left half: settings, grouped in tabs. Hidden panels stay mounted so typed values
            and their validation survive switching tabs. */}
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <ThemeSettingsTabs
            active={activeTab}
            onChange={setActiveTab}
            invalid={{ spacing: !!textSizeError, layout: !layoutValid }}
          />

          {/* Colors: preset palette + accent */}
          <div
            role="tabpanel"
            id={themePanelId("colors")}
            aria-labelledby={themeTabId("colors")}
            hidden={activeTab !== "colors"}
            className="theme-tab-panel"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.25rem",
              }}
            >
              <Palette size={18} color="var(--accent)" />
              <h2
                style={{
                  fontSize: "var(--font-size-md)",
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                Preset Palette
              </h2>
            </div>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
                marginTop: 0,
                marginBottom: "1.25rem",
              }}
            >
              Choose from 4 immutable, WCAG AA compliant design themes.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              {(Object.keys(THEME_PRESETS) as ThemePresetId[]).map(
                (presetId) => {
                  const preset = THEME_PRESETS[presetId];
                  const isSelected = selectedPreset === presetId;
                  return (
                    <button
                      key={presetId}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setSelectedPreset(presetId)}
                      style={{
                        textAlign: "left",
                        padding: "1rem",
                        borderRadius: "var(--radius-surface)",
                        border: isSelected
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border)",
                        backgroundColor: isSelected
                          ? "var(--accent-subtle)"
                          : "var(--surface-2)",
                        cursor: canEdit ? "pointer" : "default",
                        transition: "all 0.15s ease",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: "var(--font-size-md)",
                            color: "var(--text)",
                          }}
                        >
                          {preset.name}
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              fontSize: "var(--font-size-xs)",
                              fontWeight: 700,
                              padding: "0.1rem 0.4rem",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--accent)",
                              color: "var(--accent-contrast)",
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--text-muted)",
                          marginBottom: "0.75rem",
                          minHeight: "2.4em",
                        }}
                      >
                        {preset.description}
                      </div>

                      {/* Swatches preview */}
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--spacing-1)",
                          height: "18px",
                          borderRadius: "var(--radius-xs)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{ flex: 1, backgroundColor: preset.light.bg }}
                          title="Light Bg"
                        />
                        <div
                          style={{
                            flex: 1,
                            backgroundColor: preset.light.surface,
                          }}
                          title="Light Surface"
                        />
                        <div
                          style={{
                            flex: 1.5,
                            backgroundColor: preset.light.accent,
                          }}
                          title="Light Accent"
                        />
                        <div
                          style={{
                            flex: 1,
                            backgroundColor: preset.dark.surface,
                          }}
                          title="Dark Surface"
                        />
                        <div
                          style={{
                            flex: 1.5,
                            backgroundColor: preset.dark.accent,
                          }}
                          title="Dark Accent"
                        />
                      </div>
                    </button>
                  );
                },
              )}
            </div>

            <div
              style={{
                borderTop: "var(--border-width-sm) solid var(--border)",
                margin: "1.5rem 0",
              }}
            />

            {/* Accent Color Override */}
            <div style={{ marginBottom: "1.75rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Custom Accent Color
                </label>
                {accentColor && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!canEdit}
                    onClick={() => setAccentColor("")}
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.15rem 0.5rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Clear override
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <input
                  type="color"
                  disabled={!canEdit}
                  value={
                    accentColor ||
                    THEME_PRESETS[selectedPreset]?.light.accent ||
                    ""
                  }
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{
                    width: "44px",
                    height: "38px",
                    padding: "var(--spacing-1)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    cursor: canEdit ? "pointer" : "default",
                    backgroundColor: "var(--surface)",
                  }}
                />
                <input
                  type="text"
                  disabled={!canEdit}
                  placeholder={
                    THEME_PRESETS[selectedPreset]?.light.accent || ""
                  }
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="form-input"
                  style={{ width: "130px", fontFamily: "var(--font-mono)" }}
                />
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  {accentColor
                    ? "Active custom accent"
                    : "Using preset default"}
                </span>
              </div>

              {/* Contrast warning / validation badge */}
              {contrastInfo && (
                <div style={{ marginTop: "0.75rem" }}>
                  {contrastInfo.isCompliant ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        fontSize: "var(--font-size-xs)",
                        padding: "0.35rem 0.65rem",
                        borderRadius: "var(--radius-control)",
                        backgroundColor: "var(--success-subtle)",
                        color: "var(--success)",
                        border: "1px solid var(--success)",
                      }}
                    >
                      <Check size={14} />
                      <span>
                        WCAG AA Compliant ({contrastInfo.contrastRatio}:1 ratio)
                      </span>
                    </div>
                  ) : (
                    <div
                      role="alert"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        fontSize: "var(--font-size-xs)",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "var(--radius-surface)",
                        backgroundColor: "var(--warning-subtle)",
                        color: "var(--warning)",
                        border: "1px solid var(--warning)",
                        lineHeight: 1.4,
                      }}
                    >
                      <AlertTriangle
                        size={16}
                        style={{ flexShrink: 0, marginTop: "var(--spacing-1)" }}
                      />
                      <div>
                        <strong>Low Contrast Warning:</strong>{" "}
                        {contrastInfo.warning}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* Shape: corner radius */}
          <div
            role="tabpanel"
            id={themePanelId("shape")}
            aria-labelledby={themeTabId("shape")}
            hidden={activeTab !== "shape"}
            className="theme-tab-panel"
          >
            {/* Corner Radius Override */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Corner Radius
                </label>
                {radius && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!canEdit}
                    onClick={() => setRadius(undefined)}
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.15rem 0.5rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Clear override
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "0.5rem",
                }}
              >
                {RADIUS_OPTIONS.map((opt) => {
                  const isSelected = radius === opt.id;
                  const isPresetDefault = opt.id === "md";
                  const showDefaultMarker =
                    radius === undefined && isPresetDefault;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setRadius(opt.id)}
                      className={`btn ${isSelected ? "btn-secondary active" : "btn-ghost"}`}
                      style={{
                        padding: "var(--spacing-2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--radius-control)",
                        border: isSelected
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border)",
                        backgroundColor: isSelected
                          ? "var(--accent-subtle)"
                          : "var(--surface)",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--font-size-xs)",
                        }}
                      >
                        {opt.label}
                      </span>
                      {showDefaultMarker ? (
                        <span
                          style={{
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                            marginTop: "var(--spacing-1)",
                            padding: "0 0.35rem",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--surface-2)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Current default
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {opt.desc}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Spacing & Text: density + text size */}
          <div
            role="tabpanel"
            id={themePanelId("spacing")}
            aria-labelledby={themeTabId("spacing")}
            hidden={activeTab !== "spacing"}
            className="theme-tab-panel"
          >
            {/* Density Override */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Density Multiplier
                </label>
                {density && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!canEdit}
                    onClick={() => applyDensity(undefined)}
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.15rem 0.5rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Clear override
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "0.5rem",
                }}
              >
                {DENSITY_OPTIONS.map((opt) => {
                  const isSelected = density === opt.id;
                  const isPresetDefault = opt.id === "normal";
                  const showDefaultMarker =
                    density === undefined && isPresetDefault;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => applyDensity(opt.id)}
                      className={`btn ${isSelected ? "btn-secondary active" : "btn-ghost"}`}
                      style={{
                        padding: "var(--spacing-2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--radius-control)",
                        border: isSelected
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border)",
                        backgroundColor: isSelected
                          ? "var(--accent-subtle)"
                          : "var(--surface)",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--font-size-xs)",
                        }}
                      >
                        {opt.label}
                      </span>
                      {showDefaultMarker ? (
                        <span
                          style={{
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                            marginTop: "var(--spacing-1)",
                            padding: "0 0.35rem",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--surface-2)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Current default
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {opt.factor} · {getDensityDefaultTextSize(opt.id)}px text
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Text Size Override */}
            <div style={{ marginTop: "1.75rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  htmlFor="theme-text-size"
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Text Size
                </label>
                {textSize !== undefined && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!canEdit}
                    onClick={() => applyTextSize(undefined)}
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.15rem 0.5rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Clear override
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "0.5rem",
                }}
              >
                {TEXT_SIZE_PRESETS.map((opt) => {
                  const isSelected = textSize !== undefined && textSize === opt.value;
                  const showDefaultMarker =
                    textSize === undefined && opt.value === autoTextSize;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => applyTextSize(opt.value)}
                      className={`btn ${isSelected ? "btn-secondary active" : "btn-ghost"}`}
                      style={{
                        padding: "var(--spacing-2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--radius-control)",
                        border: isSelected
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border)",
                        backgroundColor: isSelected
                          ? "var(--accent-subtle)"
                          : "var(--surface)",
                      }}
                    >
                      {/* Fixed px so each card previews its own size, independent of the live theme */}
                      <span style={{ fontWeight: 600, fontSize: `${opt.value}px`, lineHeight: 1.2 }}>
                        Aa
                      </span>
                      <span
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--text-muted)",
                          marginTop: "var(--spacing-1)",
                        }}
                      >
                        {opt.label} · {opt.value}px
                        {showDefaultMarker ? " (Auto)" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Custom size: any value in range, in 0.5px steps */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  marginTop: "0.75rem",
                }}
              >
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  Custom
                </span>
                <input
                  type="range"
                  aria-label="Text size slider"
                  min={TEXT_SIZE_MIN}
                  max={TEXT_SIZE_MAX}
                  step={0.5}
                  disabled={!canEdit}
                  value={effectiveTextSize}
                  onChange={(e) => applyTextSize(Number(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--accent)" }}
                />
                <input
                  id="theme-text-size"
                  type="number"
                  className={`form-input${textSizeError ? " is-invalid" : ""}`}
                  min={TEXT_SIZE_MIN}
                  max={TEXT_SIZE_MAX}
                  step={0.5}
                  disabled={!canEdit}
                  value={textSizeInput}
                  onChange={(e) => {
                    setTextSizeInput(e.target.value);
                    const parsed = ThemeTextSizeOverrideSchema.safeParse(Number(e.target.value));
                    if (e.target.value.trim() !== "" && parsed.success) setTextSize(parsed.data);
                  }}
                  style={{ width: "80px" }}
                />
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>px</span>
              </div>

              <p
                role={textSizeError ? "alert" : undefined}
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "var(--font-size-xs)",
                  color: textSizeError ? "var(--danger)" : "var(--text-muted)",
                }}
              >
                {textSizeError ??
                  `${textSize === undefined ? `Auto: ${autoTextSize}px, the default for the selected density.` : `Custom ${textSize}px; clear the override to follow density again.`} Range ${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX}px. Headings, captions and buttons scale with it; controls grow taller if the text needs room.`}
              </p>
            </div>
          </div>

          {/* Layout */}
          <div
            role="tabpanel"
            id={themePanelId("layout")}
            aria-labelledby={themeTabId("layout")}
            hidden={activeTab !== "layout"}
            className="theme-tab-panel"
          >
            <ThemeLayoutSettings
              layout={layout}
              density={density}
              canEdit={canEdit}
              onChange={setLayout}
              onValidityChange={setLayoutValid}
            />
          </div>
        </section>

        {/* Right Column: Live Interactive Preview */}
        <div>
          <section
            className="card"
            style={{
              padding: "1.5rem",
              // Stays in view while the settings scroll; the studio's <main> is the scroller,
              // so the offset is from its top. Capped so the preview's own bottom stays reachable.
              position: "sticky",
              top: "var(--spacing-4)",
              maxHeight: "calc(100vh - var(--navbar-height) - 2 * var(--spacing-4))",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "var(--spacing-2)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <h2
                  style={{
                    fontSize: "var(--font-size-lg)",
                    fontWeight: 600,
                    margin: 0,
                  }}
                >
                  Live Preview
                </h2>
              </div>

              {/* Mode preview switcher */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  Mode:
                </span>
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`btn ${resolvedTheme === "light" ? "btn-secondary active" : "btn-ghost"}`}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "var(--font-size-xs)",
                  }}
                  title="Preview in Light Mode"
                >
                  <Sun size={13} style={{ marginRight: "var(--spacing-1)" }} />{" "}
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`btn ${resolvedTheme === "dark" ? "btn-secondary active" : "btn-ghost"}`}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "var(--font-size-xs)",
                  }}
                  title="Preview in Dark Mode"
                >
                  <Moon size={13} style={{ marginRight: "var(--spacing-1)" }} />{" "}
                  Dark
                </button>
              </div>
            </div>

            <p
              style={{
                margin: "0 0 var(--spacing-4)",
                fontSize: "var(--font-size-xs)",
                color: "var(--text-muted)",
              }}
            >
              {PREVIEW_HINT[activeTab]}
            </p>
            {/* Only the components affected by the selected settings tab */}
            <ThemeStudioPreview
              tab={activeTab}
              layout={layout}
              density={density}
              onOpenModal={() => setModalPreviewOpen(true)}
            />
          </section>
        </div>
      </div>

      {/* Full Screen Modal Overlay Preview */}
      {modalPreviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="modal-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "var(--overlay-bg)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-5)",
          }}
          onClick={() => setModalPreviewOpen(false)}
        >
          <div
            data-testid="modal-container"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              borderRadius: "var(--radius-surface)",
              boxShadow: "var(--shadow-xl)",
              width: "100%",
              maxWidth: 480,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: "var(--border-width-sm) solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "var(--space-4) var(--space-5)",
                borderBottom: "var(--border-width-sm) solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "var(--font-size-md)", fontWeight: 600 }}>
                Theme Modal Preview
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalPreviewOpen(false)}
                style={{ borderRadius: "var(--radius-control)", padding: "0.25rem" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
                This modal container uses <code>var(--radius-surface)</code>, capped at 16px so Full does not turn it into a pill!
              </p>
              <div>
                <label className="form-label">Input Control (capped at 8px)</label>
                <input type="text" className="form-input" defaultValue="Sample modal input" />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setModalPreviewOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setModalPreviewOpen(false)}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default ThemeStudio;
