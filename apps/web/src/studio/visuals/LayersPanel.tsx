/** Every node in drawing order (top of the list draws on top), with groups opened out */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock } from "lucide-react";
import type { VisualNode } from "@config-platform/schema";
import { nodeLabel } from "./NodeInspector";

interface Props {
  nodes: readonly VisualNode[];
  selection: readonly string[];
  openGroup: string | null;
  onSelect: (ids: string[], openGroup: string | null) => void;
  onToggleHidden: (node: VisualNode) => void;
}

function Row({ node, depth, parentId, props }: { node: VisualNode; depth: number; parentId: string | null; props: Props }) {
  const [expanded, setExpanded] = useState(true);
  const selected = props.selection.includes(node.id);
  const kids = node.children ?? [];
  return (
    <>
      <li
        role="treeitem"
        aria-selected={selected}
        aria-expanded={kids.length ? expanded : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          paddingLeft: `calc(var(--space-3) * ${depth})`,
          borderRadius: "var(--radius-control)",
          background: selected ? "var(--accent-subtle, var(--surface-2))" : undefined,
          fontSize: "var(--font-size-xs)",
          color: node.hidden ? "var(--text-muted)" : "var(--text)",
        }}
      >
        <button type="button" className="btn btn-ghost" aria-label={expanded ? "Collapse" : "Expand"} style={{ padding: 0, visibility: kids.length ? "visible" : "hidden" }} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size="1em" /> : <ChevronRight size="1em" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            const ids = e.shiftKey ? (selected ? props.selection.filter((x) => x !== node.id) : [...props.selection, node.id]) : [node.id];
            props.onSelect(ids, parentId);
          }}
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, padding: "var(--space-1) 0", cursor: "pointer", color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: selected ? 600 : 400 }}
        >
          {nodeLabel(node)}
          {(node.bindings && Object.keys(node.bindings).length) || node.rules?.length ? <span title="Uses live data" style={{ color: "var(--accent)" }}> ⚡</span> : null}
        </button>
        {node.locked && <Lock size="0.9em" aria-label="Locked" style={{ color: "var(--text-muted)" }} />}
        <button type="button" className="btn btn-ghost" style={{ padding: 0 }} aria-label={node.hidden ? `Show ${nodeLabel(node)}` : `Hide ${nodeLabel(node)}`} title={node.hidden ? "Show" : "Hide while editing"} onClick={() => props.onToggleHidden(node)}>
          {node.hidden ? <EyeOff size="1em" /> : <Eye size="1em" />}
        </button>
      </li>
      {expanded && [...kids].reverse().map((k) => <Row key={k.id} node={k} depth={depth + 1} parentId={node.id} props={props} />)}
    </>
  );
}

export function LayersPanel(props: Props) {
  if (!props.nodes.length) return <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Nothing drawn yet.</p>;
  return (
    <ul role="tree" aria-label="Layers" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
      {[...props.nodes].reverse().map((n) => (
        <Row key={n.id} node={n} depth={0} parentId={null} props={props} />
      ))}
    </ul>
  );
}
