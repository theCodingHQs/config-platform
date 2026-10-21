import React from "react";
import { DEFAULT_CONTENT_GAP, type ContentLayoutProps } from "@config-platform/schema";

/** Titled group for the content layout controls inside a component's property panel. */
export function ContentLayoutSection({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-xs)",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Content Layout
      </div>
      {children}
    </div>
  );
}

/**
 * Builder controls for how a container lays out its children (direction, gap, alignment,
 * wrapping). Shared by stack, card and modal so they all behave and read the same.
 */
export function ContentLayoutFields({
  idPrefix,
  value,
  onChange,
}: {
  /** Prefix for input ids, e.g. "prop-card" → "prop-card-gap". */
  idPrefix: string;
  value: ContentLayoutProps;
  onChange: (patch: Partial<ContentLayoutProps>) => void;
}) {
  const direction = value.direction ?? "vertical";
  return (
    <>
      <div>
        <label className="form-label" htmlFor={`${idPrefix}-direction`}>
          Direction
        </label>
        <select
          id={`${idPrefix}-direction`}
          className="form-select"
          value={direction}
          onChange={(e) => onChange({ direction: e.target.value as ContentLayoutProps["direction"] })}
        >
          <option value="vertical">Vertical (Column)</option>
          <option value="horizontal">Horizontal (Row)</option>
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <div>
          <label className="form-label" htmlFor={`${idPrefix}-gap`}>
            Gap (px)
          </label>
          <input
            id={`${idPrefix}-gap`}
            type="number"
            min={0}
            className="form-input"
            value={value.gap ?? DEFAULT_CONTENT_GAP}
            onChange={(e) => onChange({ gap: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        <div>
          <label className="form-label" htmlFor={`${idPrefix}-justify`}>
            Justify
          </label>
          <select
            id={`${idPrefix}-justify`}
            className="form-select"
            value={value.justify || ""}
            onChange={(e) => onChange({ justify: e.target.value || undefined })}
          >
            <option value="">Default (Start)</option>
            <option value="flex-start">Start</option>
            <option value="center">Center</option>
            <option value="flex-end">End</option>
            <option value="space-between">Space Between</option>
            <option value="space-around">Space Around</option>
            <option value="space-evenly">Space Evenly</option>
          </select>
        </div>
      </div>
      <div>
        <label className="form-label" htmlFor={`${idPrefix}-align`}>
          Align Items
        </label>
        <select
          id={`${idPrefix}-align`}
          className="form-select"
          value={value.align || ""}
          onChange={(e) => onChange({ align: e.target.value || undefined })}
        >
          <option value="">Default (Stretch)</option>
          <option value="stretch">Stretch</option>
          <option value="flex-start">Start</option>
          <option value="center">Center</option>
          <option value="flex-end">End</option>
          <option value="baseline">Baseline</option>
        </select>
      </div>
      {direction === "horizontal" && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
          }}
        >
          <input
            id={`${idPrefix}-wrap`}
            type="checkbox"
            checked={value.wrap ?? false}
            onChange={(e) => onChange({ wrap: e.target.checked })}
          />
          <span>Wrap items onto new lines</span>
        </label>
      )}
    </>
  );
}
