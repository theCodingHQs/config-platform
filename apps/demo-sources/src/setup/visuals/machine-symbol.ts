/**
 * One machine, as a symbol in a modern dashboard style: a card with the machine's name, a status
 * pill under it (its dot pulses while running), a ring showing output against target, speed and power, a
 * temperature bar against the machine's limit, and parts made. Every copy is given its own
 * machine's live tags as inputs.
 */
import type { VisualDefinition, VisualInputDef, VisualNode, VisualRule } from '@config-platform/schema';
import { group, shape, text } from './shapes.js';

export const MACHINE_SYMBOL_NAME = 'Machine';
export const MACHINE_WIDTH = 192;
export const MACHINE_HEIGHT = 248;

const INPUTS: VisualInputDef[] = [
  { name: 'name', label: 'Name', type: 'text', default: 'Machine' },
  { name: 'source', label: 'Fed by', type: 'text', default: '' },
  { name: 'status', label: 'Status: running, idle, alarm or stopped', type: 'text', default: '' },
  { name: 'speed', label: 'Speed (parts/min)', type: 'number', default: 0 },
  { name: 'target', label: 'Target speed (parts/min)', type: 'number', default: 10 },
  { name: 'temperature', label: 'Temperature (°C)', type: 'number', default: 0 },
  { name: 'maxTemperature', label: 'Temperature limit (°C)', type: 'number', default: 80 },
  { name: 'count', label: 'Parts made', type: 'number', default: 0 },
  { name: 'power', label: 'Power (kW)', type: 'number', default: 0 },
];

const W = MACHINE_WIDTH;
const PAD = 16;
const RUNNING = 'inputs.status == "running"';
const PAUSED = 'inputs.status == "idle" || inputs.status == "stopped"';
const ALARM = 'inputs.status == "alarm"';
const LABEL = { fill: 'var(--vis-label)' };
const MUTED = { fill: 'var(--vis-grey)' };
const tint = (colour: string, pct: number) => `color-mix(in srgb, ${colour} ${pct}%, transparent)`;

/** The status colour, set on `attr` (a fill or an outline) */
const statusRules = (attr: string, as: (colour: string) => string = (c) => c): VisualRule[] => [
  { when: RUNNING, set: { [attr]: as('var(--vis-on)') } },
  { when: PAUSED, set: { [attr]: as('var(--vis-idle)') } },
  { when: ALARM, set: { [attr]: as('var(--vis-alarm)') } },
];

function statusPill(): VisualNode {
  return group('pill', [
    shape('rect', 'pill-bg', { width: 74, height: 22, rx: 11, fill: tint('var(--vis-off)', 18) }, { rules: statusRules('fill', (c) => tint(c, 16)) }),
    shape('ellipse', 'pill-dot', { x: 13, y: 11, rx: 3.5, ry: 3.5, fill: 'var(--vis-off)' }, {
      rules: [...statusRules('fill').slice(0, 2), { when: ALARM, set: { fill: 'var(--vis-alarm)' }, effect: 'blink' }],
      effects: [{ type: 'pulse', when: RUNNING }],
    }),
    text('pill-text', 22, 14.5, 'NO DATA', 8.5, { fontWeight: '700', fill: 'var(--vis-grey)' }, {
      bindings: { text: 'inputs.status ? upper(inputs.status) : "NO DATA"' },
      rules: statusRules('fill'),
    }),
  ], { x: PAD, y: 40 }, { name: 'Status' });
}

/** Output against target as a ring: a full circle drawn from the top, dashed to the fraction reached */
function outputRing(cx: number, cy: number, r: number): VisualNode {
  const circle = `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}`;
  const length = Math.round(2 * Math.PI * r * 10) / 10;
  const fraction = 'clamp(inputs.speed / inputs.target, 0, 1)';
  return group('ring', [
    shape('path', 'ring-track', { d: circle, fill: 'none', stroke: tint('var(--vis-steel)', 28), strokeWidth: 9 }),
    shape('path', 'ring-value', { d: circle, fill: 'none', stroke: 'var(--vis-blue)', strokeWidth: 9, strokeLinecap: 'round', strokeDasharray: `0 ${length}` }, {
      name: 'Output',
      bindings: { strokeDasharray: `concat(${fraction} * ${length}, " ", ${length})` },
      rules: [
        { when: 'inputs.speed >= inputs.target * 0.9', set: { stroke: 'var(--vis-on)' } },
        { when: ALARM, set: { stroke: 'var(--vis-alarm)' } },
        { when: '!(inputs.speed > 0)', set: { opacity: 0 } },
      ],
    }),
    text('ring-pct', cx, cy + 3, '—', 19, { fontWeight: '800', textAnchor: 'middle', ...LABEL }, {
      bindings: { text: 'concat(round(min(inputs.speed / inputs.target, 9.99) * 100), "%")' },
    }),
    text('ring-label', cx, cy + 17, 'of target', 8.5, { textAnchor: 'middle', ...MUTED }),
  ], {}, { name: 'Output vs target' });
}

/** A small label with a value under it */
const metric = (id: string, x: number, y: number, label: string, value: string): VisualNode =>
  group(id, [
    text(`${id}-label`, 0, 0, label.toUpperCase(), 8, { fontWeight: '600', ...MUTED }),
    text(`${id}-value`, 0, 19, '—', 17, { fontWeight: '700', ...LABEL }, { bindings: { text: value } }),
  ], { x, y }, { name: label });

function temperature(y: number): VisualNode {
  const width = W - 2 * PAD;
  return group('temperature', [
    text('temp-label', 0, 0, 'TEMPERATURE', 8, { fontWeight: '600', ...MUTED }),
    text('temp-value', width, 0, '—', 10, { fontWeight: '700', textAnchor: 'end', ...LABEL }, {
      bindings: { text: 'concat(round(inputs.temperature, 1), " / ", round(inputs.maxTemperature), " °C")' },
    }),
    shape('rect', 'temp-track', { x: 0, y: 7, width, height: 6, rx: 3, fill: tint('var(--vis-steel)', 28) }),
    shape('rect', 'temp-fill', { x: 0, y: 7, width: 0, height: 6, rx: 3, fill: 'var(--vis-on)' }, {
      bindings: { width: `clamp(inputs.temperature / inputs.maxTemperature, 0, 1) * ${width}` },
      rules: [
        { when: 'inputs.temperature > inputs.maxTemperature * 0.85', set: { fill: 'var(--vis-orange)' } },
        { when: 'inputs.temperature > inputs.maxTemperature', set: { fill: 'var(--vis-alarm)' }, effect: 'blink' },
      ],
      smooth: 700,
    }),
  ], { x: PAD, y }, { name: 'Temperature' });
}

export function machineSymbol(): VisualDefinition {
  const nodes: VisualNode[] = [
    shape('rect', 'card', { width: W, height: MACHINE_HEIGHT, rx: 16, fill: 'var(--vis-label-bg)', stroke: 'var(--vis-floor-line)', shadow: true }, {
      name: 'Card',
      rules: [{ when: ALARM, set: { stroke: 'var(--vis-alarm)', strokeWidth: 2 } }],
    }),
    group('content', [
      text('name', PAD, 30, 'Machine', 13, { fontWeight: '700', ...LABEL }, { name: 'Name', bindings: { text: 'inputs.name' } }),
      text('source', PAD + 82, 55, '', 9, MUTED, { name: 'Fed by', bindings: { text: 'inputs.source' } }),
      statusPill(),
      outputRing(PAD + 44, 120, 38),
      metric('speed', 124, 96, 'Speed /min', 'concat(round(inputs.speed, 1))'),
      metric('power', 124, 136, 'Power kW', 'concat(round(inputs.power, 1))'),
      shape('line', 'divider', { x1: PAD, y1: 178, x2: W - PAD, y2: 178, stroke: 'var(--vis-floor-line)' }),
      temperature(198),
      text('count-label', PAD, 232, 'PARTS MADE', 8, { fontWeight: '600', ...MUTED }),
      text('count', W - PAD, 233, '—', 13, { fontWeight: '800', textAnchor: 'end', ...LABEL }, { name: 'Parts made', bindings: { text: 'concat(round(inputs.count))' } }),
    ], {}, { name: 'Content', bindings: { opacity: 'inputs.status ? 1 : 0.45' } }),
  ];
  return { version: 2, width: W, height: MACHINE_HEIGHT, mode: 'flat', grid: true, gridSize: 2, inputs: INPUTS, nodes };
}
