/**
 * The attributes each kind of node has: what the inspector shows, what bindings and rules can set,
 * and the defaults. Ready-made parts add their own properties; symbols add their inputs.
 */
import type { VisualInputDef, VisualNode, VisualNodeKind } from "@config-platform/schema";
import { shapeOf, type PropSpec } from "./shapes";

export const GROUPS = { place: "Position", look: "Fill and outline", shape: "Shape", text: "Text", part: "Properties", inputs: "Inputs" } as const;

const n = (name: string, label: string, def: number, extra: Partial<Extract<PropSpec, { kind: "number" }>> = {}): PropSpec => ({ name, label, kind: "number", default: def, ...extra });
const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1).replace(/-/g, " ") }));

export const PIVOTS = ["center", "anchor", "top-left", "top", "top-right", "left", "right", "bottom-left", "bottom", "bottom-right"] as const;

/** Placement every node has */
export const PLACE_SPECS: PropSpec[] = [
  n("x", "X", 0, { group: GROUPS.place, step: 1 }),
  n("y", "Y", 0, { group: GROUPS.place, step: 1 }),
  n("rotate", "Rotate", 0, { group: GROUPS.place, min: -3600, max: 3600, step: 1, unit: "°" }),
  n("scaleX", "Scale across", 1, { group: GROUPS.place, min: -100, max: 100, step: 0.05 }),
  n("scaleY", "Scale up/down", 1, { group: GROUPS.place, min: -100, max: 100, step: 0.05 }),
  {
    name: "pivot",
    label: "Turn and scale around",
    kind: "select",
    default: "center",
    options: [{ value: "center", label: "Its centre" }, { value: "anchor", label: "Its anchor point (x, y)" }, ...opts("top-left", "top", "top-right", "left", "right", "bottom-left", "bottom", "bottom-right")],
    group: GROUPS.place,
    bindable: false,
  },
  n("opacity", "Opacity", 1, { group: GROUPS.place, min: 0, max: 1, step: 0.05 }),
  { name: "visible", label: "Visible", kind: "boolean", default: true, group: GROUPS.place, hint: "e.g. live.door.open" },
  {
    name: "plane",
    label: "Lay it on",
    kind: "select",
    default: "screen",
    options: [{ value: "screen", label: "The screen (flat)" }, { value: "floor", label: "The floor" }, { value: "left-wall", label: "A left wall" }, { value: "right-wall", label: "A right wall" }],
    group: GROUPS.place,
    isoOnly: true,
    hint: "Turns a flat shape to lie on the isometric floor or a wall",
  },
  { name: "shadow", label: "Soft shadow", kind: "boolean", default: false, group: GROUPS.place },
];

const color = (name: string, label: string, def = ""): PropSpec => ({ name, label, kind: "color", default: def, group: GROUPS.look });

/** Fill and outline (shapes and groups; a group's are used by shapes inside it that don't set their own) */
export const LOOK_SPECS: PropSpec[] = [
  color("fill", "Fill"),
  n("fillOpacity", "Fill opacity", 1, { group: GROUPS.look, min: 0, max: 1, step: 0.05 }),
  color("stroke", "Outline"),
  n("strokeWidth", "Outline width", 1, { group: GROUPS.look, min: 0, max: 200, step: 0.5 }),
  n("strokeOpacity", "Outline opacity", 1, { group: GROUPS.look, min: 0, max: 1, step: 0.05 }),
  { name: "strokeDasharray", label: "Dashes", kind: "text", default: "", group: GROUPS.look, hint: "Dash and gap lengths, e.g. 6 4 (empty = solid)" },
  { name: "strokeLinecap", label: "Line ends", kind: "select", default: "butt", options: opts("butt", "round", "square"), group: GROUPS.look },
  { name: "strokeLinejoin", label: "Corners", kind: "select", default: "miter", options: opts("miter", "round", "bevel"), group: GROUPS.look },
];

const shape = (specs: PropSpec[]) => specs.map((s) => ({ ...s, group: s.group ?? GROUPS.shape }));

const GEOMETRY: Record<Exclude<VisualNodeKind, "preset" | "symbol" | "group">, PropSpec[]> = {
  rect: shape([n("width", "Width", 80, { min: 0, max: 10_000 }), n("height", "Height", 50, { min: 0, max: 10_000 }), n("rx", "Corner radius", 0, { min: 0, max: 5000 })]),
  ellipse: shape([n("rx", "Radius across", 30, { min: 0, max: 10_000 }), n("ry", "Radius up/down", 30, { min: 0, max: 10_000 })]),
  line: shape([n("x1", "Start X", 0), n("y1", "Start Y", 0), n("x2", "End X", 80), n("y2", "End Y", 0)]),
  polyline: shape([{ name: "points", label: "Points", kind: "code", default: "0,0 40,20 80,0", hint: "x,y pairs separated by spaces" }]),
  polygon: shape([{ name: "points", label: "Points", kind: "code", default: "0,0 80,0 40,60", hint: "x,y pairs separated by spaces" }]),
  path: shape([{ name: "d", label: "Path data", kind: "code", default: "M0 0 L80 0 L40 60 Z", hint: "SVG path commands (M, L, C, A, Z…)" }]),
  text: [
    { name: "text", label: "Text", kind: "text", default: "Text", group: GROUPS.text, hint: 'e.g. concat(live.phf.count, " pcs")' },
    n("fontSize", "Size", 14, { group: GROUPS.text, min: 1, max: 1000 }),
    { name: "fontWeight", label: "Weight", kind: "select", default: "400", options: [{ value: "400", label: "Regular" }, { value: "500", label: "Medium" }, { value: "600", label: "Semibold" }, { value: "700", label: "Bold" }, { value: "800", label: "Extra bold" }], group: GROUPS.text },
    { name: "fontFamily", label: "Font", kind: "select", default: "inherit", options: [{ value: "inherit", label: "The app's font" }, { value: "monospace", label: "Monospace" }, { value: "serif", label: "Serif" }], group: GROUPS.text },
    { name: "textAnchor", label: "Align", kind: "select", default: "start", options: [{ value: "start", label: "Left of x" }, { value: "middle", label: "Centred on x" }, { value: "end", label: "Right of x" }], group: GROUPS.text },
    { name: "baseline", label: "Vertical", kind: "select", default: "auto", options: [{ value: "auto", label: "Sits on y" }, { value: "middle", label: "Centred on y" }, { value: "hanging", label: "Hangs from y" }], group: GROUPS.text },
  ],
  image: shape([
    { name: "href", label: "Picture link", kind: "text", default: "", hint: "An https:// link to a picture" },
    n("width", "Width", 120, { min: 0, max: 10_000 }),
    n("height", "Height", 80, { min: 0, max: 10_000 }),
    { name: "fit", label: "Fit", kind: "select", default: "contain", options: [{ value: "contain", label: "Fit inside" }, { value: "cover", label: "Fill and crop" }, { value: "stretch", label: "Stretch" }] },
  ]),
};

const INPUT_KIND: Record<VisualInputDef["type"], PropSpec["kind"]> = { number: "number", text: "text", boolean: "boolean", color: "color" };

/** A symbol's inputs as properties of a placed copy */
export function inputSpecs(inputs: readonly VisualInputDef[] = []): PropSpec[] {
  return inputs.map((i) => {
    const kind = INPUT_KIND[i.type];
    const fallback = kind === "number" ? 0 : kind === "boolean" ? false : "";
    return { name: i.name, label: i.label || i.name, kind, default: (i.default ?? fallback) as never, group: GROUPS.inputs } as PropSpec;
  });
}

/** Everything a node can be given */
export function specsFor(node: Pick<VisualNode, "kind" | "ref">, symbolInputs?: readonly VisualInputDef[]): PropSpec[] {
  switch (node.kind) {
    case "group":
      return [...PLACE_SPECS, ...LOOK_SPECS];
    case "preset": {
      const part = node.ref ? shapeOf(node.ref) : undefined;
      const place = PLACE_SPECS.map((s) => (s.name === "pivot" ? ({ ...s, default: "anchor" } as PropSpec) : s)).filter((s) => s.name !== "plane");
      const turn: PropSpec[] = part && !part.noTurn ? [{ name: "turned", label: "Turned a quarter", kind: "boolean", default: false, group: GROUPS.part }] : [];
      return [...place, ...(part?.props.map((p) => ({ ...p, group: GROUPS.part })) ?? []), ...turn];
    }
    case "symbol":
      return [...PLACE_SPECS, ...inputSpecs(symbolInputs)];
    case "text":
      return [...PLACE_SPECS, ...GEOMETRY.text, ...LOOK_SPECS];
    case "image":
      return [...PLACE_SPECS, ...GEOMETRY.image];
    default:
      return [...PLACE_SPECS, ...GEOMETRY[node.kind], ...LOOK_SPECS];
  }
}

/** Attributes a new node of this kind starts with (beyond placement) */
export function startingAttrs(kind: VisualNodeKind): Record<string, string | number | boolean> {
  const geometry = kind in GEOMETRY ? GEOMETRY[kind as keyof typeof GEOMETRY] : [];
  const attrs: Record<string, string | number | boolean> = Object.fromEntries(geometry.map((s) => [s.name, s.default]));
  if (kind === "text") return { ...attrs, fill: "var(--vis-label)" };
  if (kind === "line" || kind === "polyline" || kind === "path") return { ...attrs, fill: kind === "path" ? "var(--vis-white)" : "none", stroke: "var(--vis-dark)", strokeWidth: 2 };
  if (kind === "image") return attrs;
  return { ...attrs, fill: "var(--vis-white)", stroke: "var(--vis-steel)", strokeWidth: 1.5 };
}
