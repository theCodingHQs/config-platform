/**
 * The visual editor's state: the drawing, what's selected, which group is open for editing, and
 * undo/redo. Changes that come in a stream (dragging, typing in a field) share a `group` so they
 * undo as one step.
 */
import { useCallback, useMemo, useReducer } from "react";
import type { VisualDefinition, VisualNode } from "@config-platform/schema";
import { dropParent, moveLayers, type LayerDrop } from "./layer-moves";
import { allIds, findNode, groupNodes, insertNodes, nextId, pathTo, removeNodes, reorderNodes, ungroupNode, updateNodes, type NodePatch, type OrderMove } from "./node-tree";

interface Snapshot {
  name: string;
  definition: VisualDefinition;
}

export interface EditorState extends Snapshot {
  selection: string[];
  /** The group being edited inside (double-click a group); null = the top level */
  openGroup: string | null;
  past: Snapshot[];
  future: Snapshot[];
  /** The last change's group; another change in the same group doesn't add an undo step */
  lastGroup: string | null;
  /** Changed since the last save */
  dirty: boolean;
}

type Change = { group?: string };

export type EditorAction =
  | { type: "load"; name: string; definition: VisualDefinition }
  | ({ type: "rename"; name: string } & Change)
  | ({ type: "canvas"; patch: Partial<Omit<VisualDefinition, "nodes">> } & Change)
  | ({ type: "add"; nodes: VisualNode[]; parentId?: string | null; index?: number } & Change)
  | ({ type: "update"; changes: ReadonlyArray<{ id: string; patch: NodePatch }> } & Change)
  | ({ type: "remove"; ids: string[] } & Change)
  | ({ type: "order"; ids: string[]; move: OrderMove } & Change)
  | ({ type: "group"; ids: string[] } & Change)
  | ({ type: "ungroup"; id: string } & Change)
  /** Dragged in the layers list; positions keep layers that change group where they appear */
  | ({ type: "move"; ids: string[]; drop: LayerDrop; positions?: ReadonlyMap<string, { x: number; y: number }> } & Change)
  | { type: "select"; ids: string[] }
  | { type: "open"; id: string | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved" };

const HISTORY_LIMIT = 100;

function commit(state: EditorState, next: Snapshot, group: string | undefined, selection = state.selection): EditorState {
  const merge = group !== undefined && group === state.lastGroup;
  const past = merge ? state.past : [...state.past, { name: state.name, definition: state.definition }].slice(-HISTORY_LIMIT);
  return { ...tidy({ ...state, ...next, selection }), past, future: [], lastGroup: group ?? null, dirty: true };
}

/** Keeps the selection and open group pointing at nodes that still exist */
function tidy(state: EditorState): EditorState {
  const ids = allIds(state.definition.nodes);
  const selection = state.selection.filter((id) => ids.has(id));
  const openGroup = state.openGroup && ids.has(state.openGroup) ? state.openGroup : null;
  return selection.length === state.selection.length && openGroup === state.openGroup ? state : { ...state, selection, openGroup };
}

const withNodes = (state: EditorState, nodes: VisualNode[]): Snapshot => ({ name: state.name, definition: { ...state.definition, nodes } });

function travel(state: EditorState, to: Snapshot, past: Snapshot[], future: Snapshot[]): EditorState {
  return tidy({ ...state, ...to, past, future, lastGroup: null, dirty: true });
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const nodes = state.definition?.nodes;
  switch (action.type) {
    case "load":
      return { name: action.name, definition: action.definition, selection: [], openGroup: null, past: [], future: [], lastGroup: null, dirty: false };
    case "rename":
      return commit(state, { name: action.name, definition: state.definition }, action.group);
    case "canvas":
      return commit(state, { name: state.name, definition: { ...state.definition, ...action.patch } }, action.group);
    case "add": {
      const parentId = action.parentId === undefined ? state.openGroup : action.parentId;
      return commit(state, withNodes(state, insertNodes(nodes, parentId, action.index, action.nodes)), action.group, action.nodes.map((n) => n.id));
    }
    case "update":
      return commit(state, withNodes(state, updateNodes(nodes, new Map(action.changes.map((c) => [c.id, c.patch])))), action.group);
    case "remove":
      return commit(state, withNodes(state, removeNodes(nodes, new Set(action.ids))), action.group);
    case "order":
      return commit(state, withNodes(state, reorderNodes(nodes, action.ids, action.move)), action.group);
    case "group": {
      const id = nextId(allIds(nodes), "group");
      return commit(state, withNodes(state, groupNodes(nodes, action.ids, id)), action.group, [id]);
    }
    case "ungroup": {
      const kids = findNode(nodes, action.id)?.children?.map((c) => c.id) ?? [];
      return commit(state, withNodes(state, ungroupNode(nodes, action.id)), action.group, kids);
    }
    case "move": {
      const moved = moveLayers(nodes, action.ids, action.drop, action.positions);
      if (moved === nodes) return state;
      const next = commit(state, withNodes(state, moved), action.group, action.ids);
      // The moved layers stay selected, inside the group they went to
      return { ...next, openGroup: dropParent(nodes, action.drop) };
    }
    case "select":
      return { ...state, selection: action.ids, lastGroup: null };
    case "open":
      return { ...state, openGroup: action.id, selection: [], lastGroup: null };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return travel(state, prev, state.past.slice(0, -1), [{ name: state.name, definition: state.definition }, ...state.future]);
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return travel(state, next, [...state.past, { name: state.name, definition: state.definition }], state.future.slice(1));
    }
    case "saved":
      return { ...state, dirty: false, lastGroup: null };
  }
}

export function useVisualEditor(name: string, definition: VisualDefinition) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => editorReducer({} as EditorState, { type: "load", name, definition }));
  const selected = useMemo(() => state.selection.map((id) => findNode(state.definition.nodes, id)).filter((n): n is VisualNode => Boolean(n)), [state.definition.nodes, state.selection]);
  const update = useCallback((id: string, patch: NodePatch, group?: string) => dispatch({ type: "update", changes: [{ id, patch }], group }), []);
  /** Where the open group sits, top-down, for the breadcrumb */
  const openPath = useMemo(() => (state.openGroup ? pathTo(state.definition.nodes, state.openGroup) : []), [state.definition.nodes, state.openGroup]);
  return { state, dispatch, selected, update, openPath };
}
