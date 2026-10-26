/**
 * A process line: ten copies of the Station symbol along a track and the Carrier symbol travelling
 * on it. Every copy is wired to its own line.* tags; the carrier's position (in mm along the track)
 * moves it and tells each station whether the carrier is there.
 */
import { emptyVisualDefinition, type VisualDefinition, type VisualNode } from "@config-platform/schema";
import { shape, symbol, text } from "../build";
import type { STATION_LOOKS } from "./station";

export const TRACK_MM = 30000;

/** Which look each of the ten stations has, left to right */
const LOOKS: ReadonlyArray<(typeof STATION_LOOKS)[number]> = ["lift", "shelf", "shelf", "chamber", "two-zone", "two-zone", "spray", "chamber", "shelf", "lift"];

const STEP = 138.7;
const CARRIER = "live.line.carrier.position";

function stationNode(look: (typeof LOOKS)[number], i: number, stationId: string): VisualNode {
  const n = i + 1;
  const tag = (signal: string) => `live.line.station${n}.${signal}`;
  const mm = Math.round((TRACK_MM / (LOOKS.length - 1)) * i);
  const bindings: Record<string, string> = {
    // The carrier is "here" within 400 mm of the station's place on the track
    carrierHere: `abs(${CARRIER} - ${mm}) < 400`,
    request: tag("request"),
  };
  if (look === "lift" || look === "shelf") bindings.present = tag("present");
  else bindings.status = tag("status");
  if (look === "chamber" || look === "two-zone") bindings.level = tag("level");
  return symbol(
    `station${n}`,
    stationId,
    { x: Math.round((6 + i * STEP) * 10) / 10, y: 0, name: `Station ${n}`, look, code: String(n), canLoad: n !== LOOKS.length, canUnload: n !== 1, raised: look === "lift" },
    { name: `Station ${n}`, bindings },
  );
}

export function processLine(stationId: string, carrierId: string): VisualDefinition {
  const end = Math.round((18 + (LOOKS.length - 1) * STEP) * 10) / 10;
  return {
    ...emptyVisualDefinition("flat"),
    width: 1400,
    height: 440,
    nodes: [
      ...LOOKS.map((look, i) => stationNode(look, i, stationId)),
      shape("rect", "rail", { x: 20, y: 286, width: 1360, height: 12, rx: 2, fill: "color-mix(in srgb, var(--vis-steel) 40%, var(--vis-white))", stroke: "var(--vis-steel)", strokeWidth: 1.2 }, { name: "Rail" }),
      shape("rect", "track", { x: 20, y: 308, width: 1360, height: 108, fill: "color-mix(in srgb, var(--vis-steel) 15%, var(--vis-white))", stroke: "var(--vis-steel)", strokeWidth: 1.4 }, { name: "Track" }),
      shape("line", "centre-line", { x1: 20, y1: 362, x2: 1380, y2: 362, stroke: "var(--vis-steel)", strokeWidth: 1.6, strokeDasharray: "16 10" }, { name: "Centre line" }),
      text("position", 700, 432, `${TRACK_MM} mm track`, 9, { fontFamily: "monospace", textAnchor: "middle", fill: "var(--vis-grey)" }, { name: "Carrier position", bindings: { text: `concat("Carrier at ", round(${CARRIER}), " of ${TRACK_MM} mm")` } }),
      symbol(
        "carrier",
        carrierId,
        { x: 18, y: 184 },
        {
          name: "Carrier",
          // Station centres are 138.7 apart; the carrier's centre is 58 in from its left edge
          bindings: { x: `scale(${CARRIER}, 0, ${TRACK_MM}, 18, ${end})`, loaded: "live.line.carrier.loaded", moving: "live.line.carrier.moving", lift: "live.line.carrier.lift" },
          smooth: 900,
        },
      ),
    ],
  };
}
