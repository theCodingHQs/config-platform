/**
 * Starting points for a new visual. Positions are given on the floor grid (u, v in tiles) and
 * turned into canvas positions here, so templates stay easy to read and change.
 */
import { isoPoint, type VisualDefinition, type VisualElement } from "@config-platform/schema";
import { shapeOf } from "./shapes";
import { defaultProps } from "./resolve-props";

export interface VisualTemplate {
  id: string;
  label: string;
  description: string;
  build: () => VisualDefinition;
}

const ORIGIN = { x: 450, y: 165 };

type Placed = Omit<VisualElement, "x" | "y" | "scale" | "flip" | "props" | "bindings"> &
  Partial<Pick<VisualElement, "flip" | "props" | "bindings">> & { at: [number, number] };

function place({ at: [u, v], ...el }: Placed): VisualElement {
  const p = isoPoint(u, v);
  const shape = shapeOf(el.type);
  return {
    scale: 1,
    flip: false,
    bindings: {},
    ...el,
    props: { ...(shape ? defaultProps(shape) : {}), ...el.props },
    x: ORIGIN.x + p.x,
    y: ORIGIN.y + p.y,
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
  return { width: 1200, height: 700, grid: "isometric", elements: elements.map(place) };
}

export const VISUAL_TEMPLATES: readonly VisualTemplate[] = [
  { id: "blank", label: "Blank", description: "An empty floor", build: () => ({ width: 1200, height: 700, grid: "isometric", elements: [] }) },
  { id: "assembly-line", label: "Assembly line", description: "Conveyors, a press, a robot and a tank wired to the Line 1 tags", build: assemblyLine },
];
