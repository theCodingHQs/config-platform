/**
 * Moving layers by dragging them in the layers list: above or below another layer (drawn just in
 * front of or just behind it, in its group), or into a group (on top of what's in it).
 * The list shows the top of the drawing first, so "above" in the list means later in the array.
 */
import type { VisualNode } from "@config-platform/schema";
import { childrenOf, findNode, insertNodes, parentIdOf, pathTo, removeNodes, updateNodes, type NodePatch } from "./node-tree";

export type DropPlace = "above" | "below" | "inside";

export interface LayerDrop {
  /** The layer dropped on */
  targetId: string;
  place: DropPlace;
}

/** Where the moved layers end up: their new parent (null = top level) */
export function dropParent(nodes: readonly VisualNode[], drop: LayerDrop): string | null {
  return drop.place === "inside" ? drop.targetId : parentIdOf(nodes, drop.targetId);
}

/** Whether these layers can go there: not into themselves, only into groups, nothing locked */
export function canDrop(nodes: readonly VisualNode[], ids: readonly string[], drop: LayerDrop): boolean {
  if (!ids.length || ids.includes(drop.targetId)) return false;
  const target = findNode(nodes, drop.targetId);
  if (!target) return false;
  if (drop.place === "inside" && target.kind !== "group") return false;
  // Not into (or next to something inside) one of the layers being moved
  const targetPath = pathTo(nodes, drop.targetId);
  if (ids.some((id) => targetPath.includes(id))) return false;
  return ids.every((id) => {
    const n = findNode(nodes, id);
    return Boolean(n) && !n!.locked;
  });
}

/**
 * The tree with the layers moved. They keep their order among themselves; `positions` gives the
 * new x/y of any that changed group, so they stay where they appear on screen.
 */
export function moveLayers(nodes: readonly VisualNode[], ids: readonly string[], drop: LayerDrop, positions: ReadonlyMap<string, { x: number; y: number }> = new Map()): VisualNode[] {
  if (!canDrop(nodes, ids, drop)) return nodes as VisualNode[];
  const chosen = new Set(ids);
  // In drawing order, and only the outermost when a group and something inside it are both chosen
  const moving: VisualNode[] = [];
  const collect = (list: readonly VisualNode[]) => {
    for (const n of list) {
      if (chosen.has(n.id)) moving.push(n);
      else if (n.children) collect(n.children);
    }
  };
  collect(nodes);
  const rest = removeNodes(nodes, new Set(moving.map((n) => n.id)));
  const parentId = dropParent(rest, drop);
  let index: number | undefined;
  if (drop.place !== "inside") {
    const at = childrenOf(rest, parentId).findIndex((n) => n.id === drop.targetId);
    index = drop.place === "above" ? at + 1 : at;
  }
  const moved = insertNodes(rest, parentId, index, moving);
  const changes = new Map<string, NodePatch>();
  for (const [id, p] of positions) if (chosen.has(id)) changes.set(id, { attrs: { x: p.x, y: p.y } });
  return changes.size ? updateNodes(moved, changes) : moved;
}
