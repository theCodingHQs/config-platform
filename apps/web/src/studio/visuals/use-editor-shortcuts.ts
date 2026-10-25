/** Keyboard shortcuts for the visual editor; ignored while typing in a field */
import { useEffect, useRef } from "react";

export interface EditorShortcuts {
  undo: () => void;
  redo: () => void;
  save: () => void;
  duplicate: () => void;
  remove: () => void;
  nudge: (dx: number, dy: number) => void;
  deselect: () => void;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

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
      if (mod && key === "z") {
        e.preventDefault();
        return e.shiftKey ? a.redo() : a.undo();
      }
      if (mod && key === "y") {
        e.preventDefault();
        return a.redo();
      }
      if (mod && key === "d") {
        e.preventDefault();
        return a.duplicate();
      }
      if (e.key === "Delete" || e.key === "Backspace") return a.remove();
      if (e.key === "Escape") return a.deselect();
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        const step = e.shiftKey ? 16 : 1;
        a.nudge(arrow[0] * step, arrow[1] * step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
