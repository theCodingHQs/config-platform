/** Keyboard shortcuts for the visual editor; ignored while typing in a field */
import { useEffect, useRef } from "react";
import type { OrderMove } from "./node-tree";
import { TOOLS, type ToolId } from "./tools";

export interface EditorShortcuts {
  undo: () => void;
  redo: () => void;
  save: () => void;
  duplicate: () => void;
  remove: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  group: () => void;
  ungroup: () => void;
  order: (move: OrderMove) => void;
  nudge: (dx: number, dy: number) => void;
  /** Escape: drop the selection, then leave the open group */
  escape: () => void;
  tool: (id: ToolId) => void;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Ctrl + key → action */
const WITH_CTRL: Record<string, (a: EditorShortcuts, shift: boolean) => void> = {
  z: (a, shift) => (shift ? a.redo() : a.undo()),
  y: (a) => a.redo(),
  d: (a) => a.duplicate(),
  c: (a) => a.copy(),
  x: (a) => a.cut(),
  v: (a) => a.paste(),
  a: (a) => a.selectAll(),
  g: (a, shift) => (shift ? a.ungroup() : a.group()),
  "]": (a, shift) => a.order(shift ? "front" : "forward"),
  "[": (a, shift) => a.order(shift ? "back" : "backward"),
};

export function useEditorShortcuts(actions: EditorShortcuts) {
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Save works from anywhere, even inside a field
      if (mod && key === "s") {
        e.preventDefault();
        return a.save();
      }
      if (typing(e.target)) return;
      if (mod && WITH_CTRL[key]) {
        e.preventDefault();
        return WITH_CTRL[key](a, e.shiftKey);
      }
      if (mod || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") return a.remove();
      if (e.key === "Escape") return a.escape();
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        return a.nudge(arrow[0] * step, arrow[1] * step);
      }
      const tool = TOOLS.find((t) => t.key === key);
      if (tool) a.tool(tool.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
