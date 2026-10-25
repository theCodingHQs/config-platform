/**
 * Editing one visual: tools on the far left, layers and ready-made parts next to them, the drawing
 * in the middle, settings for what's selected on the right.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, FileUp, Maximize, Redo2, Save, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { Visual, VisualNode } from "@config-platform/schema";
import { useLiveScope } from "../../live/use-live";
import { shapeOf, type ShapeDef } from "../../visuals/shapes";
import { defaultProps } from "../../visuals/resolve-props";
import { VISUALS_KEY, visualKey, visualsApi } from "../../visuals/visuals-api";
import { useSymbols } from "../../visuals/use-symbols";
import { SymbolsPalette } from "./SymbolsPalette";
import { inputDefaults } from "./InputsEditor";
import { symbolFromNodes } from "./make-symbol";
import { nodeBox, parentSpace, unionBox } from "./canvas-geometry";
import { useSvgImport } from "./use-svg-import";
import { alignMoves, type AlignMode } from "./align";
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
  const isSymbol = visual.kind === "symbol";
  const symbols = useSymbols(state.definition);
  const watched = useMemo(() => [state.definition, ...symbols.values()], [state.definition, symbols]);
  const live = useLiveScope(watched);
  // Editing a symbol: its shapes see the inputs' starting values
  const scope = useMemo(() => (isSymbol ? { ...live, inputs: inputDefaults(state.definition.inputs) } : live), [isSymbol, live, state.definition.inputs]);
  const suggestions = useMemo(() => (state.definition.inputs ?? []).map((i) => `inputs.${i.name}`), [state.definition.inputs]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const report = useCallback((tone: "error" | "success", text: string) => setMessage({ tone, text }), []);
  const importSvg = useSvgImport(state.definition, dispatch, report);

  const addPart = useCallback(
    (shape: ShapeDef, at?: { x: number; y: number }) => {
      const pos = at ?? { x: Math.round(state.definition.width / 2), y: Math.round(state.definition.height / 2) };
      const node: VisualNode = { id: nextId(allIds(nodes), shape.type), kind: "preset", ref: shape.type, attrs: { ...defaultProps(shape), x: pos.x, y: pos.y } };
      dispatch({ type: "add", nodes: [node] });
    },
    [dispatch, nodes, state.definition.width, state.definition.height],
  );

  const addSymbol = useCallback(
    (id: string, at?: { x: number; y: number }) => {
      const pos = at ?? { x: Math.round(state.definition.width / 2), y: Math.round(state.definition.height / 2) };
      dispatch({ type: "add", nodes: [{ id: nextId(allIds(nodes), "symbol"), kind: "symbol", ref: id, attrs: { x: pos.x, y: pos.y } }] });
    },
    [dispatch, nodes, state.definition.width, state.definition.height],
  );

  const makeSymbol = useMutation({
    mutationFn: async (name: string) => {
      const svg = svgRef.current;
      const box = svg && unionBox(selected.map((n) => nodeBox(svg, n.id)));
      if (!svg || !box) throw new Error("Select what to turn into a symbol first");
      const toParent = parentSpace(svg, selected[0].id).point;
      const a = toParent({ x: box.x, y: box.y });
      const b = toParent({ x: box.x + box.width, y: box.y + box.height });
      const local = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      const made = symbolFromNodes(selected, local, state.definition);
      const saved = await visualsApi.create({ name, kind: "symbol", definition: made.definition });
      return { saved, at: made.at };
    },
    onSuccess: ({ saved, at }) => {
      queryClient.setQueryData(visualKey(saved.id), saved);
      queryClient.invalidateQueries({ queryKey: VISUALS_KEY, exact: true });
      const group = `symbol-${saved.id}`;
      const parentId = parentIdOf(nodes, selected[0].id);
      const index = childrenOf(nodes, parentId).findIndex((n) => n.id === selected[0].id);
      dispatch({ type: "remove", ids: selected.map((n) => n.id), group });
      dispatch({ type: "add", nodes: [{ id: nextId(allIds(nodes), "symbol"), kind: "symbol", ref: saved.id, name: saved.name, attrs: at }], parentId, index, group });
      setMessage({ tone: "success", text: `Made the symbol "${saved.name}". Open it to add inputs.` });
    },
    onError: (err: Error) => setMessage({ tone: "error", text: err.message }),
  });
  const align = (mode: AlignMode) => {
    const svg = svgRef.current;
    if (!svg) return;
    const items = selected.filter((n) => !n.locked).flatMap((n) => {
      const box = nodeBox(svg, n.id);
      return box ? [{ id: n.id, box }] : [];
    });
    const changes = [...alignMoves(items, mode)].map(([id, d]) => {
      const n = selected.find((x) => x.id === id)!;
      const v = parentSpace(svg, id).vector({ x: d.dx, y: d.dy });
      const r = (x: number) => Math.round(x * 100) / 100;
      return { id, patch: { attrs: { x: r(num(n.attrs.x) + v.x), y: r(num(n.attrs.y) + v.y) } } };
    });
    if (changes.length) dispatch({ type: "update", changes });
  };
  const askSymbolName = () => {
    const name = window.prompt("Name the new symbol", selected.length === 1 ? nodeLabel(selected[0]) : "");
    if (name?.trim()) makeSymbol.mutate(name.trim());
  };

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
      if (pasted) return dispatch({ type: "add", nodes: offset(withNewIds(pasted, allIds(nodes)), step) });
      // SVG copied from a file or a browser's inspector comes in as shapes
      const text = await navigator.clipboard.readText().catch(() => "");
      if (/<svg[s>]/i.test(text)) importSvg(text, "Pasted SVG");
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
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 5_000_000) return report("error", "That file is too big (over 5 MB)");
            importSvg(await file.text(), file.name.replace(/.svg$/i, ""));
          }}
        />
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Bring in an SVG file (or paste SVG with Ctrl+V)" onClick={() => fileRef.current?.click()}>
          <FileUp size="1em" /> Import SVG
        </button>
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
            {panel === "parts" && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <SymbolsPalette exclude={visual.id} onAdd={(id) => addSymbol(id)} />
              </div>
            )}
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
              scope={scope}
              symbols={symbols}
              svgRef={svgRef}
              zoom={zoom}
              tool={tool}
              onToolDone={() => setTool("select")}
              onEditText={editText}
              onDrop={(what, ref, x, y) => {
                if (what === "symbol") return addSymbol(ref, { x, y });
                const shape = shapeOf(ref);
                if (shape) addPart(shape, { x, y });
              }}
            />
          </div>
        </div>
        <aside style={{ overflowY: "auto", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", background: "var(--surface)", padding: "var(--space-3)" }}>
          <Inspector
            definition={state.definition}
            selected={selected}
            scope={scope}
            symbols={symbols}
            isSymbol={isSymbol}
            suggestions={suggestions}
            onMakeSymbol={askSymbolName}
            onAlign={align}
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
