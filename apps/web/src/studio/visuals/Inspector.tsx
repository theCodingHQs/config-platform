/** Right-hand panel: the canvas when nothing is selected, one node's settings, or what can be done with several */
import React, { useMemo } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, Component, Group, Trash2 } from "lucide-react";
import type { AlignMode } from "./align";
import type { ExpressionScope, VisualDefinition, VisualNode } from "@config-platform/schema";
import { specsFor } from "../../visuals/node-specs";
import { resolveNode } from "../../visuals/resolve-props";
import { CanvasSettings } from "./CanvasSettings";
import { NodeInspector } from "./NodeInspector";
import type { NodePatch } from "./node-tree";

interface Props {
  definition: VisualDefinition;
  selected: VisualNode[];
  scope: ExpressionScope | null;
  symbols?: ReadonlyMap<string, VisualDefinition>;
  isSymbol?: boolean;
  onPatch: (id: string, patch: NodePatch, group?: string) => void;
  onCanvas: (patch: Partial<Omit<VisualDefinition, "nodes">>, group?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onGroup: () => void;
  onMakeSymbol: () => void;
  onAlign: (mode: AlignMode) => void;
}

const ALIGN: Array<{ mode: AlignMode; label: string; Icon: typeof Group }> = [
  { mode: "left", label: "Line up left edges", Icon: AlignStartVertical },
  { mode: "center", label: "Line up centres (across)", Icon: AlignCenterVertical },
  { mode: "right", label: "Line up right edges", Icon: AlignEndVertical },
  { mode: "top", label: "Line up tops", Icon: AlignStartHorizontal },
  { mode: "middle", label: "Line up middles (up/down)", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Line up bottoms", Icon: AlignEndHorizontal },
  { mode: "spread-x", label: "Space evenly across", Icon: AlignHorizontalSpaceAround },
  { mode: "spread-y", label: "Space evenly up/down", Icon: AlignVerticalSpaceAround },
];

export function Inspector({ definition, selected, scope, symbols, isSymbol, onPatch, onCanvas, onDuplicate, onRemove, onGroup, onMakeSymbol, onAlign }: Props) {
  const node = selected.length === 1 ? selected[0] : null;
  const inputs = node?.kind === "symbol" && node.ref ? symbols?.get(node.ref)?.inputs : undefined;
  const specs = useMemo(() => (node ? specsFor(node, inputs) : []), [node, inputs]);
  const resolved = useMemo(() => (node ? resolveNode(node, specs, scope) : undefined), [node, specs, scope]);

  return (
    <>
      {node ? (
        <NodeInspector
          node={node}
          definition={definition}
          specs={specs}
          resolved={resolved}
          onPatch={(patch, group) => onPatch(node.id, patch, group)}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          onMakeSymbol={onMakeSymbol}
        />
      ) : selected.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>{selected.length} selected</h2>
          <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Drag to move them together. Group them to move, copy or animate them as one.</p>
          <div role="group" aria-label="Line up" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
            {ALIGN.map(({ mode, label, Icon }) => (
              <button key={mode} type="button" className="btn btn-ghost" title={label} aria-label={label} disabled={mode.startsWith("spread") && selected.length < 3} onClick={() => onAlign(mode)} style={{ padding: "var(--space-1)" }}>
                <Icon size="1.1em" />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={onGroup}>
              <Group size="1em" /> Group (Ctrl+G)
            </button>
            <button type="button" className="btn btn-ghost" onClick={onMakeSymbol}>
              <Component size="1em" /> Make a symbol
            </button>
            <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={onRemove}>
              <Trash2 size="1em" /> Delete
            </button>
          </div>
        </div>
      ) : (
        <CanvasSettings definition={definition} isSymbol={isSymbol} onCanvas={onCanvas} />
      )}
    </>
  );
}
