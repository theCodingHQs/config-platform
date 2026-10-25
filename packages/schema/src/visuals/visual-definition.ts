/**
 * Visuals: animated 2.5D (isometric) drawings of a line or plant for dashboards. A visual is a
 * canvas of elements; each element is a shape (conveyor, machine, tank…) with fixed property
 * values and, optionally, bindings that set a property from live data:
 *   running ← live.line1.status == "running"      level ← live.tank3.level
 */
import { z } from 'zod';

/** A property's fixed value */
export const VisualPropValueSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
export type VisualPropValue = z.infer<typeof VisualPropValueSchema>;

export const VisualElementSchema = z.object({
  id: z.string().min(1).max(64),
  /** Shape type from the shape library, e.g. "conveyor" */
  type: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Unknown shape').max(40),
  /** A name to find it by, e.g. "Line 1 conveyor" */
  name: z.string().trim().max(120).optional(),
  /** Where its anchor (the back corner of its footprint, on the floor) sits on the canvas */
  x: z.number().min(-10_000).max(10_000),
  y: z.number().min(-10_000).max(10_000),
  scale: z.number().min(0.25).max(4).default(1),
  /** Turned a quarter: runs along the other floor direction (down-left instead of down-right) */
  flip: z.boolean().default(false),
  props: z.record(z.string().max(60), VisualPropValueSchema).default({}),
  /** Property name → expression over live data, page state and data sources */
  bindings: z.record(z.string().max(60), z.string().max(500)).default({}),
  /** Drawing order: higher draws on top; elements on the same layer draw front-to-back by depth */
  layer: z.number().int().min(-10).max(10).optional(),
  locked: z.boolean().optional(),
});
export type VisualElement = z.infer<typeof VisualElementSchema>;

export const VISUAL_GRIDS = ['isometric', 'none'] as const;

export const VisualDefinitionSchema = z.object({
  width: z.number().int().min(200).max(4000).default(1200),
  height: z.number().int().min(150).max(3000).default(700),
  grid: z.enum(VISUAL_GRIDS).default('isometric'),
  elements: z.array(VisualElementSchema).max(500, 'At most 500 elements in one visual').default([]),
});
export type VisualDefinition = z.infer<typeof VisualDefinitionSchema>;

export const VisualInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the visual a name').max(120),
  definition: VisualDefinitionSchema,
});
export type VisualInput = z.infer<typeof VisualInputSchema>;

export interface VisualSummary {
  id: string;
  name: string;
  elementCount: number;
  version: number;
  updatedAt: string;
}

export interface Visual extends VisualSummary {
  definition: VisualDefinition;
  createdAt: string;
}

export function emptyVisualDefinition(): VisualDefinition {
  return { width: 1200, height: 700, grid: 'isometric', elements: [] };
}
