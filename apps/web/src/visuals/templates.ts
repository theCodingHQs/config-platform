/**
 * Starting points for a new visual. Positions are given on the floor grid (u, v in tiles) and
 * turned into canvas positions here, so templates stay easy to read and change.
 */
import { emptyVisualDefinition, isoPoint, type VisualDefinition, type VisualNode } from "@config-platform/schema";
import { shapeOf } from "./shapes";
import { defaultProps } from "./resolve-props";

export interface VisualTemplate {
  id: string;
  label: string;
  description: string;
  build: () => VisualDefinition;
}

const ORIGIN = { x: 450, y: 165 };

interface Placed {
  id: string;
  type: string;
  name: string;
  at: [number, number];
  flip?: boolean;
  props?: Record<string, string | number | boolean>;
  bindings?: Record<string, string>;
}

/** A ready-made part on the floor at tile (u, v) */
function place({ at: [u, v], id, type, name, flip, props, bindings }: Placed): VisualNode {
  const p = isoPoint(u, v);
  const shape = shapeOf(type);
  return {
    id,
    kind: "preset",
    ref: type,
    name,
    attrs: { ...(shape ? defaultProps(shape) : {}), ...props, ...(flip ? { turned: true } : {}), x: ORIGIN.x + p.x, y: ORIGIN.y + p.y },
    ...(bindings ? { bindings } : {}),
  };
}

/** Assembly line wired to the training simulator's tags (line1.speed, line1.status, line1.count) */
function assemblyLine(): VisualDefinition {
  const running = 'live.line1.status == "running"';
  const speed = "live.line1.speed / 40";
  const elements: Placed[] = [
    { id: "zone", type: "zone", name: "Line 1 cell", at: [0, 0], props: { length: 17, width: 7, color: "blue", label: "LINE 1" } },
    { id: "pipe", type: "pipe", name: "Supply pipe", at: [7.5, 3], flip: true, props: { length: 1.5, elevation: 0.5 }, bindings: { flowing: running } },
    { id: "tank", type: "tank", name: "Supply tank", at: [7, 4.5], props: { level: 70, radius: 0.8, height: 2.4 }, bindings: { level: "100 - (live.line1.count % 100)" } },
    { id: "infeed", type: "conveyor", name: "Infeed conveyor", at: [1, 1.5], props: { length: 6 }, bindings: { running, speed } },
    { id: "press", type: "machine", name: "Press", at: [7, 1], props: { width: 2, depth: 2, height: 1.6, label: "Press" }, bindings: { status: "live.line1.status" } },
    { id: "outfeed", type: "conveyor", name: "Outfeed conveyor", at: [9, 1.5], props: { length: 7 }, bindings: { running, speed } },
    { id: "robot", type: "robot-arm", name: "Packing robot", at: [12.5, 3], bindings: { running } },
    { id: "fan", type: "fan", name: "Cooling fan", at: [2.5, 4], bindings: { running } },
    { id: "tower", type: "signal-tower", name: "Andon", at: [9.6, 0.2], bindings: { green: running, red: 'live.line1.status == "stopped"', blink: 'live.line1.status == "stopped"' } },
    { id: "speed", type: "value", name: "Speed panel", at: [-1, 8], props: { title: "Speed", unit: "pcs/min", decimals: 0 }, bindings: { value: "live.line1.speed", tone: 'live.line1.speed < 35 ? "warning" : "good"' } },
    { id: "count", type: "value", name: "Output panel", at: [2.5, 11.5], props: { title: "Output today", decimals: 0 }, bindings: { value: "live.line1.count" } },
    { id: "status", type: "label", name: "Status label", at: [14, -1.5], props: { text: "Line 1" }, bindings: { text: 'concat("Line 1: ", live.line1.status)' } },
  ];
  // Later nodes draw on top: the floor zone first, then from the back of the floor to the front
  const depth = (e: Placed) => (e.type === "zone" ? -Infinity : e.at[0] + e.at[1]);
  return { ...emptyVisualDefinition("isometric"), nodes: [...elements].sort((a, b) => depth(a) - depth(b)).map(place) };
}

export const VISUAL_TEMPLATES: readonly VisualTemplate[] = [
  { id: "blank", label: "Blank (flat)", description: "An empty 2D canvas", build: () => emptyVisualDefinition("flat") },
  { id: "blank-iso", label: "Blank (isometric)", description: "An empty 2.5D floor", build: () => emptyVisualDefinition("isometric") },
  { id: "assembly-line", label: "Assembly line", description: "Conveyors, a press, a robot and a tank wired to the Line 1 tags", build: assemblyLine },
];
