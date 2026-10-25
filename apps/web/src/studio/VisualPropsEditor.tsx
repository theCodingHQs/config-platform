/** Page builder properties for the Visual component: which visual, its height and title */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { VisualProps } from "@config-platform/schema";
import { VISUALS_KEY, visualsApi } from "../visuals/visuals-api";

export function VisualPropsEditor({ props, onChange }: { props: VisualProps; onChange: (next: VisualProps) => void }) {
  const { data: visuals = [], isLoading } = useQuery({ queryKey: VISUALS_KEY, queryFn: visualsApi.list });
  const missing = props.visualId && !isLoading && !visuals.some((v) => v.id === props.visualId);
  return (
    <>
      <div>
        <label className="form-label" htmlFor="prop-visual-id">
          Visual
        </label>
        <select id="prop-visual-id" className="form-select" value={props.visualId ?? ""} onChange={(e) => onChange({ ...props, visualId: e.target.value || undefined })}>
          <option value="">Choose a visual</option>
          {missing && <option value={props.visualId}>Missing visual ({props.visualId})</option>}
          {visuals.filter((v) => v.kind !== "symbol").map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <div style={{ marginTop: "var(--space-1)", fontSize: "var(--font-size-xs)", display: "flex", gap: "var(--space-3)" }}>
          {props.visualId && !missing && (
            <Link to={`/studio/visuals/${props.visualId}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
              Edit this visual <ExternalLink size="1em" />
            </Link>
          )}
          <Link to="/studio/visuals" target="_blank" rel="noreferrer">
            All visuals
          </Link>
        </div>
      </div>
      <div>
        <label className="form-label" htmlFor="prop-visual-title">
          Title
        </label>
        <input id="prop-visual-title" className="form-input" value={props.title ?? ""} placeholder="None" onChange={(e) => onChange({ ...props, title: e.target.value || undefined })} />
      </div>
      <div>
        <label className="form-label" htmlFor="prop-visual-height">
          Height (px)
        </label>
        <input
          id="prop-visual-height"
          className="form-input"
          type="number"
          min={80}
          max={3000}
          value={props.height ?? ""}
          placeholder="Automatic (keeps the drawing's shape)"
          onChange={(e) => {
            const n = e.target.value === "" ? undefined : Math.round(Number(e.target.value));
            onChange({ ...props, height: n === undefined || Number.isNaN(n) ? undefined : Math.min(3000, Math.max(80, n)) });
          }}
        />
      </div>
    </>
  );
}
