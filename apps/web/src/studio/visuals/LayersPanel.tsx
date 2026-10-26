/**
 * Every node in drawing order (top of the list draws on top), with groups opened out. Rows look
 * like the page builder's component tree: the selected row outlined in the accent colour, a
 * dashed outline on hover, and a line down the left of each group's contents.
 */
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

/** A group's contents: one step in, with a line down the left (as in the page builder's tree) */
const CHILDREN_STYLE: React.CSSProperties = {
  listStyle: "none",
  margin: "0 0 0 0.6rem",
  padding: "0 0 0 var(--space-1)",
  borderLeft: "var(--border-width-sm) solid var(--border)",
};

function Row({ node, parentId, props }: { node: VisualNode; parentId: string | null; props: Props }) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const selected = props.selection.includes(node.id);
  const kids = node.children ?? [];
  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={kids.length ? expanded : undefined}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "0.125rem 0.375rem",
          marginBottom: "2px",
          borderRadius: "var(--radius-control)",
          backgroundColor: selected ? "var(--accent-subtle)" : hovered ? "var(--surface-2)" : "transparent",
          border: selected ? "1px solid var(--accent)" : hovered ? "1px dashed var(--accent)" : "1px solid transparent",
          transition: "background-color 0.12s ease, border-color 0.12s ease",
          fontSize: "var(--font-size-xs)",
          color: node.hidden ? "var(--text-muted)" : selected || hovered ? "var(--accent)" : "var(--text)",
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
      </div>
      {expanded && kids.length > 0 && (
        <ul role="group" style={CHILDREN_STYLE}>
          {[...kids].reverse().map((k) => (
            <Row key={k.id} node={k} parentId={node.id} props={props} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LayersPanel(props: Props) {
  if (!props.nodes.length) return <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Nothing drawn yet.</p>;
  return (
    <ul role="tree" aria-label="Layers" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
      {[...props.nodes].reverse().map((n) => (
        <Row key={n.id} node={n} parentId={null} props={props} />
      ))}
    </ul>
  );
}
