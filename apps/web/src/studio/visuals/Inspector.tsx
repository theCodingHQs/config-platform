/** Right-hand panel: the canvas when nothing is selected, one node's settings, or what can be done with several */
import React, { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Group, Trash2 } from "lucide-react";
import type { ExpressionScope, VisualDefinition, VisualNode } from "@config-platform/schema";
import { specsFor } from "../../visuals/node-specs";
import { resolveNode } from "../../visuals/resolve-props";
import { liveApi } from "../../live/live-api";
import { CanvasSettings } from "./CanvasSettings";
import { NodeInspector } from "./NodeInspector";
import type { NodePatch } from "./node-tree";

interface Props {
  definition: VisualDefinition;
  selected: VisualNode[];
  scope: ExpressionScope | null;
  symbols?: ReadonlyMap<string, VisualDefinition>;
  onPatch: (id: string, patch: NodePatch, group?: string) => void;
  onCanvas: (patch: Partial<Omit<VisualDefinition, "nodes">>, group?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onGroup: () => void;
}

export function Inspector({ definition, selected, scope, symbols, onPatch, onCanvas, onDuplicate, onRemove, onGroup }: Props) {
  const tagListId = useId();
  const { data: tags = [] } = useQuery({ queryKey: ["live-tags"], queryFn: liveApi.tags, staleTime: 30_000 });
  const node = selected.length === 1 ? selected[0] : null;
  const inputs = node?.kind === "symbol" && node.ref ? symbols?.get(node.ref)?.inputs : undefined;
  const specs = useMemo(() => (node ? specsFor(node, inputs) : []), [node, inputs]);
  const resolved = useMemo(() => (node ? resolveNode(node, specs, scope) : undefined), [node, specs, scope]);

  return (
    <>
      <datalist id={tagListId}>
        {tags.map((t) => (
          <option key={t.tag} value={`live.${t.tag}`}>
            {t.label ?? t.connectionName}
          </option>
        ))}
      </datalist>
      {node ? (
        <NodeInspector
          node={node}
          definition={definition}
          specs={specs}
          resolved={resolved}
          tagListId={tagListId}
          onPatch={(patch, group) => onPatch(node.id, patch, group)}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      ) : selected.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>{selected.length} selected</h2>
          <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Drag to move them together. Group them to move, copy or animate them as one.</p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={onGroup}>
              <Group size="1em" /> Group (Ctrl+G)
            </button>
            <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={onRemove}>
              <Trash2 size="1em" /> Delete
            </button>
          </div>
        </div>
      ) : (
        <CanvasSettings definition={definition} onCanvas={onCanvas} />
      )}
    </>
  );
}
