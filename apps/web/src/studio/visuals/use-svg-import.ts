/**
 * Bringing an SVG into the drawing being edited, as one group: from a file, or pasted as text.
 * Its gradients join the drawing's (renamed if a different one already has the name), and an
 * empty drawing takes on the SVG's size.
 */
import { useCallback } from "react";
import type { VisualDefinition, VisualNode, VisualPaint } from "@config-platform/schema";
import type { EditorAction } from "./editor-state";
import { allIds, nextId } from "./node-tree";
import { importSvg } from "./svg-import";

/** Joins imported gradients to the drawing's; returns them and the renames to apply to the shapes */
export function mergePaints(existing: readonly VisualPaint[], incoming: readonly VisualPaint[]): { paints: VisualPaint[]; renames: Map<string, string> } {
  const paints = [...existing];
  const renames = new Map<string, string>();
  for (const p of incoming) {
    const same = paints.find((q) => q.id === p.id);
    if (same && JSON.stringify(same) === JSON.stringify(p)) continue;
    let id = p.id;
    for (let i = 2; paints.some((q) => q.id === id); i++) id = `${p.id}-${i}`;
    if (id !== p.id) renames.set(p.id, id);
    paints.push({ ...p, id });
  }
  return { paints: paints.slice(0, 100), renames };
}

function renamePaints(nodes: VisualNode[], renames: Map<string, string>): VisualNode[] {
  if (!renames.size) return nodes;
  let json = JSON.stringify(nodes);
  for (const [from, to] of renames) json = json.split(`url(#${from})`).join(`url(#${to})`);
  return JSON.parse(json) as VisualNode[];
}

const describeSkipped = (skipped: Record<string, number>) =>
  Object.entries(skipped)
    .map(([tag, n]) => `${n} ${tag}`)
    .join(", ");

export function useSvgImport(definition: VisualDefinition, dispatch: React.Dispatch<EditorAction>, report: (tone: "error" | "success", text: string) => void) {
  return useCallback(
    (text: string, label: string) => {
      try {
        const taken = allIds(definition.nodes);
        const result = importSvg(text, taken);
        if (!result.nodes.length) return report("error", "Nothing in that SVG could be brought in");
        const { paints, renames } = mergePaints(definition.paints ?? [], result.paints);
        const group: VisualNode = { id: nextId(taken, "group"), kind: "group", name: label.slice(0, 120), attrs: {}, children: renamePaints(result.nodes, renames) };
        const change = `import-${group.id}`;
        const empty = definition.nodes.length === 0;
        dispatch({
          type: "canvas",
          patch: {
            ...(paints.length ? { paints } : {}),
            ...(empty && result.width && result.height ? { width: Math.min(6000, Math.max(20, Math.round(result.width))), height: Math.min(4000, Math.max(20, Math.round(result.height))) } : {}),
          },
          group: change,
        });
        dispatch({ type: "add", nodes: [group], group: change });
        const skipped = describeSkipped(result.skipped);
        report("success", `Brought in ${result.count} shapes${skipped ? `; left out what this editor can't show (${skipped})` : ""}`);
      } catch (err) {
        report("error", (err as Error).message);
      }
    },
    [definition, dispatch, report],
  );
}
