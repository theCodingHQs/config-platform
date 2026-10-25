/** The transfer wagon, as a symbol: FREE/BUSY badge, a moving lamp, and a lift column that rises with its input */
import { emptyVisualDefinition, type VisualDefinition } from "@config-platform/schema";
import { group, shape, text } from "../build";

const OUTLINE = { stroke: "var(--vis-dark)", strokeWidth: 0.8 };

export function wagonSymbol(): VisualDefinition {
  return {
    ...emptyVisualDefinition("flat"),
    width: 116,
    height: 230,
    gridSize: 2,
    inputs: [
      { name: "busy", label: "Carrying a load", type: "boolean", default: false },
      { name: "moving", label: "Moving", type: "boolean", default: false },
      { name: "lift", label: "Lift height (0–100)", type: "number", default: 0 },
    ],
    paints: [
      { id: "yellow", type: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "color-mix(in srgb, var(--vis-yellow) 80%, var(--vis-white))" }, { offset: 1, color: "color-mix(in srgb, var(--vis-yellow) 80%, var(--vis-shade))" }] },
      { id: "deck", type: "linear", x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: "color-mix(in srgb, var(--vis-steel) 55%, var(--vis-white))" }, { offset: 0.45, color: "var(--vis-white)" }, { offset: 1, color: "color-mix(in srgb, var(--vis-steel) 75%, var(--vis-white))" }] },
    ],
    nodes: [
      shape(
        "rect",
        "column",
        { x: 52, y: 0, width: 12, height: 216, rx: 2, fill: "var(--vis-steel)", ...OUTLINE, pivot: "bottom", scaleY: 0.04 },
        { name: "Lift column", bindings: { scaleY: "max(0.04, inputs.lift / 100)" }, smooth: 600 },
      ),
      shape("rect", "chassis", { x: 6, y: 156, width: 104, height: 60, rx: 6, fill: "url(#yellow)", stroke: "color-mix(in srgb, var(--vis-yellow) 60%, var(--vis-shade))", strokeWidth: 1.4 }, { name: "Chassis" }),
      shape("rect", "deck", { x: 18, y: 164, width: 80, height: 44, rx: 3, fill: "url(#deck)", stroke: "var(--vis-steel)" }, { name: "Deck" }),
      group(
        "badge",
        [
          shape("rect", "badge-box", { width: 30, height: 12, rx: 2, fill: "var(--vis-on)", ...OUTLINE, strokeWidth: 0.5 }, { rules: [{ when: "inputs.busy", set: { fill: "var(--vis-idle)" } }] }),
          text("badge-text", 15, 9, "FREE", 8, { fontWeight: "700", textAnchor: "middle", fill: "var(--vis-dark)" }, { bindings: { text: 'inputs.busy ? "BUSY" : "FREE"' } }),
        ],
        { x: 8, y: 146 },
        { name: "Free / busy" },
      ),
      shape("ellipse", "moving", { x: 100, y: 151, rx: 5, ry: 5, fill: "var(--vis-off)", ...OUTLINE }, { name: "Moving", rules: [{ when: "inputs.moving", set: { fill: "var(--vis-on)" }, effect: "pulse" }] }),
      group(
        "wheels",
        [24, 46, 70, 92].map((x, i) => shape("ellipse", `wheel${i}`, { x, y: 220, rx: 5, ry: 5 })),
        { fill: "var(--vis-dark)", stroke: "var(--vis-shade)", strokeWidth: 1 },
        { name: "Wheels" },
      ),
    ],
  };
}
