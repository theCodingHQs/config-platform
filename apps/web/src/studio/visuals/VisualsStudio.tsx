/** Studio → Visuals: the workspace's animated drawings, and the editor for one of them */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Component, Factory, Plus, Trash2 } from "lucide-react";
import { emptyVisualDefinition, type VisualKind, type VisualSummary } from "@config-platform/schema";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { VISUAL_TEMPLATES } from "../../visuals/templates";
import { Field } from "../live/Field";
import { VisualEditor } from "./VisualEditor";

/** A symbol starts as a small flat canvas; draw one station, lamp or cart on it */
const blankSymbol = () => ({ ...emptyVisualDefinition("flat"), width: 200, height: 200, inputs: [] });

function NewVisualForm({ kind, onCancel }: { kind: VisualKind; onCancel: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(VISUAL_TEMPLATES[0].id);
  const create = useMutation({
    mutationFn: async () => {
      if (kind === "symbol") return visualsApi.create({ name: name.trim(), kind, definition: blankSymbol() });
      const chosen = VISUAL_TEMPLATES.find((t) => t.id === template)!;
      // The template's own symbols first, named after the new drawing, so it can place them
      const ids: Record<string, string> = {};
      for (const s of chosen.symbols ?? []) ids[s.key] = (await visualsApi.create({ name: `${name.trim()}: ${s.name}`, kind: "symbol", definition: s.build() })).id;
      return visualsApi.create({ name: name.trim(), kind, definition: chosen.build(ids) });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(visualKey(saved.id), saved);
      queryClient.invalidateQueries({ queryKey: VISUALS_KEY, exact: true });
      navigate(`/studio/visuals/${saved.id}`);
    },
  });
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)", maxWidth: "32rem" }}
    >
      <Field label="Name" htmlFor="new-visual-name">
        <input id="new-visual-name" className="form-input" autoFocus value={name} placeholder={kind === "symbol" ? "e.g. Furnace station" : "e.g. Line 1 overview"} onChange={(e) => setName(e.target.value)} />
      </Field>
      {kind === "symbol" ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
          Draw it once, give it inputs (like its name or status), then place it in drawings as many times as you need, each copy connected to its own tags.
        </p>
      ) : (
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <legend className="form-label" style={{ fontSize: "var(--font-size-xs)", marginBottom: "var(--space-1)" }}>
          Start from
        </legend>
        {VISUAL_TEMPLATES.map((t) => (
          <label key={t.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start", fontSize: "var(--font-size-sm)" }}>
            <input type="radio" name="visual-template" checked={template === t.id} onChange={() => setTemplate(t.id)} />
            <span>
              <strong>{t.label}</strong> <span style={{ color: "var(--text-muted)" }}>– {t.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      )}
      {create.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(create.error as Error).message}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function VisualCard({ v, onDelete }: { v: VisualSummary; onDelete: (v: VisualSummary) => void }) {
  return (
    <li className="card" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-3)" }}>
      <Link to={`/studio/visuals/${v.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
          {v.elementCount} {v.elementCount === 1 ? "shape" : "shapes"} · saved {new Date(v.updatedAt).toLocaleDateString()}
        </div>
      </Link>
      <button type="button" className="btn btn-ghost" aria-label={`Delete ${v.name}`} title="Delete" style={{ padding: "var(--space-1)", color: "var(--danger)" }} onClick={() => onDelete(v)}>
        <Trash2 size="1em" />
      </button>
    </li>
  );
}

const grid = { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "var(--space-3)" } as const;
const sectionTitle = { margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)" } as const;

function VisualsList() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<VisualKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { data: visuals = [], isLoading } = useQuery({ queryKey: VISUALS_KEY, queryFn: visualsApi.list });
  const remove = useMutation({
    mutationFn: visualsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VISUALS_KEY, exact: true }),
    onError: (err: Error) => setProblem(err.message),
  });
  const onDelete = (v: VisualSummary) => {
    setProblem(null);
    if (window.confirm(`Delete "${v.name}"? This can't be undone.`)) remove.mutate(v.id);
  };
  const drawings = visuals.filter((v) => v.kind !== "symbol");
  const symbols = visuals.filter((v) => v.kind === "symbol");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: "72rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "16rem" }}>
          <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Factory size="1em" style={{ color: "var(--accent)" }} /> Visuals
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
            Draw your line or plant, flat or in 2.5D, and let live data drive any part of it. Show a drawing on a page with the Visual component.
          </p>
        </div>
        {!creating && (
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating("symbol")}>
              <Component size="1em" /> New symbol
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating("drawing")}>
              <Plus size="1em" /> New visual
            </button>
          </div>
        )}
      </div>
      {creating && <NewVisualForm kind={creating} onCancel={() => setCreating(null)} />}
      {problem && (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {problem}
        </p>
      )}
      {isLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <>
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <h2 style={sectionTitle}>Drawings</h2>
            {drawings.length ? (
              <ul style={grid}>{drawings.map((v) => <VisualCard key={v.id} v={v} onDelete={onDelete} />)}</ul>
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No drawings yet. Start one from the Assembly line example to see how live data drives it.</p>
            )}
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <h2 style={sectionTitle}>Symbols</h2>
            {symbols.length ? (
              <ul style={grid}>{symbols.map((v) => <VisualCard key={v.id} v={v} onDelete={onDelete} />)}</ul>
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                A symbol is a drawing you reuse: draw a station once, then place it many times, each copy with its own name and tags.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function VisualLoader({ id }: { id: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: visualKey(id), queryFn: () => visualsApi.get(id) });
  if (isLoading) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  if (error || !data) return <p style={{ color: "var(--danger)" }}>{(error as Error)?.message ?? "Visual not found"}</p>;
  // Keyed by id so opening another visual starts a fresh editor (and undo history)
  return <VisualEditor key={data.id} visual={data} />;
}

export function VisualsStudio() {
  const { id } = useParams();
  return id ? <VisualLoader id={id} /> : <VisualsList />;
}
