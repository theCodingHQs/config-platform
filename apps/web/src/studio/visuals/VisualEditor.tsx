/** Editing one visual: shapes on the left, the drawing in the middle, settings on the right */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Maximize, Redo2, Save, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { Visual, VisualElement } from "@config-platform/schema";
import { useLiveScope } from "../../live/use-live";
import { shapeOf, type ShapeDef } from "../../visuals/shapes";
import { defaultProps, resolveElement } from "../../visuals/resolve-props";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { newElementId, useVisualEditor } from "./editor-state";
import { EditorCanvas, placeAt } from "./EditorCanvas";
import { ShapePalette } from "./ShapePalette";
import { ElementInspector } from "./ElementInspector";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { useFitZoom } from "./use-fit-zoom";

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

export function VisualEditor({ visual }: { visual: Visual }) {
  const queryClient = useQueryClient();
  const { state, dispatch, selected, update } = useVisualEditor(visual.name, visual.definition);
  const [version, setVersion] = useState(visual.version);
  const areaRef = useRef<HTMLDivElement>(null);
  /** null = fit the drawing in the area */
  const [chosenZoom, setZoom] = useState<number | null>(null);
  const fitZoom = useFitZoom(areaRef, state.definition.width, state.definition.height);
  const zoom = chosenZoom ?? fitZoom;
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const live = useLiveScope(state.definition);
  const resolvedSelected = useMemo(() => {
    const shape = selected && shapeOf(selected.type);
    return shape && selected ? resolveElement(shape, selected, live) : undefined;
  }, [selected, live]);

  const save = useMutation({
    mutationFn: () => visualsApi.update(visual.id, { name: state.name.trim() || visual.name, definition: state.definition, expectedVersion: version }),
    onSuccess: (saved) => {
      setVersion(saved.version);
      dispatch({ type: "saved" });
      setMessage({ tone: "success", text: "Saved" });
      queryClient.setQueryData(visualKey(saved.id), saved);
      queryClient.invalidateQueries({ queryKey: VISUALS_KEY, exact: true });
    },
    onError: (err: Error) => setMessage({ tone: "error", text: err.message }),
  });

  const add = useCallback(
    (shape: ShapeDef, at?: { x: number; y: number }) => {
      const pos = at ?? placeAt(state.definition.width / 2, state.definition.height / 2, false);
      const element: VisualElement = { id: newElementId(state.definition.elements), type: shape.type, x: pos.x, y: pos.y, scale: 1, flip: false, props: defaultProps(shape), bindings: {} };
      dispatch({ type: "add", element });
    },
    [dispatch, state.definition],
  );

  const duplicate = useCallback(() => {
    if (!selected) return;
    const copy = { ...selected, id: newElementId(state.definition.elements), name: selected.name ? `${selected.name} copy` : undefined, x: selected.x + 32, y: selected.y + 16, locked: undefined };
    dispatch({ type: "add", element: copy });
  }, [dispatch, selected, state.definition.elements]);

  const remove = useCallback(() => selected && dispatch({ type: "remove", id: selected.id }), [dispatch, selected]);

  useEditorShortcuts({
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    save: () => state.dirty && !save.isPending && save.mutate(),
    duplicate,
    remove,
    nudge: (dx, dy) => selected && !selected.locked && update(selected.id, { x: selected.x + dx, y: selected.y + dy }, `nudge-${selected.id}`),
    deselect: () => dispatch({ type: "select", id: null }),
  });

  useEffect(() => {
    if (!state.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  const zoomBy = (dir: 1 | -1) => setZoom(dir > 0 ? (ZOOMS.find((z) => z > zoom + 0.001) ?? ZOOMS[ZOOMS.length - 1]) : ([...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? ZOOMS[0]));
  const iconBtn = { padding: "var(--space-1) var(--space-2)" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", height: "calc(100vh - 7rem)", minHeight: "32rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Link to="/studio/visuals" className="btn btn-ghost" style={iconBtn} title="All visuals" aria-label="All visuals">
          <ArrowLeft size="1em" />
        </Link>
        <input
          className="form-input"
          aria-label="Visual name"
          value={state.name}
          onChange={(e) => dispatch({ type: "rename", name: e.target.value, group: "name" })}
          style={{ fontWeight: 600, maxWidth: "20rem" }}
        />
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
          <Undo2 size="1em" />
        </button>
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
          <Redo2 size="1em" />
        </button>
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
          <ZoomOut size="1em" />
        </button>
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", minWidth: "2.5rem", textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1)}>
          <ZoomIn size="1em" />
        </button>
        <button type="button" className={chosenZoom === null ? "btn btn-secondary" : "btn btn-ghost"} style={iconBtn} title="Fit to the window" aria-label="Fit to the window" aria-pressed={chosenZoom === null} onClick={() => setZoom(null)}>
          <Maximize size="1em" />
        </button>
        {message && (
          <span role="status" style={{ fontSize: "var(--font-size-sm)", color: message.tone === "error" ? "var(--danger)" : "var(--success)", maxWidth: "24rem" }}>
            {message.text}
          </span>
        )}
        <button type="button" className="btn btn-primary" disabled={!state.dirty || save.isPending} onClick={() => save.mutate()} title="Save (Ctrl+S)">
          <Save size="1em" /> {save.isPending ? "Saving…" : state.dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "12rem minmax(0, 1fr) 19rem", gap: "var(--space-3)", flex: 1, minHeight: 0 }}>
        <aside style={{ overflowY: "auto", paddingRight: "var(--space-1)" }}>
          <ShapePalette onAdd={(shape) => add(shape)} />
        </aside>
        <div ref={areaRef} style={{ overflow: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", background: "var(--surface-2)", padding: "var(--space-4)", display: "flex" }}>
          <div style={{ margin: "auto" }}>
            <EditorCanvas
              definition={state.definition}
              scope={live}
              selectedId={state.selectedId}
              zoom={zoom}
              onSelect={(id) => dispatch({ type: "select", id })}
              onMove={(id, x, y, group) => update(id, { x, y }, group)}
              onDropShape={(type, x, y) => {
                const shape = shapeOf(type);
                if (shape) add(shape, { x, y });
              }}
            />
          </div>
        </div>
        <aside style={{ overflowY: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", background: "var(--surface)", padding: "var(--space-3)" }}>
          <ElementInspector
            definition={state.definition}
            element={selected}
            resolved={resolvedSelected}
            onElement={(patch, group) => selected && update(selected.id, patch, group)}
            onCanvas={(patch, group) => dispatch({ type: "canvas", patch, group })}
            onDuplicate={duplicate}
            onRemove={remove}
          />
        </aside>
      </div>
    </div>
  );
}
