/**
 * Gradients a visual's shapes can be filled or outlined with: `fill: "url(#body)"` uses the paint
 * with id "body". Positions are fractions of the shape's box (0–1).
 */
import { z } from 'zod';

export const VisualPaintStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: z.string().max(100),
  opacity: z.number().min(0).max(1).optional(),
});

const unit = z.number().min(-2).max(3);

export const VisualPaintSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Paint ids are letters, digits, - and _').max(40),
  type: z.enum(['linear', 'radial']),
  /** linear: from (x1, y1) to (x2, y2) */
  x1: unit.optional(),
  y1: unit.optional(),
  x2: unit.optional(),
  y2: unit.optional(),
  /** radial: centre and radius */
  cx: unit.optional(),
  cy: unit.optional(),
  r: unit.optional(),
  stops: z.array(VisualPaintStopSchema).min(1).max(20),
});
export type VisualPaint = z.infer<typeof VisualPaintSchema>;
export type VisualPaintStop = z.infer<typeof VisualPaintStopSchema>;
