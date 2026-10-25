/** What the canvas gestures share: the drawing, the editor's state and how to change it */
import type React from "react";
import type { EditorAction, EditorState } from "./editor-state";

export interface CanvasCtx {
  svg: SVGSVGElement | null;
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  /** Snapping (off while Alt is held) */
  grid: { on: boolean; size: number; isometric: boolean };
  /** Drawing units per screen pixel, so handles and click distances stay the same size at any zoom */
  unit: number;
}

/** Pointer handlers a gesture hook gives the canvas, and what it draws on top while active */
export interface Gestures {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  overlay: React.ReactNode;
}
