/**
 * Changing a drawing's node tree without mutating it: find, update, insert, remove, reorder,
 * group and ungroup. `parentId` null means the top level.
 */
import { walkVisualNodes, type VisualAttrValue, type VisualNode } from "@config-platform/schema";

/** A change to one node; `attrs` merge into the node's attributes (undefined removes one) */
export type NodePatch = Partial<Omit<VisualNode, "id" | "attrs">> & { attrs?: Record<string, VisualAttrValue | undefined> };

export type OrderMove = "forward" | "backward" | "front" | "back";

export function findNode(nodes: readonly VisualNode[], id: string): VisualNode | undefined {
  for (const n of walkVisualNodes(nodes)) if (n.id === id) return n;
  return undefined;
}

/** Ids from the top level down to the node (inclusive); empty when it isn't there */
export function pathTo(nodes: readonly VisualNode[], id: string): string[] {
  for (const n of nodes) {
    if (n.id === id) return [n.id];
    const below = n.children ? pathTo(n.children, id) : [];
    if (below.length) return [n.id, ...below];
  }
  return [];
}

export function parentIdOf(nodes: readonly VisualNode[], id: string): string | null {
  const path = pathTo(nodes, id);
  return path.length > 1 ? path[path.length - 2] : null;
}

export function childrenOf(nodes: readonly VisualNode[], parentId: string | null): readonly VisualNode[] {
  return parentId === null ? nodes : (findNode(nodes, parentId)?.children ?? []);
}

function applyPatch(node: VisualNode, patch: NodePatch): VisualNode {
  const { attrs, ...rest } = patch;
  const next: VisualNode = { ...node, ...rest } as VisualNode;
  if (attrs) {
    const merged: Record<string, VisualAttrValue> = { ...node.attrs };
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    next.attrs = merged;
  }
  // Drop emptied optional fields so saved drawings stay small
  for (const key of ["bindings", "rules", "effects", "name", "smooth", "locked", "hidden"] as const) {
    const v = next[key];
    if (v === undefined || v === false || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && v !== null && !Array.isArray(v) && !Object.keys(v).length)) delete next[key];
  }
  return next;
}

/** Applies changes to any nodes in the tree, keeping untouched branches as they were */
export function updateNodes(nodes: readonly VisualNode[], changes: ReadonlyMap<string, NodePatch>): VisualNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    let next = n;
    const patch = changes.get(n.id);
    if (patch) next = applyPatch(n, patch);
    if (n.children) {
      const kids = updateNodes(n.children, changes);
      if (kids !== n.children) next = { ...next, children: kids };
    }
    if (next !== n) changed = true;
    return next;
  });
  return changed ? out : (nodes as VisualNode[]);
}

export function removeNodes(nodes: readonly VisualNode[], ids: ReadonlySet<string>): VisualNode[] {
  return nodes.filter((n) => !ids.has(n.id)).map((n) => (n.children ? { ...n, children: removeNodes(n.children, ids) } : n));
}

/** Puts nodes into a parent (or the top level) at an index; the end when index is undefined */
export function insertNodes(nodes: readonly VisualNode[], parentId: string | null, index: number | undefined, added: readonly VisualNode[]): VisualNode[] {
  const into = (list: readonly VisualNode[]) => {
    const at = index === undefined ? list.length : Math.max(0, Math.min(list.length, index));
    return [...list.slice(0, at), ...added, ...list.slice(at)];
  };
  if (parentId === null) return into(nodes);
  return nodes.map((n) => (n.id === parentId ? { ...n, children: into(n.children ?? []) } : n.children ? { ...n, children: insertNodes(n.children, parentId, index, added) } : n));
}

function mapSiblings(nodes: readonly VisualNode[], parentId: string | null, fn: (list: VisualNode[]) => VisualNode[]): VisualNode[] {
  if (parentId === null) return fn([...nodes]);
  return nodes.map((n) => (n.id === parentId ? { ...n, children: fn([...(n.children ?? [])]) } : n.children ? { ...n, children: mapSiblings(n.children, parentId, fn) } : n));
}

/** Moves nodes (siblings of the first one) up or down the drawing order */
export function reorderNodes(nodes: readonly VisualNode[], ids: readonly string[], move: OrderMove): VisualNode[] {
  if (!ids.length) return nodes as VisualNode[];
  const parentId = parentIdOf(nodes, ids[0]);
  const chosen = new Set(ids);
  return mapSiblings(nodes, parentId, (list) => {
    const picked = list.filter((n) => chosen.has(n.id));
    const rest = list.filter((n) => !chosen.has(n.id));
    if (move === "front") return [...rest, ...picked];
    if (move === "back") return [...picked, ...rest];
    // One step: past the next (or previous) sibling that isn't moving
    const out = [...list];
    const order = move === "forward" ? [...out.keys()].reverse() : [...out.keys()];
    for (const i of order) {
      if (!chosen.has(out[i].id)) continue;
      const j = move === "forward" ? i + 1 : i - 1;
      if (j < 0 || j >= out.length || chosen.has(out[j].id)) continue;
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  });
}

/** Wraps sibling nodes in a new group, where the topmost of them was */
export function groupNodes(nodes: readonly VisualNode[], ids: readonly string[], groupId: string): VisualNode[] {
  if (!ids.length) return nodes as VisualNode[];
  const parentId = parentIdOf(nodes, ids[0]);
  const chosen = new Set(ids);
  return mapSiblings(nodes, parentId, (list) => {
    const picked = list.filter((n) => chosen.has(n.id));
    if (!picked.length) return list;
    const last = Math.max(...picked.map((n) => list.indexOf(n)));
    const group: VisualNode = { id: groupId, kind: "group", name: "Group", attrs: {}, children: picked };
    const out: VisualNode[] = [];
    list.forEach((n, i) => {
      if (!chosen.has(n.id)) out.push(n);
      if (i === last) out.push(group);
    });
    return out;
  });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Replaces a group with its children, keeping where they appear (its position moves into them) */
export function ungroupNode(nodes: readonly VisualNode[], id: string): VisualNode[] {
  const group = findNode(nodes, id);
  if (!group || group.kind !== "group") return nodes as VisualNode[];
  const dx = num(group.attrs.x);
  const dy = num(group.attrs.y);
  const kids = (group.children ?? []).map((c) => (dx || dy ? { ...c, attrs: { ...c.attrs, x: num(c.attrs.x) + dx, y: num(c.attrs.y) + dy } } : c));
  return mapSiblings(nodes, parentIdOf(nodes, id), (list) => list.flatMap((n) => (n.id === id ? kids : [n])));
}

/** A new id like "rect3" not used anywhere in the drawing */
export function nextId(taken: ReadonlySet<string>, base: string): string {
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export function allIds(nodes: readonly VisualNode[]): Set<string> {
  return new Set([...walkVisualNodes(nodes)].map((n) => n.id));
}

/** Copies of nodes (and everything inside them) with fresh ids */
export function withNewIds(nodes: readonly VisualNode[], taken: Set<string>): VisualNode[] {
  return nodes.map((n) => {
    const id = nextId(taken, n.kind === "preset" ? (n.ref ?? "part") : n.kind);
    taken.add(id);
    return { ...n, id, ...(n.children ? { children: withNewIds(n.children, taken) } : {}) };
  });
}
