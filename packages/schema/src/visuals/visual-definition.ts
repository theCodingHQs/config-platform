/**
 * Visuals: drawings of a line or plant for dashboards, flat (2D) or isometric (2.5D). A drawing is
 * a tree of nodes (see visual-node.ts): plain SVG shapes, groups, ready-made parts (conveyor, tank…)
 * and symbols (drawings of your own, reused with different inputs). Any attribute of any node can
 * follow live data.
 */
import { z } from 'zod';
import { VisualNodeSchema, walkVisualNodes, type VisualNode } from './visual-node.js';
import { VisualPaintSchema } from './visual-paint.js';
import { screenToIso } from './isometric.js';

export const VISUAL_MODES = ['flat', 'isometric'] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const MAX_VISUAL_NODES = 5000;
export const MAX_VISUAL_DEPTH = 12;

/** A symbol's input: each placed copy gives it a value (or binds it), and the symbol's own shapes use `inputs.<name>` */
export const VisualInputDefSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Input names are letters and digits')
    .max(40)
    .refine((n) => !RESERVED_ATTRS.has(n), 'That name is used for position and size; choose another'),
  label: z.string().trim().max(80).optional(),
  type: z.enum(['number', 'text', 'boolean', 'color']),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
});
export type VisualInputDef = z.infer<typeof VisualInputDefSchema>;

/** Attribute names every node uses for placement; symbol inputs can't take them */
export const RESERVED_ATTRS = new Set(['x', 'y', 'rotate', 'scaleX', 'scaleY', 'pivot', 'opacity', 'visible', 'plane', 'shadow']);

const DefinitionObject = z
  .object({
    version: z.literal(2).default(2),
    width: z.number().int().min(20).max(6000).default(1200),
    height: z.number().int().min(20).max(4000).default(700),
    mode: z.enum(VISUAL_MODES).default('flat'),
    /** Show (and snap to) the grid while editing; isometric drawings also show the floor grid when shown */
    grid: z.boolean().default(true),
    gridSize: z.number().int().min(2).max(200).default(10),
    /** Canvas colour; none when unset */
    background: z.string().max(100).optional(),
    /** On pages: a border, and the theme's canvas colour behind a drawing with no background of its own. On unless false. */
    frame: z.boolean().optional(),
    paints: z.array(VisualPaintSchema).max(100).optional(),
    /** Only for symbols */
    inputs: z.array(VisualInputDefSchema).max(40).optional(),
    nodes: z.array(VisualNodeSchema).max(2000).default([]),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    let count = 0;
    for (const n of walkVisualNodes(def.nodes)) {
      if (ids.has(n.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Two shapes share the id "${n.id}"`, path: ['nodes'] });
      ids.add(n.id);
      count++;
    }
    if (count > MAX_VISUAL_NODES) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${MAX_VISUAL_NODES} shapes in one visual`, path: ['nodes'] });
    const depth = (nodes: VisualNode[] | undefined, d: number): number => (nodes?.length ? Math.max(...nodes.map((n) => depth(n.children, d + 1))) : d);
    if (depth(def.nodes, 0) > MAX_VISUAL_DEPTH) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Groups can be nested at most ${MAX_VISUAL_DEPTH} deep`, path: ['nodes'] });
    const paintIds = new Set<string>();
    for (const p of def.paints ?? []) {
      if (paintIds.has(p.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Two paints share the id "${p.id}"`, path: ['paints'] });
      paintIds.add(p.id);
    }
  });

/** Drawings saved before version 2 (isometric parts only) are converted when read */
export const VisualDefinitionSchema = z.preprocess(migrateVisualDefinition, DefinitionObject);
export type VisualDefinition = z.output<typeof DefinitionObject>;

interface LegacyElement {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  scale?: number;
  flip?: boolean;
  props?: Record<string, unknown>;
  bindings?: Record<string, string>;
  layer?: number;
  locked?: boolean;
}

/** Version 1 drawings → version 2: each part becomes a "preset" node, in the order it was drawn */
export function migrateVisualDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const def = raw as Record<string, unknown>;
  if (def.version === 2 || !Array.isArray(def.elements)) return raw;
  const elements = def.elements as LegacyElement[];
  // Version 1 drew by layer (floor zones under everything), then from the back of the floor to the front
  const layerOf = (e: LegacyElement) => e.layer ?? (e.type === 'zone' ? -5 : 0);
  const depthOf = (e: LegacyElement) => {
    const { u, v } = screenToIso(e.x, e.y);
    return u + v;
  };
  const ordered = [...elements].sort((a, b) => layerOf(a) - layerOf(b) || depthOf(a) - depthOf(b));
  const nodes: VisualNode[] = ordered.map((e) => ({
    id: e.id,
    kind: 'preset',
    ref: e.type,
    ...(e.name ? { name: e.name } : {}),
    attrs: {
      ...(e.props as VisualNode['attrs']),
      x: e.x,
      y: e.y,
      ...(e.scale && e.scale !== 1 ? { scaleX: e.scale, scaleY: e.scale } : {}),
      ...(e.flip ? { turned: true } : {}),
    },
    ...(e.bindings && Object.keys(e.bindings).length ? { bindings: e.bindings } : {}),
    ...(e.locked ? { locked: true } : {}),
  }));
  return {
    version: 2,
    width: def.width,
    height: def.height,
    mode: 'isometric',
    grid: def.grid !== 'none',
    gridSize: 10,
    nodes,
  };
}

/** A drawing (shown on pages) or a symbol (placed inside drawings, with inputs) */
export const VISUAL_KINDS = ['drawing', 'symbol'] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const VisualInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the visual a name').max(120),
  /** Set when it's created; a drawing stays a drawing */
  kind: z.enum(VISUAL_KINDS).default('drawing'),
  definition: VisualDefinitionSchema,
});
export type VisualInput = z.infer<typeof VisualInputSchema>;

export interface VisualSummary {
  id: string;
  name: string;
  kind: VisualKind;
  /** Shapes at the top level of the drawing */
  elementCount: number;
  version: number;
  updatedAt: string;
}

export interface Visual extends VisualSummary {
  definition: VisualDefinition;
  createdAt: string;
}

/** Ids of the symbols a drawing places (directly, not inside those symbols) */
export function symbolRefs(nodes: readonly VisualNode[]): string[] {
  const refs = new Set<string>();
  for (const n of walkVisualNodes(nodes)) if (n.kind === 'symbol' && n.ref) refs.add(n.ref);
  return [...refs];
}

export function emptyVisualDefinition(mode: VisualMode = 'flat'): VisualDefinition {
  return { version: 2, width: 1200, height: 700, mode, grid: true, gridSize: 10, nodes: [] };
}
