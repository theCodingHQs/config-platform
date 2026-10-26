/**
 * Parts for a process overview drawn the way modern control-room screens are: calm greys for
 * equipment, colour only where something is happening (liquid in tanks and pipes, a running pump)
 * or wrong (an alarm). Every part takes the live expressions it shows.
 */
import type { VisualNode } from '@config-platform/schema';
import { group, shape, text } from './shapes.js';

export const P = (path: string) => `live.process.${path}`;

/** Equipment faces: white in light mode, dark in dark mode */
export const FACE = 'var(--vis-label-bg)';
export const INK = 'var(--vis-label)';

export const LIQUID = 'var(--vis-liquid)';
export const WATER = 'color-mix(in srgb, var(--vis-liquid) 45%, var(--vis-light))';
export const REJECT = 'var(--vis-orange)';
export const ADDITIVE = 'var(--vis-green)';
const PIPE = 'color-mix(in srgb, var(--vis-steel) 55%, var(--vis-light))';
const OUTLINE = 'color-mix(in srgb, var(--vis-steel) 75%, var(--vis-dark))';
const TAG_TEXT = 'var(--vis-label)';
const MUTED = 'var(--vis-grey)';

const isRunning = (status: string) => `${status} == "running"`;
const isAlarm = (status: string) => `${status} == "alarm"`;

/** "57.2 %" from a live value, or — before it arrives */
export const reading = (expr: string, unit: string, decimals = 1) => `${expr} == null ? "—" : concat(round(${expr}, ${decimals}), " ${unit}")`;

/** A pipe along `points` (in the direction of flow); liquid moves along it while `flowing` */
export function pipe(id: string, points: string, flowing: string, colour = LIQUID, width = 7): VisualNode {
  return group(id, [
    shape('polyline', `${id}-wall`, { points, fill: 'none', stroke: PIPE, strokeWidth: width + 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    shape('polyline', `${id}-flow`, { points, fill: 'none', stroke: colour, strokeWidth: width - 3, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: '10 8', opacity: 0.25 }, {
      name: 'Flow',
      rules: [{ when: flowing, set: { opacity: 1 } }],
      effects: [{ type: 'flow', when: flowing, speed: 1.2 }],
    }),
  ], {}, { name: `Pipe ${id}` });
}

/** A small value box: "418 L/min" */
export function readout(id: string, x: number, y: number, expr: string, unit: string, opts: { w?: number; decimals?: number; label?: string; alarmWhen?: string } = {}): VisualNode {
  const w = opts.w ?? 74;
  return group(id, [
    shape('rect', `${id}-box`, { width: w, height: 20, rx: 5, fill: 'var(--vis-label-bg)', stroke: 'color-mix(in srgb, var(--vis-steel) 40%, transparent)', strokeWidth: 1 }, {
      rules: opts.alarmWhen ? [{ when: opts.alarmWhen, set: { stroke: 'var(--vis-alarm)', strokeWidth: 2 }, effect: 'blink' }] : [],
    }),
    text(`${id}-v`, w / 2, 14, '—', 11, { textAnchor: 'middle', fontWeight: '700', fill: TAG_TEXT, fontFamily: 'monospace' }, { bindings: { text: reading(expr, unit, opts.decimals ?? 1) } }),
    ...(opts.label ? [text(`${id}-l`, w / 2, -4, opts.label, 8.5, { textAnchor: 'middle', fontWeight: '600', fill: MUTED })] : []),
  ], { x, y }, { name: opts.label ?? id });
}

/** A vertical tank whose liquid rises and falls with `level` (0–100) */
export function tank(id: string, x: number, y: number, w: number, h: number, base: string, tagName: string, title: string, opts: { liquid?: string; low?: number; high?: number; labelsBelow?: boolean } = {}): VisualNode {
  const level = P(`${base}.level`);
  const inner = h - 8;
  const alarm = `${level} < ${opts.low ?? 12} || ${level} > ${opts.high ?? 92}`;
  return group(id, [
    text(`${id}-tag`, 0, opts.labelsBelow ? h + 16 : -22, tagName, 12, { fontWeight: '800', fill: TAG_TEXT }),
    text(`${id}-title`, 0, opts.labelsBelow ? h + 29 : -9, title, 9.5, { fill: MUTED }),
    shape('rect', `${id}-shell`, { width: w, height: h, rx: 12, fill: FACE, stroke: OUTLINE, strokeWidth: 1.5 }, {
      rules: [{ when: alarm, set: { stroke: 'var(--vis-alarm)', strokeWidth: 3 }, effect: 'blink' }],
    }),
    shape('rect', `${id}-liquid`, { x: 4, y: h - 4, width: w - 8, height: 0, rx: 8, fill: opts.liquid ?? LIQUID, opacity: 0.85 }, {
      name: 'Liquid',
      bindings: { height: `clamp(${level}, 0, 100) / 100 * ${inner}`, y: `${h - 4} - clamp(${level}, 0, 100) / 100 * ${inner}` },
      smooth: 900,
    }),
    // Scale marks at 25 / 50 / 75 %
    ...[0.25, 0.5, 0.75].map((f, i) => shape('line', `${id}-mark${i}`, { x1: w - 12, y1: h - 4 - f * inner, x2: w - 4, y2: h - 4 - f * inner, stroke: OUTLINE, strokeWidth: 1, opacity: 0.6 })),
    text(`${id}-level`, w / 2, h / 2 + 6, '—', 17, { textAnchor: 'middle', fontWeight: '800', fill: TAG_TEXT }, { name: 'Level', bindings: { text: `${level} == null ? "—" : concat(round(${level}), "%")` } }),
  ], { x, y }, { name: `${tagName} ${title}` });
}

/** A pump: green while running, red and blinking when tripped, grey when stopped */
export function pump(id: string, cx: number, cy: number, status: string, tagName: string, labelSide: 'left' | 'right' | 'below' = 'below'): VisualNode {
  const label = labelSide === 'below' ? { x: 0, y: 30, textAnchor: 'middle' } : labelSide === 'left' ? { x: -20, y: 4, textAnchor: 'end' } : { x: 20, y: 4, textAnchor: 'start' };
  return group(id, [
    shape('ellipse', `${id}-body`, { x: 0, y: 0, rx: 14, ry: 14, fill: 'var(--vis-grey)', stroke: 'var(--vis-white)', strokeWidth: 2, shadow: true }, {
      rules: [
        { when: isRunning(status), set: { fill: 'var(--vis-on)' } },
        { when: isAlarm(status), set: { fill: 'var(--vis-alarm)' }, effect: 'blink' },
      ],
    }),
    shape('polygon', `${id}-arrow`, { points: '-5,-7 8,0 -5,7', fill: 'var(--vis-white)' }),
    text(`${id}-tag`, label.x, label.y, tagName, 9.5, { fontWeight: '700', fill: TAG_TEXT, textAnchor: label.textAnchor }),
  ], { x: cx, y: cy }, { name: `Pump ${tagName}` });
}

/** A conditioner: motor, body and a load bar; trips show red */
export function conditioner(id: string, x: number, y: number, base: string, tagName: string): VisualNode {
  const status = P(`${base}.status`);
  const load = P(`${base}.load`);
  return group(id, [
    shape('rect', `${id}-body`, { width: 130, height: 62, rx: 10, fill: FACE, stroke: OUTLINE, strokeWidth: 1.5 }, {
      rules: [{ when: isAlarm(status), set: { stroke: 'var(--vis-alarm)', strokeWidth: 3 }, effect: 'blink' }],
    }),
    group(`${id}-motor`, [
      shape('ellipse', `${id}-rotor`, { x: 24, y: 31, rx: 15, ry: 15, fill: 'var(--vis-grey)' }, {
        rules: [{ when: isRunning(status), set: { fill: 'var(--vis-on)' } }, { when: isAlarm(status), set: { fill: 'var(--vis-alarm)' } }],
      }),
      ...[0, 60, 120].map((deg, i) => shape('rect', `${id}-vane${i}`, { x: 22.5, y: 19, width: 3, height: 24, rx: 1.5, fill: 'var(--vis-white)', rotate: deg, pivot: 'center' })),
    ], {}, { name: 'Rotor', effects: [{ type: 'spin', when: isRunning(status), speed: 2 }] }),
    text(`${id}-tag`, 48, 18, tagName, 11, { fontWeight: '800', fill: TAG_TEXT }),
    text(`${id}-power`, 122, 18, '—', 10, { textAnchor: 'end', fontWeight: '700', fill: TAG_TEXT, fontFamily: 'monospace' }, { bindings: { text: reading(P(`${base}.power`), 'kW', 0) } }),
    text(`${id}-state`, 48, 33, '—', 8.5, { fontWeight: '700', fill: MUTED }, {
      bindings: { text: `${status} == "alarm" ? "TRIPPED" : ${status} == null ? "NO DATA" : upper(${status})` },
      rules: [{ when: isRunning(status), set: { fill: 'var(--vis-on)' } }, { when: isAlarm(status), set: { fill: 'var(--vis-alarm)' } }],
    }),
    shape('rect', `${id}-track`, { x: 48, y: 42, width: 74, height: 6, rx: 3, fill: 'color-mix(in srgb, var(--vis-steel) 25%, transparent)' }),
    shape('rect', `${id}-load`, { x: 48, y: 42, width: 0, height: 6, rx: 3, fill: 'var(--vis-blue)' }, {
      name: 'Load',
      bindings: { width: `clamp(${load}, 0, 100) / 100 * 74` },
      rules: [{ when: `${load} > 85`, set: { fill: 'var(--vis-orange)' } }],
      smooth: 600,
    }),
    text(`${id}-loadv`, 122, 57, '—', 8, { textAnchor: 'end', fill: MUTED }, { bindings: { text: `concat("load ", round(${load}), "%")` } }),
  ], { x, y }, { name: `Conditioner ${tagName}` });
}

/** A pressure screen: an upright vessel with inlet/outlet pressure and the drop across it */
export function screenVessel(id: string, x: number, y: number, base: string, tagName: string): VisualNode {
  const inlet = P(`${base}.inlet`);
  const outlet = P(`${base}.outlet`);
  return group(id, [
    text(`${id}-tag`, -6, 20, tagName, 12, { textAnchor: 'end', fontWeight: '800', fill: TAG_TEXT }),
    shape('rect', `${id}-body`, { width: 46, height: 110, rx: 23, fill: FACE, stroke: OUTLINE, strokeWidth: 1.5 }),
    shape('rect', `${id}-basket`, { x: 9, y: 18, width: 28, height: 74, rx: 6, fill: 'none', stroke: LIQUID, strokeWidth: 1.5, strokeDasharray: '2 3' }),
    text(`${id}-dp`, 23, 60, '—', 10, { textAnchor: 'middle', fontWeight: '800', fill: TAG_TEXT }, { name: 'Pressure drop', bindings: { text: `concat("Δ", round(${inlet} - ${outlet}))` } }),
    text(`${id}-dpu`, 23, 72, 'kPa', 7.5, { textAnchor: 'middle', fill: MUTED }),
  ], { x, y }, { name: `Screen ${tagName}` });
}
