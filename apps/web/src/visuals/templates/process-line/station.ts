/**
 * One station of a process line, as a symbol: drawn once in five looks (lift, shelf, chamber,
 * two-zone, spray), with lamps and arrows underneath. Every copy gets its own inputs, so ten
 * stations are ten copies wired to their own tags.
 */
import { emptyVisualDefinition, type VisualDefinition, type VisualInputDef, type VisualNode } from "@config-platform/schema";
import { group, shape, shownWhen, text, tray } from "../build";

export const STATION_LOOKS = ["lift", "shelf", "chamber", "two-zone", "spray"] as const;

const INPUTS: VisualInputDef[] = [
  { name: "name", label: "Name", type: "text", default: "Station" },
  { name: "look", label: "Look: lift, shelf, chamber, two-zone or spray", type: "text", default: "shelf" },
  { name: "code", label: "Number shown", type: "text", default: "1" },
  { name: "status", label: "Status: running, idle, alarm or off", type: "text", default: "off" },
  { name: "level", label: "Level (0–100)", type: "number", default: 0 },
  { name: "present", label: "Item present", type: "boolean", default: false },
  { name: "enabled", label: "Enabled", type: "boolean", default: true },
  { name: "auto", label: "Automatic", type: "boolean", default: true },
  { name: "canLoad", label: "Can be loaded", type: "boolean", default: false },
  { name: "canUnload", label: "Can be unloaded", type: "boolean", default: false },
  { name: "request", label: "Requesting the carrier", type: "boolean", default: false },
  { name: "ready", label: "Ready", type: "boolean", default: false },
  { name: "carrierHere", label: "Carrier at the station", type: "boolean", default: false },
  { name: "raised", label: "Raised", type: "boolean", default: false },
];

const look = (...names: string[]) => names.map((n) => `inputs.look == "${n}"`).join(" || ");
const OFF = "var(--vis-off)";
const ON = "var(--vis-on)";
const OUTLINE = { stroke: "var(--vis-dark)", strokeWidth: 0.8 };

/** Markers down both sides that turn orange once the level is high */
function markers(id: string, ys: number[], r: number): VisualNode {
  const dots = ys.flatMap((y, i) => [shape("ellipse", `${id}-l${i}`, { x: 31, y, rx: r, ry: r }), shape("ellipse", `${id}-r${i}`, { x: 109, y, rx: r, ry: r })]);
  return group(id, dots, { fill: "var(--vis-steel)", ...OUTLINE }, { name: "Side markers", rules: [{ when: "inputs.level > 60", set: { fill: "var(--vis-orange)" } }] });
}

/** An enclosed chamber: lining, inside, then a glow that follows the level */
function chamber(id: string, height: number): VisualNode[] {
  return [
    shape("rect", `${id}-lining`, { x: 20, y: 58, width: 100, height: height + 6, rx: 3, fill: "url(#lining)", stroke: "color-mix(in srgb, var(--vis-orange) 25%, var(--vis-steel))" }),
    shape("rect", `${id}-inside`, { x: 23, y: 61, width: 94, height, rx: 2, fill: "color-mix(in srgb, var(--vis-steel) 22%, var(--vis-white))" }),
    shape("rect", `${id}-glow`, { x: 23, y: 61, width: 94, height, rx: 2, fill: "url(#glow)", opacity: 0 }, { name: "Level glow", bindings: { opacity: "clamp(inputs.level / 100, 0, 1)" }, smooth: 800 }),
  ];
}

const bottomBar = (id: string) => shape("rect", id, { x: 29, y: 213, width: 82, height: 9, rx: 2, fill: "url(#bar)", stroke: "color-mix(in srgb, var(--vis-blue) 50%, var(--vis-shade))" }, { name: "Transfer bar" });

const ARROW_DOWN = "M8 13.5 2.5 7H6V2.5h4V7h3.5Z";
const ARROW_UP = "M8 2.5 13.5 9H10v4.5H6V9H2.5Z";

function indicators(): VisualNode {
  const lit = (when: string, colour = ON) => [{ when, set: { fill: colour } }];
  return group(
    "indicators",
    [
      shape("ellipse", "enabled", { x: 36, y: 233, rx: 6, ry: 6, fill: "var(--vis-white)", ...OUTLINE }, { name: "Enabled", rules: lit("inputs.enabled") }),
      shape("rect", "auto", { x: 49, y: 227, width: 11, height: 11, rx: 1.5, fill: "none", stroke: OFF, strokeWidth: 2.6 }, { name: "Automatic", rules: [{ when: "inputs.auto", set: { stroke: ON } }] }),
      shape("path", "can-load", { x: 64, y: 226, scaleX: 0.75, scaleY: 0.75, pivot: "anchor", d: ARROW_DOWN, fill: OFF, ...OUTLINE }, { name: "Can be loaded", rules: lit("inputs.canLoad", "var(--vis-liquid)") }),
      shape("path", "can-unload", { x: 74, y: 226, scaleX: 0.75, scaleY: 0.75, pivot: "anchor", d: ARROW_UP, fill: OFF, ...OUTLINE }, { name: "Can be unloaded", rules: lit("inputs.canUnload", "var(--vis-liquid)") }),
      group(
        "request",
        [
          shape("rect", "request-box", { width: 24, height: 16, rx: 2, fill: OFF, ...OUTLINE }, { rules: [{ when: "inputs.request", set: { fill: "var(--vis-idle)" }, effect: "pulse" }] }),
          text("request-code", 12, 12, "1", 10, { fontWeight: "700", fontFamily: "monospace", textAnchor: "middle", fill: "var(--vis-label)" }, { bindings: { text: "inputs.code" } }),
        ],
        { x: 89, y: 225 },
        { name: "Request" },
      ),
      shape("ellipse", "ready", { x: 36, y: 255, rx: 6, ry: 6, fill: OFF, ...OUTLINE }, { name: "Ready", rules: lit("inputs.ready") }),
      shape("polygon", "carrier-here", { x: 58, y: 249, points: "6,0 12,11 0,11", fill: OFF, ...OUTLINE }, { name: "Carrier at the station", rules: lit("inputs.carrierHere", "var(--vis-blue)") }),
    ],
    {},
    { name: "Signals" },
  );
}

function looks(): VisualNode[] {
  const lift = group(
    "lift",
    [
      group("posts", [29, 45.4, 61.8, 78.2, 94.6, 111].map((x, i) => shape("line", `post${i}`, { x1: x, y1: 61, x2: x, y2: 173 })), { stroke: "var(--vis-steel)", strokeWidth: 1.4 }, { name: "Posts" }),
      shape("rect", "platform", { x: 27, y: 179, width: 86, height: 10, rx: 2, fill: "var(--vis-yellow)", stroke: "color-mix(in srgb, var(--vis-yellow) 60%, var(--vis-shade))", strokeWidth: 1.1 }, { name: "Platform" }),
      shownWhen(tray("lift-tray", 33, 151, 74, 28), "inputs.present"),
      shape("rect", "lift-frame", { x: 25, y: 189, width: 90, height: 24, rx: 2, fill: "none", stroke: "var(--vis-steel)", strokeWidth: 1.2 }),
      text("up-label", 131, 92, "Up", 9, { fontWeight: "600", textAnchor: "middle", fill: "var(--vis-grey)" }),
      shape("polygon", "up", { x: 125, y: 97, points: "6,0 12,11 0,11", fill: OFF, ...OUTLINE }, { name: "Raised", rules: [{ when: "inputs.raised", set: { fill: ON } }] }),
    ],
    {},
    { name: "Lift look" },
  );
  const shelf = group(
    "shelf",
    [
      shape("rect", "shelf-frame", { x: 23, y: 61, width: 94, height: 152, rx: 2, fill: "none", stroke: "var(--vis-steel)", strokeWidth: 1.6 }),
      shownWhen(tray("shelf-tray", 31, 73, 78, 56), "inputs.present"),
      shape("line", "shelf-board", { x1: 23, y1: 137, x2: 117, y2: 137, stroke: "var(--vis-steel)", strokeWidth: 1.4 }),
      shape("rect", "shelf-slot", { x: 31, y: 145, width: 78, height: 56, rx: 2, fill: "none", stroke: "var(--vis-steel)", strokeDasharray: "3 3" }, { name: "Empty slot" }),
    ],
    {},
    { name: "Shelf look" },
  );
  const enclosed = group(
    "chamber",
    [...chamber("chamber", 126), markers("chamber-markers", [77, 108.3, 139.7, 171], 4.6), tray("chamber-tray", 40, 107, 60, 34), bottomBar("chamber-bar")],
    {},
    { name: "Chamber look" },
  );
  const twoZone = group(
    "two-zone",
    [
      ...chamber("upper", 70),
      markers("upper-markers", [75, 96, 117], 4.4),
      shape("rect", "zone-ready", { x: 46, y: 104, width: 9, height: 9, rx: 1.5, fill: OFF, ...OUTLINE }, { name: "Ready lamp", rules: [{ when: "inputs.ready", set: { fill: ON } }] }),
      shape("rect", "zone-gate", { x: 29, y: 131, width: 82, height: 7, rx: 1.5, fill: "url(#bar)" }),
      shape("rect", "lower", { x: 23, y: 138, width: 94, height: 57, rx: 2, fill: "color-mix(in srgb, var(--vis-liquid) 18%, var(--vis-white))" }, { name: "Lower zone" }),
      shape("rect", "lower-edge", { x: 28, y: 142, width: 84, height: 49, rx: 2, fill: "none", stroke: "color-mix(in srgb, var(--vis-yellow) 55%, var(--vis-shade))", strokeWidth: 1.2, strokeDasharray: "5 3" }),
      tray("lower-tray", 40, 152, 60, 30),
      bottomBar("two-zone-bar"),
    ],
    {},
    { name: "Two-zone look" },
  );
  const spray = group(
    "spray",
    [
      shape("rect", "spray-panel", { x: 23, y: 61, width: 94, height: 126, rx: 2, fill: "color-mix(in srgb, var(--vis-steel) 25%, var(--vis-white))", stroke: "var(--vis-steel)", strokeWidth: 1.1 }),
      group("spray-rails", [shape("line", "rail-l", { x1: 30, y1: 71, x2: 30, y2: 177 }), shape("line", "rail-r", { x1: 110, y1: 71, x2: 110, y2: 177 })], { stroke: "var(--vis-steel)", strokeWidth: 1.2 }),
      group(
        "jets",
        [50, 70, 90].map((x, i) => shape("line", `jet${i}`, { x1: x, y1: 68, x2: x, y2: 104 })),
        { stroke: "var(--vis-liquid)", strokeWidth: 2, strokeDasharray: "3 4", strokeLinecap: "round" },
        { name: "Jets", bindings: { visible: 'inputs.status == "running"' }, effects: [{ type: "flow", speed: 1.5 }] },
      ),
      tray("spray-tray", 35, 107, 70, 34),
      bottomBar("spray-bar"),
    ],
    {},
    { name: "Spray look" },
  );
  return [shownWhen(lift, look("lift")), shownWhen(shelf, look("shelf")), shownWhen(enclosed, look("chamber")), shownWhen(twoZone, look("two-zone")), shownWhen(spray, look("spray"))];
}

export function stationSymbol(): VisualDefinition {
  const nodes: VisualNode[] = [
    text("title", 70, 16, "Station", 12, { fontWeight: "700", textAnchor: "middle", fill: "var(--vis-label)" }, { name: "Name", bindings: { text: "inputs.name" } }),
    shownWhen(
      shape("ellipse", "present-lamp", { x: 70, y: 38, rx: 5, ry: 5, fill: OFF, ...OUTLINE }, { name: "Item present", rules: [{ when: "inputs.present", set: { fill: ON } }] }),
      look("lift", "shelf"),
    ),
    shownWhen(
      shape("rect", "status", { x: 57, y: 38, width: 26, height: 13, rx: 2, fill: OFF, ...OUTLINE }, {
        name: "Status",
        rules: [
          { when: 'inputs.status == "running"', set: { fill: ON } },
          { when: 'inputs.status == "idle"', set: { fill: "var(--vis-idle)" } },
          { when: 'inputs.status == "alarm"', set: { fill: "var(--vis-alarm)" }, effect: "blink" },
        ],
      }),
      look("chamber", "two-zone", "spray"),
    ),
    shape("rect", "body", { x: 14, y: 52, width: 112, height: 170, rx: 4, fill: "url(#body)", stroke: "var(--vis-steel)", strokeWidth: 1.3 }, { name: "Cabinet" }),
    ...looks(),
    indicators(),
  ];
  return {
    ...emptyVisualDefinition("flat"),
    width: 140,
    height: 272,
    gridSize: 2,
    inputs: INPUTS,
    paints: [
      { id: "body", type: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "var(--vis-white)" }, { offset: 1, color: "color-mix(in srgb, var(--vis-steel) 35%, var(--vis-white))" }] },
      { id: "lining", type: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "color-mix(in srgb, var(--vis-orange) 6%, var(--vis-white))" }, { offset: 1, color: "color-mix(in srgb, var(--vis-orange) 16%, var(--vis-white))" }] },
      { id: "glow", type: "radial", cx: 0.5, cy: 0.5, r: 0.62, stops: [{ offset: 0, color: "var(--vis-orange)", opacity: 0.85 }, { offset: 0.6, color: "var(--vis-orange)", opacity: 0.42 }, { offset: 1, color: "var(--vis-orange)", opacity: 0 }] },
      { id: "bar", type: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "color-mix(in srgb, var(--vis-blue) 75%, var(--vis-white))" }, { offset: 1, color: "color-mix(in srgb, var(--vis-blue) 70%, var(--vis-shade))" }] },
    ],
    nodes,
  };
}
