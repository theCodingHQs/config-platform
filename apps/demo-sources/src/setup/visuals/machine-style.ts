/** The look shared by the machine drawings: colours, conditions and small reusable parts */
import type { VisualNode, VisualPaint } from '@config-platform/schema';
import { group, shape } from './shapes.js';

export const RUNNING = 'inputs.status == "running"';
export const PAUSED = 'inputs.status == "idle" || inputs.status == "stopped"';
export const ALARM = 'inputs.status == "alarm"';

/** Machine shell, glass, round steel (shaded across), and the parts being made */
export const SHELL = 'url(#shell)';
export const GLASS = 'url(#glass)';
export const STEEL = 'url(#steel)';
export const DARK = 'var(--vis-dark)';
export const ACCENT = 'var(--vis-blue)';
export const ITEM = 'var(--vis-item)';
export const EDGE = { stroke: 'color-mix(in srgb, var(--vis-steel) 60%, transparent)', strokeWidth: 0.8 };

export const tint = (colour: string, pct: number) => `color-mix(in srgb, ${colour} ${pct}%, transparent)`;

export const PAINTS: VisualPaint[] = [
  { id: 'shell', type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: 'var(--vis-light)' }, { offset: 1, color: 'color-mix(in srgb, var(--vis-steel) 35%, var(--vis-light))' }] },
  { id: 'glass', type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, color: 'color-mix(in srgb, var(--vis-glass) 90%, var(--vis-light))' }, { offset: 1, color: 'color-mix(in srgb, var(--vis-glass) 70%, var(--vis-blue))' }] },
  { id: 'steel', type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: 'color-mix(in srgb, var(--vis-steel) 60%, var(--vis-light))' }, { offset: 0.5, color: 'var(--vis-steel)' }, { offset: 1, color: 'color-mix(in srgb, var(--vis-steel) 70%, var(--vis-dark))' }] },
];

/** Light catching a window: a soft triangle in its top-left corner */
export const glare = (id: string, x: number, y: number, size: number): VisualNode =>
  shape('polygon', id, { points: `${x},${y} ${x + size},${y} ${x},${y + size * 1.4}`, fill: 'var(--vis-light)', opacity: 0.35 });

/** A small operator screen: two lines of "text" and a bar that follows output against target */
export function screen(id: string, x: number, y: number, w: number, h: number): VisualNode {
  const inner = w - 6;
  return group(id, [
    shape('rect', `${id}-face`, { width: w, height: h, rx: 2.5, fill: 'var(--vis-shade)' }),
    shape('rect', `${id}-l1`, { x: 3, y: 3, width: inner, height: 2, rx: 1, fill: 'var(--vis-liquid)', opacity: 0.85 }),
    shape('rect', `${id}-l2`, { x: 3, y: 7, width: inner * 0.6, height: 2, rx: 1, fill: 'var(--vis-liquid)', opacity: 0.5 }),
    shape('rect', `${id}-bar`, { x: 3, y: h - 5, width: 0, height: 2.5, rx: 1, fill: 'var(--vis-on)' }, {
      bindings: { width: `clamp(inputs.speed / inputs.target, 0, 1) * ${inner}` },
      rules: [{ when: ALARM, set: { fill: 'var(--vis-alarm)' } }],
      smooth: 600,
    }),
  ], { x, y }, { name: 'Screen' });
}

/** A glow that shows only while running (cutting, welding, heating) */
export const workGlow = (id: string, x: number, y: number, rx: number, ry: number, colour = 'var(--vis-orange)'): VisualNode =>
  shape('ellipse', id, { x, y, rx, ry, fill: colour, opacity: 0 }, { name: 'Working glow', rules: [{ when: RUNNING, set: { opacity: 0.55 }, effect: 'pulse' }] });
