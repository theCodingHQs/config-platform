/**
 * One machine, as a symbol: the machine itself drawn for its type (see machine-looks.ts), a stack
 * light beside it lit in its status colour, and a small dark operator display underneath with its
 * name, status, speed, temperature and parts made. Every copy is given its own machine's live tags
 * as inputs.
 */
import type { VisualDefinition, VisualInputDef, VisualNode, VisualRule } from '@config-platform/schema';
import { MACHINE_LOOKS, machineLooks } from './machine-looks.js';
import { ALARM, PAINTS, PAUSED, RUNNING, tint } from './machine-style.js';
import { group, shape, text } from './shapes.js';

export const MACHINE_SYMBOL_NAME = 'Machine';
export const MACHINE_WIDTH = 200;
export const MACHINE_HEIGHT = 246;

const INPUTS: VisualInputDef[] = [
  { name: 'name', label: 'Name', type: 'text', default: 'Machine' },
  { name: 'look', label: `Machine type: ${MACHINE_LOOKS.join(', ')}`, type: 'text', default: MACHINE_LOOKS[0] },
  { name: 'source', label: 'Fed by', type: 'text', default: '' },
  { name: 'status', label: 'Status: running, idle, alarm or stopped', type: 'text', default: '' },
  { name: 'speed', label: 'Speed (parts/min)', type: 'number', default: 0 },
  { name: 'target', label: 'Target speed (parts/min)', type: 'number', default: 10 },
  { name: 'temperature', label: 'Temperature (°C)', type: 'number', default: 0 },
  { name: 'maxTemperature', label: 'Temperature limit (°C)', type: 'number', default: 80 },
  { name: 'count', label: 'Parts made', type: 'number', default: 0 },
  { name: 'power', label: 'Power (kW)', type: 'number', default: 0 },
];

const ON_PANEL = 'var(--vis-light)';
const PANEL_MUTED = 'color-mix(in srgb, var(--vis-light) 55%, transparent)';

/** Slim stack light: red, amber, green; the lit one glows */
function stackLight(): VisualNode {
  const segment = (id: string, y: number, when: string, colour: string, blink = false): VisualNode[] => [
    shape('ellipse', `${id}-halo`, { x: 185, y: y + 6, rx: 14, ry: 11, fill: colour, opacity: 0 }, { rules: [{ when, set: { opacity: 0.3 }, effect: 'pulse' }] }),
    shape('rect', id, { x: 179, y, width: 12, height: 12, rx: 3, fill: tint('var(--vis-steel)', 45) }, {
      rules: [{ when, set: { fill: colour }, ...(blink ? { effect: 'blink' as const } : {}) }],
    }),
  ];
  return group('stack-light', [
    shape('rect', 'stack-pole', { x: 183, y: 80, width: 4, height: 62, fill: 'var(--vis-steel)' }),
    shape('rect', 'stack-foot', { x: 178, y: 140, width: 14, height: 10, rx: 2, fill: 'var(--vis-dark)' }),
    shape('rect', 'stack-cap', { x: 180, y: 38, width: 10, height: 4, rx: 2, fill: 'var(--vis-dark)' }),
    ...segment('stack-red', 42, ALARM, 'var(--vis-alarm)', true),
    ...segment('stack-amber', 55, PAUSED, 'var(--vis-idle)'),
    ...segment('stack-green', 68, RUNNING, 'var(--vis-on)'),
  ], {}, { name: 'Stack light' });
}

const statusColour = (attr: string): VisualRule[] => [
  { when: RUNNING, set: { [attr]: 'var(--vis-on)' } },
  { when: PAUSED, set: { [attr]: 'var(--vis-idle)' } },
  { when: ALARM, set: { [attr]: 'var(--vis-alarm)' } },
];

/** The operator display under the machine */
function display(): VisualNode {
  const value = (id: string, x: number, label: string, expr: string, rules: VisualRule[] = []): VisualNode[] => [
    text(`${id}-label`, x, 36, label, 7, { fontWeight: '600', fill: PANEL_MUTED }),
    text(id, x, 52, '—', 13, { fontWeight: '700', fill: ON_PANEL }, { bindings: { text: expr }, rules }),
  ];
  return group('display', [
    shape('rect', 'display-face', { width: 188, height: 66, rx: 10, fill: 'color-mix(in srgb, var(--vis-shade) 88%, var(--vis-blue))' }),
    text('name', 12, 19, 'Machine', 11, { fontWeight: '700', fill: ON_PANEL }, { name: 'Name', bindings: { text: 'inputs.name' } }),
    shape('ellipse', 'status-dot', { x: 126, y: 15, rx: 3, ry: 3, fill: 'var(--vis-off)' }, { rules: statusColour('fill') }),
    text('status', 133, 18.5, 'NO DATA', 8, { fontWeight: '700', fill: 'var(--vis-off)' }, {
      name: 'Status',
      bindings: { text: 'inputs.status ? upper(inputs.status) : "NO DATA"' },
      rules: statusColour('fill'),
    }),
    ...value('speed', 12, 'PARTS/MIN', 'concat(round(inputs.speed, 1))'),
    ...value('temperature', 72, 'TEMP °C', 'concat(round(inputs.temperature, 1))', [
      { when: 'inputs.temperature > inputs.maxTemperature * 0.85', set: { fill: 'var(--vis-orange)' } },
      { when: 'inputs.temperature > inputs.maxTemperature', set: { fill: 'var(--vis-alarm)' }, effect: 'blink' },
    ]),
    ...value('count', 128, 'PARTS', 'concat(round(inputs.count))'),
    shape('rect', 'output-track', { x: 12, y: 58, width: 164, height: 3, rx: 1.5, fill: tint('var(--vis-light)', 15) }),
    shape('rect', 'output', { x: 12, y: 58, width: 0, height: 3, rx: 1.5, fill: 'var(--vis-on)' }, {
      name: 'Output vs target',
      bindings: { width: 'clamp(inputs.speed / inputs.target, 0, 1) * 164' },
      rules: [{ when: ALARM, set: { fill: 'var(--vis-alarm)' } }],
      smooth: 600,
    }),
  ], { x: 6, y: 160 }, { name: 'Display' });
}

export function machineSymbol(): VisualDefinition {
  const nodes: VisualNode[] = [
    shape('ellipse', 'ground-shadow', { x: 92, y: 151, rx: 84, ry: 5, fill: 'var(--vis-shade)', opacity: 0.12 }),
    group('machine', machineLooks(), {}, { name: 'Machine', bindings: { opacity: 'inputs.status ? 1 : 0.5' } }),
    stackLight(),
    display(),
    text('source', MACHINE_WIDTH / 2, 240, '', 8.5, { textAnchor: 'middle', fill: 'var(--vis-grey)' }, { name: 'Fed by', bindings: { text: 'inputs.source' } }),
  ];
  return { version: 2, width: MACHINE_WIDTH, height: MACHINE_HEIGHT, mode: 'flat', grid: true, gridSize: 2, inputs: INPUTS, paints: PAINTS, nodes };
}
