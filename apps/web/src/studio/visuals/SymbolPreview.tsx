/** A read-only page for a symbol that isn't the workspace's own (built-in or shared): what it is, a preview, its inputs, and "Make my own copy" */
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CopyPlus } from "lucide-react";
import type { Visual } from "@config-platform/schema";
import { SymbolThumb } from "./SymbolsPalette";
import { useCopySymbol } from "./use-copy-symbol";

export const muted = { color: "var(--text-muted)", fontSize: "var(--font-size-sm)" } as const;
const cell = { padding: "var(--space-1) var(--space-2)", borderBottom: "var(--border-width-sm) solid var(--border)", textAlign: "left" } as const;
const TYPE_LABELS = { number: "Number", text: "Text", boolean: "On/off", color: "Colour" } as const;

const shownDefault = (v: string | number | boolean | undefined) => (v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "On" : "Off") : String(v));

/** `about`: a line on where it comes from; `actions`: buttons beside "Make my own copy"; `badges`: shown under the name */
export function SymbolPreview({ visual, about, badges, actions }: { visual: Visual; about: React.ReactNode; badges?: React.ReactNode; actions?: React.ReactNode }) {
  const navigate = useNavigate();
  const copy = useCopySymbol((saved) => navigate(`/studio/visuals/${saved.id}`));
  const inputs = visual.definition.inputs ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: "56rem" }}>
      <Link to="/studio/visuals" style={{ ...muted, display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
        <ArrowLeft size="1em" /> Visuals
      </Link>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "16rem", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700 }}>{visual.name}</h1>
          {badges && <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>{badges}</div>}
          <p style={{ ...muted, margin: 0 }}>{about}</p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {actions}
          <button type="button" className="btn btn-primary" disabled={copy.isPending} onClick={() => copy.mutate(visual.id)}>
            <CopyPlus size="1em" /> {copy.isPending ? "Copying…" : "Make my own copy"}
          </button>
        </div>
      </div>
      {copy.error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(copy.error as Error).message}</p>}
      <div className="card" style={{ padding: "var(--space-4)", display: "grid", placeItems: "center" }}>
        <div style={{ width: "100%", maxWidth: `${Math.min(visual.definition.width * 2, 560)}px` }}>
          <SymbolThumb id={visual.id} height="16rem" />
        </div>
      </div>
      <section>
        <h2 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--font-size-lg)", fontWeight: 600 }}>Inputs</h2>
        {inputs.length ? (
          <>
            <p style={{ ...muted, margin: "0 0 var(--space-2)" }}>Each placed copy gives these a value, or binds them to live data.</p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-size-sm)" }}>
              <thead>
                <tr>
                  <th style={cell}>Input</th>
                  <th style={cell}>What it is</th>
                  <th style={cell}>Type</th>
                  <th style={cell}>Default</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((i) => (
                  <tr key={i.name}>
                    <td style={{ ...cell, fontFamily: "var(--font-mono, monospace)" }}>inputs.{i.name}</td>
                    <td style={cell}>{i.label ?? i.name}</td>
                    <td style={cell}>{TYPE_LABELS[i.type]}</td>
                    <td style={cell}>{shownDefault(i.default)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ ...muted, margin: 0 }}>It has no inputs: every copy looks the same.</p>
        )}
      </section>
    </div>
  );
}
