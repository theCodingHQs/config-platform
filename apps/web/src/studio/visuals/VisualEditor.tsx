/**
 * Editing one visual: tools on the far left, layers and ready-made parts next to them, the drawing
 * in the middle, settings for what's selected on the right.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Maximize, Redo2, Save, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { Visual, VisualNode } from "@config-platform/schema";
import { useLiveScope } from "../../live/use-live";
import { shapeOf, type ShapeDef } from "../../visuals/shapes";
import { defaultProps } from "../../visuals/resolve-props";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { useVisualEditor } from "./editor-state";
import { EditorCanvas } from "./EditorCanvas";
import { ShapePalette } from "./ShapePalette";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { ToolBar } from "./ToolBar";
import { nodeLabel } from "./NodeInspector";
import { allIds, childrenOf, findNode, nextId, parentIdOf, withNewIds } from "./node-tree";
import { copyNodes, readNodes } from "./clipboard";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { useFitZoom } from "./use-fit-zoom";
import type { ToolId } from "./tools";

const ZOOMS = [0.25, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Moves copies along a little so they don't sit exactly on the originals */
const offset = (nodes: VisualNode[], d: number) => nodes.map((n) => ({ ...n, attrs: { ...n.attrs, x: num(n.attrs.x) + d, y: num(n.attrs.y) + d } }));

export function VisualEditor({ visual }: { visual: Visual }) {
  const queryClient = useQueryClient();
  const { state, dispatch, selected, update, openPath } = useVisualEditor(visual.name, visual.definition);
  const [version, setVersion] = useState(visual.version);
  const [tool, setTool] = useState<ToolId>("select");
  const [panel, setPanel] = useState<"layers" | "parts">("layers");
  const areaRef = useRef<HTMLDivElement>(null);
  /** null = fit the drawing in the area */
  const [chosenZoom, setZoom] = useState<number | null>(null);
  const fitZoom = useFitZoom(areaRef, state.definition.width, state.definition.height);
  const zoom = chosenZoom ?? fitZoom;
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const live = useLiveScope(state.definition);
  const nodes = state.definition.nodes;

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

  const addPart = useCallback(
    (shape: ShapeDef, at?: { x: number; y: number }) => {
      const pos = at ?? { x: Math.round(state.definition.width / 2), y: Math.round(state.definition.height / 2) };
      const node: VisualNode = { id: nextId(allIds(nodes), shape.type), kind: "preset", ref: shape.type, attrs: { ...defaultProps(shape), x: pos.x, y: pos.y } };
      dispatch({ type: "add", nodes: [node] });
    },
    [dispatch, nodes, state.definition.width, state.definition.height],
  );

  const step = state.definition.grid && state.definition.mode === "flat" ? state.definition.gridSize : 10;
  const duplicate = useCallback(() => {
    if (!selected.length) return;
    const copies = offset(withNewIds(selected, allIds(nodes)), step).map((n) => ({ ...n, locked: undefined }));
    dispatch({ type: "add", nodes: copies, parentId: parentIdOf(nodes, selected[0].id) });
  }, [dispatch, nodes, selected, step]);

  const remove = useCallback(() => selected.length && dispatch({ type: "remove", ids: selected.map((n) => n.id) }), [dispatch, selected]);

  const editText = useCallback(
    (id: string) => {
      dispatch({ type: "select", ids: [id] });
      setTimeout(() => (document.getElementById("vis-attr-text") as HTMLInputElement | null)?.select(), 0);
    },
    [dispatch],
  );

  useEditorShortcuts({
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    save: () => state.dirty && !save.isPending && save.mutate(),
    duplicate,
    remove,
    copy: () => void copyNodes(selected),
    cut: () => {
      void copyNodes(selected);
      remove();
    },
    paste: async () => {
      const pasted = await readNodes();
      if (pasted) dispatch({ type: "add", nodes: offset(withNewIds(pasted, allIds(nodes)), step) });
    },
    selectAll: () => dispatch({ type: "select", ids: childrenOf(nodes, state.openGroup).map((n) => n.id) }),
    group: () => selected.length && dispatch({ type: "group", ids: selected.map((n) => n.id) }),
    ungroup: () => selected.filter((n) => n.kind === "group").forEach((g) => dispatch({ type: "ungroup", id: g.id })),
    order: (move) => selected.length && dispatch({ type: "order", ids: selected.map((n) => n.id), move }),
    nudge: (dx, dy) => {
      const movable = selected.filter((n) => !n.locked);
      if (movable.length) dispatch({ type: "update", changes: movable.map((n) => ({ id: n.id, patch: { attrs: { x: num(n.attrs.x) + dx, y: num(n.attrs.y) + dy } } })), group: `nudge-${movable.map((n) => n.id).join()}` });
    },
    escape: () => {
      if (tool !== "select") return setTool("select");
      if (state.selection.length) return dispatch({ type: "select", ids: [] });
      if (state.openGroup) dispatch({ type: "open", id: parentIdOf(nodes, state.openGroup) });
    },
    tool: setTool,
  });

  useEffect(() => {
    if (!state.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  const zoomBy = (dir: 1 | -1) => setZoom(dir > 0 ? (ZOOMS.find((z) => z > zoom + 0.001) ?? ZOOMS[ZOOMS.length - 1]) : ([...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? ZOOMS[0]));
  const iconBtn = { padding: "var(--space-1) var(--space-2)" } as const;
  const tab = (id: "layers" | "parts", label: string) => (
    <button type="button" role="tab" aria-selected={panel === id} className={panel === id ? "btn btn-secondary" : "btn btn-ghost"} style={{ flex: 1, padding: "var(--space-1)", fontSize: "var(--font-size-xs)" }} onClick={() => setPanel(id)}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", height: "calc(100vh - 7rem)", minHeight: "32rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Link to="/studio/visuals" className="btn btn-ghost" style={iconBtn} title="All visuals" aria-label="All visuals">
          <ArrowLeft size="1em" />
        </Link>
        <input className="form-input" aria-label="Visual name" value={state.name} onChange={(e) => dispatch({ type: "rename", name: e.target.value, group: "name" })} style={{ fontWeight: 600, maxWidth: "18rem" }} />
        {openPath.length > 0 && (
          <nav aria-label="Open group" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--font-size-xs)" }}>
            <button type="button" className="btn btn-ghost" style={{ padding: "0 var(--space-1)", fontSize: "inherit" }} onClick={() => dispatch({ type: "open", id: null })}>
              Drawing
            </button>
            {openPath.map((id) => {
              const n = findNode(nodes, id);
              return (
                <React.Fragment key={id}>
                  <ChevronRight size="1em" aria-hidden="true" />
                  <button type="button" className="btn btn-ghost" style={{ padding: "0 var(--space-1)", fontSize: "inherit", fontWeight: id === state.openGroup ? 600 : 400 }} onClick={() => dispatch({ type: "open", id })}>
                    {n ? nodeLabel(n) : id}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        )}
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

      <div style={{ display: "grid", gridTemplateColumns: "auto 13rem minmax(0, 1fr) 20rem", gap: "var(--space-3)", flex: 1, minHeight: 0 }}>
        <ToolBar tool={tool} onTool={setTool} />
        <aside style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minHeight: 0 }}>
          <div role="tablist" style={{ display: "flex", gap: "var(--space-1)" }}>
            {tab("layers", "Layers")}
            {tab("parts", "Parts")}
          </div>
          <div style={{ overflowY: "auto", flex: 1, paddingRight: "var(--space-1)" }}>
            {panel === "layers" ? (
              <LayersPanel
                nodes={nodes}
                selection={state.selection}
                openGroup={state.openGroup}
                onSelect={(ids, parentId) => {
                  if (parentId !== state.openGroup) dispatch({ type: "open", id: parentId });
                  dispatch({ type: "select", ids });
                }}
                onToggleHidden={(n) => update(n.id, { hidden: !n.hidden })}
              />
            ) : (
              <ShapePalette onAdd={(shape) => addPart(shape)} />
            )}
          </div>
        </aside>
        <div ref={areaRef} style={{ overflow: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", background: "var(--surface-2)", padding: "var(--space-4)", display: "flex" }}>
          <div style={{ margin: "auto" }}>
            <EditorCanvas
              state={state}
              dispatch={dispatch}
              scope={live}
              zoom={zoom}
              tool={tool}
              onToolDone={() => setTool("select")}
              onEditText={editText}
              onDropPart={(type, x, y) => {
                const shape = shapeOf(type);
                if (shape) addPart(shape, { x, y });
              }}
            />
          </div>
        </div>
        <aside style={{ overflowY: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", background: "var(--surface)", padding: "var(--space-3)" }}>
          <Inspector
            definition={state.definition}
            selected={selected}
            scope={live}
            onPatch={update}
            onCanvas={(patch, group) => dispatch({ type: "canvas", patch, group })}
            onDuplicate={duplicate}
            onRemove={remove}
            onGroup={() => dispatch({ type: "group", ids: selected.map((n) => n.id) })}
          />
        </aside>
      </div>
    </div>
  );
}
