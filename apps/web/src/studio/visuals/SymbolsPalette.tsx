/** The workspace's symbols, to place in the drawing: click one to drop it in the middle, or drag it on */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { VisualScene } from "../../visuals/VisualScene";
import { useSymbols } from "../../visuals/use-symbols";

export const SYMBOL_DRAG_TYPE = "application/x-visual-symbol";

function SymbolThumb({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: visualKey(id), queryFn: () => visualsApi.get(id), staleTime: 30_000 });
  const symbols = useSymbols(data?.definition);
  if (!data) return <div style={{ height: "3.25rem" }} />;
  return <VisualScene definition={{ ...data.definition, background: "transparent" }} symbols={symbols} scope={null} className="vis-paused" style={{ height: "3.25rem" }} ariaLabel={data.name} />;
}

export function SymbolsPalette({ exclude, onAdd }: { exclude?: string; onAdd: (id: string) => void }) {
  const { data: visuals = [] } = useQuery({ queryKey: VISUALS_KEY, queryFn: visualsApi.list });
  const symbols = visuals.filter((v) => v.kind === "symbol" && v.id !== exclude);
  return (
    <section aria-label="Symbols">
      <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "var(--space-1)" }}>Your symbols</div>
      {symbols.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
          None yet. Select some shapes and choose "Make a symbol", or create one from the <Link to="/studio/visuals">Visuals list</Link>.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-1)" }}>
          {symbols.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn-ghost"
              title={`Place "${s.name}"`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SYMBOL_DRAG_TYPE, s.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(s.id)}
              style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "var(--space-1)", padding: "var(--space-1)", height: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)" }}
            >
              <SymbolThumb id={s.id} />
              <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--text)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
