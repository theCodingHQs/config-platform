/** The inspector for one selected node: its name, every attribute (each can follow live data), rules and animations */
import React from "react";
import { Copy, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import type { VisualDefinition, VisualNode } from "@config-platform/schema";
import { shapeOf, type PropSpec } from "../../visuals/shapes";
import type { ResolvedNode } from "../../visuals/resolve-props";
import { GROUPS } from "../../visuals/node-specs";
import { Field } from "../live/Field";
import { PropField } from "./PropField";
import { RulesEditor } from "./RulesEditor";
import { EffectsEditor } from "./EffectsEditor";
import type { NodePatch } from "./node-tree";

export const KIND_LABELS: Record<VisualNode["kind"], string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  polyline: "Polyline",
  polygon: "Polygon",
  path: "Path",
  text: "Text",
  image: "Picture",
  group: "Group",
  preset: "Part",
  symbol: "Symbol",
};

export const nodeLabel = (n: VisualNode) => n.name || (n.kind === "preset" ? (shapeOf(n.ref ?? "")?.label ?? "Part") : KIND_LABELS[n.kind]);

/** Sections in the order they're shown; the first two start open */
const SECTION_ORDER = [GROUPS.part, GROUPS.inputs, GROUPS.text, GROUPS.shape, GROUPS.look, GROUPS.place];

interface Props {
  node: VisualNode;
  definition: VisualDefinition;
  specs: readonly PropSpec[];
  resolved: ResolvedNode | undefined;
  tagListId: string;
  onPatch: (patch: NodePatch, group?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

const iconBtn = { padding: "var(--space-1)" } as const;

export function NodeInspector({ node, definition, specs, resolved, tagListId, onPatch, onDuplicate, onRemove }: Props) {
  const paints = (definition.paints ?? []).map((p) => p.id);
  const iso = definition.mode === "isometric";
  const shown = specs.filter((s) => !s.isoOnly || iso);
  const sections = SECTION_ORDER.map((title) => ({ title, specs: shown.filter((s) => s.group === title) })).filter((s) => s.specs.length);
  const group = (name: string) => `${node.id}-${name}`;
  const part = node.kind === "preset" ? shapeOf(node.ref ?? "") : undefined;

  const field = (spec: PropSpec) => (
    <PropField
      key={spec.name}
      spec={spec}
      value={node.attrs[spec.name]}
      binding={node.bindings?.[spec.name]}
      current={resolved?.attrs[spec.name]}
      problem={resolved?.problems[spec.name]}
      tagListId={tagListId}
      paints={paints}
      onValue={(value) => onPatch({ attrs: { [spec.name]: value } }, group(`a-${spec.name}`))}
      onBinding={(expr) => {
        const bindings = { ...node.bindings };
        if (expr === undefined) delete bindings[spec.name];
        else bindings[spec.name] = expr;
        onPatch({ bindings }, group(`b-${spec.name}`));
      }}
    />
  );

  const live = Object.keys(node.bindings ?? {}).length + (node.rules?.length ?? 0) + (node.effects?.length ?? 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }} aria-label="Shape settings">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-sm)", flex: 1 }}>{part?.label ?? KIND_LABELS[node.kind]}</h2>
        <button type="button" className="btn btn-ghost" style={iconBtn} title={node.hidden ? "Show while editing" : "Hide while editing"} aria-label={node.hidden ? "Show" : "Hide"} onClick={() => onPatch({ hidden: !node.hidden })}>
          {node.hidden ? <EyeOff size="1em" /> : <Eye size="1em" />}
        </button>
        <button type="button" className="btn btn-ghost" style={iconBtn} title={node.locked ? "Unlock" : "Lock in place"} aria-label={node.locked ? "Unlock" : "Lock"} aria-pressed={Boolean(node.locked)} onClick={() => onPatch({ locked: !node.locked })}>
          {node.locked ? <Lock size="1em" /> : <Unlock size="1em" />}
        </button>
        <button type="button" className="btn btn-ghost" style={iconBtn} title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={onDuplicate}>
          <Copy size="1em" />
        </button>
        <button type="button" className="btn btn-ghost" style={{ ...iconBtn, color: "var(--danger)" }} title="Delete (Del)" aria-label="Delete" onClick={onRemove}>
          <Trash2 size="1em" />
        </button>
      </div>
      {part && <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{part.description}</p>}

      <Field label="Name" htmlFor="vis-node-name" hint="To find it in the layers list">
        <input id="vis-node-name" className="form-input" value={node.name ?? ""} placeholder={part?.label ?? KIND_LABELS[node.kind]} onChange={(e) => onPatch({ name: e.target.value || undefined }, group("name"))} />
      </Field>

      {sections.map((section, i) => (
        <details key={section.title} open={i < 2}>
          <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{section.title}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", paddingTop: "var(--space-2)" }}>{section.specs.map(field)}</div>
        </details>
      ))}

      <details open={live > 0}>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>Rules</summary>
        <div style={{ paddingTop: "var(--space-2)" }}>
          <RulesEditor rules={node.rules ?? []} specs={shown} resolved={resolved} tagListId={tagListId} paints={paints} onChange={(rules, g) => onPatch({ rules }, g && group(g))} />
        </div>
      </details>
      <details open={Boolean(node.effects?.length || node.smooth)}>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>Animation</summary>
        <div style={{ paddingTop: "var(--space-2)" }}>
          <EffectsEditor
            effects={node.effects ?? []}
            smooth={node.smooth}
            resolved={resolved}
            tagListId={tagListId}
            onEffects={(effects, g) => onPatch({ effects }, g && group(g))}
            onSmooth={(smooth) => onPatch({ smooth }, group("smooth"))}
          />
        </div>
      </details>
    </div>
  );
}
