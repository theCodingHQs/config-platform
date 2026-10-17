import React, { useState, useEffect, useMemo } from "react";
import {
  THEME_PRESETS,
  type ThemePresetId,
  type ThemeRadiusOverride,
  type ThemeDensityOverride,
  type WorkspaceThemeConfig,
  validateAccentContrast,
} from "@config-platform/schema";
import { useTheme } from "../context/theme-context";
import { useAuth } from "../context/auth-context";
import { updateWorkspaceTheme } from "../api/client";
import {
  Palette,
  RotateCcw,
  Save,
  Check,
  AlertTriangle,
  Lock,
  Sun,
  Moon,
  TrendingUp,
  Layers,
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

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modalPreviewOpen, setModalPreviewOpen] = useState(false);

  // Sync draft state if workspaceTheme loads or changes from server
  useEffect(() => {
    setSelectedPreset(workspaceTheme.presetId || "neutral");
    setAccentColor(workspaceTheme.overrides?.accent || "");
    setRadius(workspaceTheme.overrides?.radius);
    setDensity(workspaceTheme.overrides?.density);
  }, [workspaceTheme]);

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
    return {
      presetId: selectedPreset,
      overrides,
    };
  }, [selectedPreset, accentColor, radius, density]);

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
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(false);

      const result = await updateWorkspaceTheme(draftConfig);
      if (result.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch (err: any) {
      setSaveError(err.message || "Failed to save workspace theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem 1.5rem" }}
    >
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
            accent color, radius, and density.
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
            disabled={saving || !canEdit}
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

      {/* Save Success / Error feedback */}
      {saveSuccess && (
        <div
          role="status"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            borderRadius: "var(--radius-surface)",
            backgroundColor: "var(--success-subtle)",
            border: "1px solid var(--success)",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "var(--font-size-sm)",
          }}
        >
          <Check size={16} color="var(--success)" />
          <span>
            Workspace theme successfully saved and logged to audit trail.
          </span>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            borderRadius: "var(--radius-surface)",
            backgroundColor: "var(--danger-subtle)",
            border: "1px solid var(--danger)",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "var(--font-size-sm)",
          }}
        >
          <AlertTriangle size={16} color="var(--danger)" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Main Grid: Controls (Left) + Live Preview (Right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(350px, 1fr) minmax(380px, 1.2fr)",
          gap: "2rem",
          alignItems: "start",
        }}
      >
        {/* Left Column: Preset Gallery & Overrides */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {/* Preset Gallery */}
          <section className="card" style={{ padding: "1.5rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "1rem",
              }}
            >
              <Palette size={18} color="var(--accent)" />
              <h2
                style={{
                  fontSize: "var(--font-size-lg)",
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                1. Select Preset Palette
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
          </section>

          {/* Overrides: Accent, Radius, Density */}
          <section className="card" style={{ padding: "1.5rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "1.25rem",
              }}
            >
              <Layers size={18} color="var(--accent)" />
              <h2
                style={{
                  fontSize: "var(--font-size-lg)",
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                2. Workspace Overrides
              </h2>
            </div>

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

            {/* Corner Radius Override */}
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
                  gridTemplateColumns: "repeat(3, 1fr)",
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
                    onClick={() => setDensity(undefined)}
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
                  gridTemplateColumns: "repeat(3, 1fr)",
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
                      onClick={() => setDensity(opt.id)}
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
                          {opt.factor}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Live Interactive Preview */}
        <div>
          <section
            className="card"
            style={{
              padding: "1.5rem",
              position: "sticky",
              top: "calc(var(--navbar-height) + 1.5rem)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1.25rem",
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

            {/* Preview Components */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              {/* Modal Container Preview */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Modal Container (capped at 16px)</label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setModalPreviewOpen(true)}
                    style={{ fontSize: 'var(--font-size-xs)', padding: '0.2rem 0.5rem' }}
                  >
                    Open Overlay
                  </button>
                </div>
                <div
                  data-testid="preview-modal-box"
                  style={{
                    backgroundColor: "var(--surface)",
                    borderRadius: "var(--radius-surface)",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow-md)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: "var(--surface-2)",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>
                      Modal Header
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "0.2rem 0.4rem", fontSize: "var(--font-size-xs)" }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ padding: "0.75rem 1rem", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
                    Modal surface role caps radius so Full does not pill the window.
                  </div>
                </div>
              </div>

              {/* Stat Card Preview */}
              <div>
                <label className="form-label">Card Surface (capped at 16px)</label>
                <div
                  data-testid="preview-card-box"
                  style={{
                    padding: "1.25rem",
                    borderRadius: "var(--radius-surface)",
                    backgroundColor: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    MONTHLY ACTIVE USERS
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.75rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "var(--font-size-2xl)",
                        fontWeight: 700,
                        color: "var(--text)",
                      }}
                    >
                      24,580
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.2rem",
                        fontSize: "var(--font-size-xs)",
                        color: "var(--success)",
                        fontWeight: 600,
                      }}
                    >
                      <TrendingUp size={14} /> +12.4%
                    </span>
                  </div>
                </div>
              </div>

              {/* Form Input Preview */}
              <div>
                <label className="form-label" htmlFor="preview-input">
                  Input Control (capped at 8px)
                </label>
                <input
                  id="preview-input"
                  type="text"
                  className="form-input"
                  defaultValue="Editable theme input"
                  placeholder="Focus to see accent focus ring"
                />
              </div>

              {/* Button Groups Preview */}
              <div>
                <label className="form-label">Button Hierarchy (pills on Full)</label>
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
                >
                  <button type="button" className="btn btn-primary">
                    Primary Accent
                  </button>
                  <button type="button" className="btn btn-secondary">
                    Secondary
                  </button>
                  <button type="button" className="btn btn-danger">
                    Danger
                  </button>
                  <button type="button" className="btn btn-ghost">
                    Ghost
                  </button>
                </div>
              </div>

              {/* Badges Preview */}
              <div>
                <label className="form-label">Semantic Badges (pills)</label>
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
                >
                  <span className="badge badge-accent">Accent Badge</span>
                  <span className="badge badge-success">Success Badge</span>
                  <span className="badge badge-warning">Warning Badge</span>
                  <span className="badge badge-danger">Danger Badge</span>
                </div>
              </div>

              {/* Mini Table Preview */}
              <div>
                <label className="form-label">Table Surface (capped at 16px)</label>
                <div
                  data-testid="preview-table-box"
                  style={{
                    overflow: "hidden",
                    borderRadius: "var(--radius-surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <table
                    className="table"
                    style={{ width: "100%", borderCollapse: "collapse" }}
                  >
                    <thead>
                      <tr
                        style={{
                          backgroundColor: "var(--surface-2)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <th
                          style={{
                            padding: "0.625rem 0.75rem",
                            textAlign: "left",
                            fontSize: "var(--font-size-xs)",
                            fontWeight: 600,
                          }}
                        >
                          Entity
                        </th>
                        <th
                          style={{
                            padding: "0.625rem 0.75rem",
                            textAlign: "left",
                            fontSize: "var(--font-size-xs)",
                            fontWeight: 600,
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        <td
                          style={{
                            padding: "0.625rem 0.75rem",
                            fontSize: "var(--font-size-sm)",
                          }}
                        >
                          Orders
                        </td>
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          <span className="badge badge-success">Active</span>
                        </td>
                      </tr>
                      <tr>
                        <td
                          style={{
                            padding: "0.625rem 0.75rem",
                            fontSize: "var(--font-size-sm)",
                          }}
                        >
                          Customers
                        </td>
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          <span className="badge badge-accent">Syncing</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
