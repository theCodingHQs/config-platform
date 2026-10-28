/** Symbols to place in the drawing (built-in, shared and the workspace's own): click one to drop it in the middle, or drag it on */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { sharedRef } from "@config-platform/schema";
import { BUILTIN_SYMBOLS } from "@config-platform/schema/visual-library";
import { sharedApi, sharedListKey, usable } from "../../library/shared-api";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { VisualScene } from "../../visuals/VisualScene";
import { useSymbols } from "../../visuals/use-symbols";

export const SYMBOL_DRAG_TYPE = "application/x-visual-symbol";

export function SymbolThumb({ id, height = "3.25rem" }: { id: string; height?: string }) {
  const { data } = useQuery({ queryKey: visualKey(id), queryFn: () => visualsApi.get(id), staleTime: 30_000 });
  const symbols = useSymbols(data?.definition);
  if (!data) return <div style={{ height }} />;
  return <VisualScene definition={{ ...data.definition, background: "transparent" }} symbols={symbols} scope={null} className="vis-paused" style={{ height }} ariaLabel={data.name} />;
}

const heading = { fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "var(--space-1)" } as const;
const tiles = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-1)" } as const;

function SymbolTile({ id, name, hint, onAdd }: { id: string; name: string; hint?: string; onAdd: (id: string) => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      title={hint ? `Place "${name}": ${hint}` : `Place "${name}"`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SYMBOL_DRAG_TYPE, id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onAdd(id)}
      style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "var(--space-1)", padding: "var(--space-1)", height: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-control)" }}
    >
      <SymbolThumb id={id} />
      <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--text)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </button>
  );
}

export function SymbolsPalette({ exclude, onAdd }: { exclude?: string; onAdd: (id: string) => void }) {
  const { data: visuals = [] } = useQuery({ queryKey: VISUALS_KEY, queryFn: visualsApi.list });
  const { data: sharedItems = [] } = useQuery({ queryKey: sharedListKey("symbol"), queryFn: () => sharedApi.list("symbol") });
  const mine = visuals.filter((v) => v.kind === "symbol" && v.id !== exclude);
  // A symbol being edited can't place its own shared release
  const shared = sharedItems.filter((s) => usable(s) && !(exclude && s.sourceId === exclude));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <section aria-label="Built-in symbols">
        <div style={heading}>Built-in</div>
        <div style={tiles}>
          {BUILTIN_SYMBOLS.map((s) => (
            <SymbolTile key={s.id} id={s.id} name={s.name} hint={s.description} onAdd={onAdd} />
          ))}
        </div>
      </section>
      {shared.length > 0 && (
        <section aria-label="Shared symbols">
          <div style={heading}>Shared</div>
          <div style={tiles}>
            {shared.map((s) => (
              <SymbolTile key={s.id} id={sharedRef(s.id)} name={s.name} hint={s.description || undefined} onAdd={onAdd} />
            ))}
          </div>
        </section>
      )}
      <section aria-label="My symbols">
        <div style={heading}>Mine</div>
        {mine.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
            None yet. Select some shapes and choose "Make a symbol", or create one from the <Link to="/studio/visuals">Visuals list</Link>.
          </p>
        ) : (
          <div style={tiles}>
            {mine.map((s) => (
              <SymbolTile key={s.id} id={s.id} name={s.name} onAdd={onAdd} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
