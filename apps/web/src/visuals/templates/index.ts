/**
 * Starting points for a new visual. A template can bring its own symbols: they're created first
 * (named after the new visual) and the drawing places them by the ids they were given.
 */
import { emptyVisualDefinition, type VisualDefinition } from "@config-platform/schema";
import { assemblyLine } from "./assembly-line";
import { heatTreatmentLine, stationSymbol, wagonSymbol } from "./heat-treatment";

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
    id: "heat-treatment",
    label: "Heat treatment line",
    description: "Ten stations and a wagon on a rail, made from two symbols and wired to the ht.* tags",
    symbols: [
      { key: "station", name: "Station", build: stationSymbol },
      { key: "wagon", name: "Wagon", build: wagonSymbol },
    ],
    build: (ids) => heatTreatmentLine(ids.station, ids.wagon),
  },
];
