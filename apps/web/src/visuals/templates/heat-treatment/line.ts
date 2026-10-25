/**
 * The heat treatment line: ten copies of the Station symbol along a rail and the Wagon symbol
 * travelling on it. Every copy is wired to its own ht.* tags; the wagon's position (in mm along
 * the 30.7 m rail) moves it and tells each station whether the wagon is there.
 */
import { emptyVisualDefinition, type VisualDefinition, type VisualNode } from "@config-platform/schema";
import { shape, symbol, text } from "../build";

export const RAIL_MM = 30700;

interface Station {
  key: string;
  name: string;
  look: "table" | "buffer" | "furnace" | "quench" | "washer";
  code: string;
}

const STATIONS: Station[] = [
  { key: "load", name: "Loading", look: "table", code: "1" },
  { key: "wait11", name: "Waiting", look: "buffer", code: "11" },
  { key: "wait12", name: "Waiting", look: "buffer", code: "12" },
  { key: "phf", name: "PHF", look: "furnace", code: "61" },
  { key: "sqf1", name: "SQF 1", look: "quench", code: "31" },
  { key: "sqf2", name: "SQF 2", look: "quench", code: "32" },
  { key: "wash", name: "Washing machine", look: "washer", code: "51" },
  { key: "tf", name: "TF", look: "furnace", code: "71" },
  { key: "wait21", name: "Waiting", look: "buffer", code: "21" },
  { key: "unload", name: "Unloading", look: "table", code: "2" },
];

const STEP = 138.7;
const WAGON = "live.ht.wagon.position";

function stationNode(s: Station, i: number, stationId: string): VisualNode {
  const tag = (signal: string) => `live.ht.${s.key}.${signal}`;
  const mm = Math.round((RAIL_MM / (STATIONS.length - 1)) * i);
  const bindings: Record<string, string> = {
    // The wagon is "here" within 400 mm of the station's place on the rail
    wagonHere: `abs(${WAGON} - ${mm}) < 400`,
    request: tag("request"),
  };
  if (s.look === "table" || s.look === "buffer") bindings.present = tag("present");
  if (s.look === "furnace" || s.look === "quench" || s.look === "washer") bindings.status = tag("status");
  if (s.look === "furnace" || s.look === "quench") bindings.heat = tag("heat");
  return symbol(
    `station-${s.key}`,
    stationId,
    { x: Math.round((6 + i * STEP) * 10) / 10, y: 0, name: s.name, look: s.look, code: s.code, canLoad: s.key !== "unload", canUnload: s.key !== "load", liftUp: s.look === "table" },
    { name: s.name, bindings },
  );
}

export function heatTreatmentLine(stationId: string, wagonId: string): VisualDefinition {
  const track = "color-mix(in srgb, var(--vis-steel) 15%, var(--vis-white))";
  return {
    ...emptyVisualDefinition("flat"),
    width: 1400,
    height: 440,
    nodes: [
      ...STATIONS.map((s, i) => stationNode(s, i, stationId)),
      shape("rect", "rail", { x: 20, y: 286, width: 1360, height: 12, rx: 2, fill: "color-mix(in srgb, var(--vis-steel) 40%, var(--vis-white))", stroke: "var(--vis-steel)", strokeWidth: 1.2 }, { name: "Rail" }),
      shape("rect", "track", { x: 20, y: 308, width: 1360, height: 108, fill: track, stroke: "var(--vis-steel)", strokeWidth: 1.4 }, { name: "Wagon track" }),
      shape("line", "centre-line", { x1: 20, y1: 362, x2: 1380, y2: 362, stroke: "var(--vis-steel)", strokeWidth: 1.6, strokeDasharray: "16 10" }, { name: "Centre line" }),
      text("rail-length", 700, 432, `${RAIL_MM} mm rail`, 9, { fontFamily: "monospace", textAnchor: "middle", fill: "var(--vis-grey)" }, { name: "Wagon position", bindings: { text: `concat("Wagon at ", round(${WAGON}), " of ${RAIL_MM} mm")` } }),
      symbol(
        "wagon",
        wagonId,
        { x: 18, y: 184 },
        {
          name: "Wagon",
          // Station centres are 138.7 apart; the wagon's centre is 58 in from its left edge
          bindings: { x: `scale(${WAGON}, 0, ${RAIL_MM}, 18, ${Math.round((18 + 9 * STEP) * 10) / 10})`, busy: "live.ht.wagon.busy", moving: "live.ht.wagon.moving", lift: "live.ht.wagon.lift" },
          smooth: 900,
        },
      ),
    ],
  };
}
