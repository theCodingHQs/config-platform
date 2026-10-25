/**
 * What a shape in the Visuals library is: its properties (which the editor shows and bindings
 * can drive), its footprint on the floor, and how it draws itself.
 */
import type React from "react";
import type { IsoFrame } from "./iso-draw";

/** Colours a shape can be given, by name; each is a --vis-<name> token (tokens.css) */
export const SWATCHES = ["steel", "blue", "green", "yellow", "orange", "red", "purple", "grey", "dark", "white"] as const;
export type Swatch = (typeof SWATCHES)[number];
export const swatchVar = (name: string) => `var(--vis-${(SWATCHES as readonly string[]).includes(name) ? name : "steel"})`;

/** Machine-style states, shared by shapes with a status light */
export const STATUSES = ["running", "idle", "stopped", "alarm", "off"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { running: "Running", idle: "Idle", stopped: "Stopped", alarm: "Alarm", off: "Off" };
export const statusVar = (s: string) =>
  ({ running: "var(--vis-on)", idle: "var(--vis-idle)", stopped: "var(--vis-alarm)", alarm: "var(--vis-alarm)", off: "var(--vis-off)" })[s as Status] ?? "var(--vis-off)";

interface PropBase {
  name: string;
  label: string;
  hint?: string;
  /** Can be set from live data (default true) */
  bindable?: boolean;
}

export type PropSpec =
  | (PropBase & { kind: "number"; default: number; min?: number; max?: number; step?: number; unit?: string })
  | (PropBase & { kind: "boolean"; default: boolean })
  | (PropBase & { kind: "text"; default: string })
  | (PropBase & { kind: "swatch"; default: Swatch })
  | (PropBase & { kind: "select"; default: string; options: ReadonlyArray<{ value: string; label: string }> });

export type ResolvedProps = Record<string, string | number | boolean>;

export interface ShapeRenderProps {
  p: ResolvedProps;
  /** Draws along the shape's own axes: a = its length, b = its width (see iso-draw) */
  g: IsoFrame;
  /** A unique id prefix for clip paths and gradients inside this element */
  uid: string;
}

export type ShapeCategory = "Conveying" | "Machines" | "Storage & flow" | "Signals & text" | "Layout";

export interface ShapeDef {
  type: string;
  label: string;
  category: ShapeCategory;
  description: string;
  props: PropSpec[];
  /** Floor size along its length (a) and width (b), and its height, in tiles; for depth order and the selection outline */
  footprint: (p: ResolvedProps) => { a: number; b: number; h: number };
  /** Text and panels face the viewer, so turning doesn't apply */
  noTurn?: boolean;
  /** Default drawing layer (floors and zones go under everything) */
  layer?: number;
  Render: React.FC<ShapeRenderProps>;
}

/** Shared property specs, so the same idea looks and behaves the same across shapes */
export const commonProps = {
  color: (def: Swatch = "steel", label = "Colour"): PropSpec => ({ name: "color", label, kind: "swatch", default: def }),
  running: (def = true): PropSpec => ({ name: "running", label: "Running", kind: "boolean", default: def, hint: "e.g. live.line1.status == \"running\"" }),
  speed: (def = 1, max = 5): PropSpec => ({ name: "speed", label: "Speed", kind: "number", default: def, min: 0, max, step: 0.1, hint: "How fast it moves while running" }),
  status: (): PropSpec => ({
    name: "status",
    label: "Status",
    kind: "select",
    default: "running",
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
    hint: "Bind to a tag holding running / idle / stopped / alarm / off",
  }),
  label: (def = ""): PropSpec => ({ name: "label", label: "Label", kind: "text", default: def }),
};
