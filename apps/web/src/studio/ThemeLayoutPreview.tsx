import React, { useState } from "react";
import {
  resolveLayout,
  type ThemeDensityOverride,
  type ThemeLayoutOverride,
} from "@config-platform/schema";

const SCREEN_WIDTHS = [1366, 1920, 2560] as const;
const NAVBAR_HEIGHT = 60;

/**
 * Scaled diagram of a published page under the current Layout settings: header, navigation
 * sidebar, and the content area with its max width, alignment and padding. Drawn in real
 * pixels in an SVG viewBox, so proportions are exact at any preview size.
 */
export function ThemeLayoutPreview({
  layout,
  density,
}: {
  layout: ThemeLayoutOverride;
  density: ThemeDensityOverride | undefined;
}) {
  const [screenWidth, setScreenWidth] = useState<number>(1920);
  const resolved = resolveLayout(layout, density);

  const height = Math.round((screenWidth * 9) / 16);
  const sidebar = resolved.sidebarWidth;
  const available = screenWidth - sidebar;
  const maxWidth = resolved.contentWidth === "full" ? available : Math.min(resolved.contentWidth, available);
  const contentX = sidebar + (resolved.contentAlign === "center" ? (available - maxWidth) / 2 : 0);
  const pad = resolved.pagePadding;
  const padY = pad * 1.25;
  const innerX = contentX + pad;
  const innerW = Math.max(0, maxWidth - 2 * pad);
  const top = NAVBAR_HEIGHT + padY;

  // Placeholder content: a title, a row of 4 stat tiles and a large card
  const gap = 24;
  const tileW = Math.max(0, (innerW - 3 * gap) / 4);

  const box = (fill: string, stroke?: string): React.CSSProperties => ({
    fill: `var(${fill})`,
    stroke: stroke ? `var(${stroke})` : "none",
  });

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Screen width"
        style={{ display: "flex", gap: "var(--spacing-1)", marginBottom: "var(--spacing-3)" }}
      >
        {SCREEN_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === screenWidth}
            onClick={() => setScreenWidth(w)}
            className={`btn btn-sm ${w === screenWidth ? "btn-secondary active" : "btn-ghost"}`}
          >
            {w}px screen
          </button>
        ))}
      </div>

      <svg
        data-testid="layout-preview"
        viewBox={`0 0 ${screenWidth} ${height}`}
        role="img"
        aria-label={`Published page on a ${screenWidth}px screen: ${sidebar}px sidebar, content ${resolved.contentWidth === "full" ? "full width" : `up to ${resolved.contentWidth}px`} ${resolved.contentAlign === "center" ? "centered" : "left aligned"}, ${pad}px padding`}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          border: "var(--border-width-sm) solid var(--border)",
          borderRadius: "var(--radius-surface)",
          backgroundColor: "var(--bg)",
        }}
      >
        {/* Header */}
        <rect x={0} y={0} width={screenWidth} height={NAVBAR_HEIGHT} style={box("--surface", "--border")} strokeWidth={2} />
        {/* Sidebar */}
        <rect x={0} y={NAVBAR_HEIGHT} width={sidebar} height={height - NAVBAR_HEIGHT} style={box("--surface", "--border")} strokeWidth={2} />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={24} y={NAVBAR_HEIGHT + 32 + i * 52} width={sidebar - 48} height={28} rx={6} style={box("--surface-2")} />
        ))}

        {/* Content area (max width) and its padding */}
        <rect
          x={contentX}
          y={NAVBAR_HEIGHT}
          width={maxWidth}
          height={height - NAVBAR_HEIGHT}
          style={{ ...box("--accent-subtle"), opacity: 0.55 }}
        />
        <rect
          x={innerX}
          y={top}
          width={innerW}
          height={Math.max(0, height - top - padY)}
          style={{ fill: "none", stroke: "var(--accent)" }}
          strokeWidth={3}
          strokeDasharray="14 10"
        />

        {/* Placeholder page content */}
        <rect x={innerX} y={top + 8} width={Math.min(420, innerW)} height={36} rx={6} style={box("--text-muted")} opacity={0.35} />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={innerX + i * (tileW + gap)} y={top + 76} width={tileW} height={110} rx={12} style={box("--surface", "--border")} strokeWidth={2} />
        ))}
        <rect
          x={innerX}
          y={top + 76 + 110 + gap}
          width={innerW}
          height={Math.max(0, height - (top + 76 + 110 + gap) - padY - 8)}
          rx={12}
          style={box("--surface", "--border")}
          strokeWidth={2}
        />
      </svg>

      <dl className="layout-preview-legend">
        <div>
          <dt>Content width</dt>
          <dd>
            {resolved.contentWidth === "full" ? "Full" : `${resolved.contentWidth}px`}
            {resolved.contentWidth !== "full" && resolved.contentWidth > available && " (fills this screen)"}
          </dd>
        </div>
        <div>
          <dt>Alignment</dt>
          <dd>{resolved.contentAlign === "center" ? "Centered" : "Left"}</dd>
        </div>
        <div>
          <dt>Page padding</dt>
          <dd>{pad}px</dd>
        </div>
        <div>
          <dt>Sidebar</dt>
          <dd>{sidebar}px</dd>
        </div>
      </dl>
      <p style={{ margin: "var(--spacing-2) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        Shaded: content area. Dashed: content after padding. Studio screens use the same width without the sidebar.
      </p>
    </div>
  );
}
