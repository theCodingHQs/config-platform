/**
 * Starting points for a new visual. A template can bring its own symbols: they're created first
 * (named after the new visual) and the drawing places them by the ids they were given.
 */
import { emptyVisualDefinition, type VisualDefinition } from "@config-platform/schema";
import { assemblyLine } from "./assembly-line";
import { carrierSymbol, processLine, stationSymbol } from "./process-line";

export interface TemplateSymbol {
  key: string;
  name: string;
  build: () => VisualDefinition;
}

export interface VisualTemplate {
  id: string;
  label: string;
  description: string;
  symbols?: readonly TemplateSymbol[];
  /** `symbolIds`: each of the template's symbols (by key) → the id it was saved under */
  build: (symbolIds: Record<string, string>) => VisualDefinition;
}

export const VISUAL_TEMPLATES: readonly VisualTemplate[] = [
  { id: "blank", label: "Blank (flat)", description: "An empty 2D canvas", build: () => emptyVisualDefinition("flat") },
  { id: "blank-iso", label: "Blank (isometric)", description: "An empty 2.5D floor", build: () => emptyVisualDefinition("isometric") },
  { id: "assembly-line", label: "Assembly line", description: "Conveyors, a press, a robot and a tank wired to the Line 1 tags", build: assemblyLine },
  {
    id: "process-line",
    label: "Process line",
    description: "Ten stations and a carrier on a track, made from two symbols and wired to line.* tags",
    symbols: [
      { key: "station", name: "Station", build: stationSymbol },
      { key: "carrier", name: "Carrier", build: carrierSymbol },
    ],
    build: (ids) => processLine(ids.station, ids.carrier),
  },
];
