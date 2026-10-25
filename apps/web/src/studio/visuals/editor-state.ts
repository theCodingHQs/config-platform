/**
 * The visual editor's state: the drawing, what's selected, and undo/redo. Changes that come in a
 * stream (dragging, typing in a field) share a `group` so they undo as one step.
 */
import { useCallback, useMemo, useReducer } from "react";
import type { VisualDefinition, VisualElement } from "@config-platform/schema";

interface Snapshot {
  name: string;
  definition: VisualDefinition;
}

export interface EditorState extends Snapshot {
  selectedId: string | null;
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
  | ({ type: "canvas"; patch: Partial<Omit<VisualDefinition, "elements">> } & Change)
  | ({ type: "add"; element: VisualElement } & Change)
  | ({ type: "update"; id: string; patch: Partial<VisualElement> } & Change)
  | ({ type: "remove"; id: string } & Change)
  | { type: "select"; id: string | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved" };

const HISTORY_LIMIT = 100;

function commit(state: EditorState, next: Snapshot, group: string | undefined, selectedId = state.selectedId): EditorState {
  const merge = group !== undefined && group === state.lastGroup;
  const past = merge ? state.past : [...state.past, { name: state.name, definition: state.definition }].slice(-HISTORY_LIMIT);
  return { ...state, ...next, selectedId, past, future: [], lastGroup: group ?? null, dirty: true };
}

const withElements = (state: EditorState, elements: VisualElement[]): Snapshot => ({ name: state.name, definition: { ...state.definition, elements } });

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return { name: action.name, definition: action.definition, selectedId: null, past: [], future: [], lastGroup: null, dirty: false };
    case "rename":
      return commit(state, { name: action.name, definition: state.definition }, action.group);
    case "canvas":
      return commit(state, { name: state.name, definition: { ...state.definition, ...action.patch } }, action.group);
    case "add":
      return commit(state, withElements(state, [...state.definition.elements, action.element]), action.group, action.element.id);
    case "update":
      return commit(
        state,
        withElements(state, state.definition.elements.map((el) => (el.id === action.id ? { ...el, ...action.patch } : el))),
        action.group,
      );
    case "remove":
      return commit(state, withElements(state, state.definition.elements.filter((el) => el.id !== action.id)), action.group, state.selectedId === action.id ? null : state.selectedId);
    case "select":
      return { ...state, selectedId: action.id, lastGroup: null };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, ...prev, past: state.past.slice(0, -1), future: [{ name: state.name, definition: state.definition }, ...state.future], lastGroup: null, dirty: true, selectedId: keepSelection(prev, state.selectedId) };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, ...next, past: [...state.past, { name: state.name, definition: state.definition }], future: state.future.slice(1), lastGroup: null, dirty: true, selectedId: keepSelection(next, state.selectedId) };
    }
    case "saved":
      return { ...state, dirty: false, lastGroup: null };
  }
}

const keepSelection = (s: Snapshot, id: string | null) => (id && s.definition.elements.some((el) => el.id === id) ? id : null);

export function newElementId(existing: VisualElement[]): string {
  const ids = new Set(existing.map((el) => el.id));
  for (let n = existing.length + 1; ; n++) if (!ids.has(`e${n}`)) return `e${n}`;
}

export function useVisualEditor(name: string, definition: VisualDefinition) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => editorReducer({} as EditorState, { type: "load", name, definition }));
  const selected = useMemo(() => state.definition.elements.find((el) => el.id === state.selectedId) ?? null, [state.definition.elements, state.selectedId]);
  const update = useCallback((id: string, patch: Partial<VisualElement>, group?: string) => dispatch({ type: "update", id, patch, group }), []);
  return { state, dispatch, selected, update };
}
