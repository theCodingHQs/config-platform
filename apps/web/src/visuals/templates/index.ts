/** Starting points for a new visual. Templates place built-in symbols, so creating one adds nothing else to the workspace. */
import { emptyVisualDefinition, type VisualDefinition } from "@config-platform/schema";
import { assemblyLine } from "./assembly-line";
import { processLine } from "./process-line";

export interface VisualTemplate {
  id: string;
  label: string;
  description: string;
  build: () => VisualDefinition;
}

export const VISUAL_TEMPLATES: readonly VisualTemplate[] = [
  { id: "blank", label: "Blank (flat)", description: "An empty 2D canvas", build: () => emptyVisualDefinition("flat") },
  { id: "blank-iso", label: "Blank (isometric)", description: "An empty 2.5D floor", build: () => emptyVisualDefinition("isometric") },
  { id: "assembly-line", label: "Assembly line", description: "Conveyors, a press, a robot and a tank wired to the Line 1 tags", build: assemblyLine },
  { id: "process-line", label: "Process line", description: "Ten stations and a carrier on a track, made from the built-in Station and Carrier symbols and wired to line.* tags", build: processLine },
];
