/**
 * One thing on a visual's canvas. Every kind keeps all of its settings in `attrs` (position, size,
 * colours, text, a ready-made part's properties, a symbol's inputs…), so anything that can be set
 * can also be driven by live data the same way:
 *   bindings  attribute ← expression          x ← scale(live.cart.position, 0, 30700, 20, 1380)
 *   rules     when a condition holds, set some attributes (and maybe animate)
 *             when live.machine1.status == "alarm" → fill = "var(--vis-alarm)", blink
 *   effects   animations that run always, or while a condition holds
 */
import { z } from 'zod';

export const VISUAL_NODE_KINDS = ['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image', 'group', 'preset', 'symbol'] as const;
export type VisualNodeKind = (typeof VISUAL_NODE_KINDS)[number];

/** Animations a node can run */
export const VISUAL_EFFECTS = ['blink', 'pulse', 'spin', 'flow', 'shake'] as const;
export type VisualEffectType = (typeof VISUAL_EFFECTS)[number];

/** An attribute's value; long strings are path data */
export const VisualAttrValueSchema = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);
export type VisualAttrValue = z.infer<typeof VisualAttrValueSchema>;

const attrName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Attribute names are letters and digits').max(60);
const expression = z.string().max(500);

export const VisualRuleSchema = z.object({
  /** Expression; the rule applies while it is true */
  when: expression,
  set: z.record(attrName, VisualAttrValueSchema).default({}),
  effect: z.enum(VISUAL_EFFECTS).optional(),
});
export type VisualRule = z.infer<typeof VisualRuleSchema>;

export const VisualEffectSchema = z.object({
  type: z.enum(VISUAL_EFFECTS),
  /** Runs while this is true; always when empty */
  when: expression.optional(),
  /** 1 = normal speed */
  speed: z.number().min(0.05).max(20).optional(),
});
export type VisualEffect = z.infer<typeof VisualEffectSchema>;

export interface VisualNode {
  id: string;
  kind: VisualNodeKind;
  name?: string;
  /** preset: the part's type ("conveyor"); symbol: the symbol's id */
  ref?: string;
  attrs: Record<string, VisualAttrValue>;
  bindings?: Record<string, string>;
  rules?: VisualRule[];
  effects?: VisualEffect[];
  /** Glide to new numeric values over this many milliseconds instead of jumping */
  smooth?: number;
  locked?: boolean;
  /** Hidden while editing (still saved) */
  hidden?: boolean;
  children?: VisualNode[];
}

export const VisualNodeSchema: z.ZodType<VisualNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    kind: z.enum(VISUAL_NODE_KINDS),
    name: z.string().trim().max(120).optional(),
    ref: z.string().max(64).optional(),
    attrs: z.record(attrName, VisualAttrValueSchema).default({}),
    bindings: z.record(attrName, expression).optional(),
    rules: z.array(VisualRuleSchema).max(20, 'At most 20 rules on one shape').optional(),
    effects: z.array(VisualEffectSchema).max(5).optional(),
    smooth: z.number().int().min(0).max(10_000).optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    children: z.array(VisualNodeSchema).max(2000).optional(),
  }),
);

/** Every node in the tree, parents before their children */
export function* walkVisualNodes(nodes: readonly VisualNode[]): Generator<VisualNode> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walkVisualNodes(n.children);
  }
}
