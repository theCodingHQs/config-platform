/**
 * One machine, as a symbol: a signal tower, a cabinet whose rotor turns while it runs, a status
 * badge, speed and temperature bars against the machine's own target and limit, and a belt that
 * moves while it runs. Every copy is given its own machine's live tags as inputs; copies placed
 * side by side join their belts into one.
 */
import type { VisualDefinition, VisualInputDef, VisualNode } from '@config-platform/schema';
import { group, shape, text } from './shapes.js';

export const MACHINE_SYMBOL_NAME = 'Machine';
export const MACHINE_WIDTH = 172;
export const MACHINE_HEIGHT = 232;

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

const RUNNING = 'inputs.status == "running"';
const OUTLINE = { stroke: 'var(--vis-dark)', strokeWidth: 0.8 };
const LABEL = { fill: 'var(--vis-label)' };
const W = MACHINE_WIDTH;

/** Red, yellow and green lamps on a pole; the one for the current status is lit */
function signalTower(): VisualNode {
  const lamp = (id: string, y: number, when: string, colour: string, blink = false) =>
    shape('rect', id, { x: 6, y, width: 14, height: 14, rx: 2, fill: 'var(--vis-off)', ...OUTLINE }, { rules: [{ when, set: { fill: colour }, ...(blink ? { effect: 'blink' as const } : {}) }] });
  return group('tower', [
    shape('line', 'pole', { x1: 13, y1: 86, x2: 13, y2: 140, stroke: 'var(--vis-steel)', strokeWidth: 3 }),
    lamp('lamp-red', 40, 'inputs.status == "alarm"', 'var(--vis-alarm)', true),
    lamp('lamp-yellow', 55, 'inputs.status == "idle" || inputs.status == "stopped"', 'var(--vis-idle)'),
    lamp('lamp-green', 70, RUNNING, 'var(--vis-on)'),
  ], {}, { name: 'Signal tower' });
}

/** A rotor behind a window; it turns while the machine runs */
function cabinet(): VisualNode {
  const spokes = [0, 45, 90, 135].map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    const dx = Math.round(Math.cos(r) * 20 * 10) / 10;
    const dy = Math.round(Math.sin(r) * 20 * 10) / 10;
    return shape('line', `spoke${i}`, { x1: 73 - dx, y1: 82 - dy, x2: 73 + dx, y2: 82 + dy });
  });
  return group('cabinet', [
    shape('rect', 'body', { x: 28, y: 38, width: 138, height: 104, rx: 5, fill: 'url(#body)', stroke: 'var(--vis-steel)', strokeWidth: 1.3 }, { name: 'Cabinet' }),
    shape('rect', 'window', { x: 38, y: 48, width: 70, height: 68, rx: 3, fill: 'var(--vis-glass)', stroke: 'var(--vis-steel)' }, { name: 'Window' }),
    group('rotor', [
      shape('ellipse', 'rotor-rim', { x: 73, y: 82, rx: 22, ry: 22, fill: 'none', stroke: 'var(--vis-dark)', strokeWidth: 2 }),
      group('spokes', spokes, { stroke: 'var(--vis-dark)', strokeWidth: 2.4, strokeLinecap: 'round' }),
      shape('ellipse', 'rotor-hub', { x: 73, y: 82, rx: 5, ry: 5, fill: 'var(--vis-steel)', ...OUTLINE }),
    ], {}, { name: 'Rotor', effects: [{ type: 'spin', when: RUNNING }] }),
    shape('rect', 'alarm-glow', { x: 38, y: 48, width: 70, height: 68, rx: 3, fill: 'var(--vis-alarm)', opacity: 0 }, {
      name: 'Alarm glow',
      rules: [{ when: 'inputs.status == "alarm"', set: { opacity: 0.3 }, effect: 'blink' }],
    }),
    group('badge', [
      shape('rect', 'badge-box', { width: 46, height: 18, rx: 3, fill: 'var(--vis-off)', ...OUTLINE }, {
        rules: [
          { when: RUNNING, set: { fill: 'var(--vis-on)' } },
          { when: 'inputs.status == "idle" || inputs.status == "stopped"', set: { fill: 'var(--vis-idle)' } },
          { when: 'inputs.status == "alarm"', set: { fill: 'var(--vis-alarm)' } },
        ],
      }),
      text('badge-text', 23, 12.5, 'NO DATA', 8, { fontWeight: '700', textAnchor: 'middle', fill: 'var(--vis-dark)' }, {
        bindings: { text: 'inputs.status ? upper(inputs.status) : "NO DATA"' },
      }),
    ], { x: 114, y: 50 }, { name: 'Status' }),
    group('buttons', [
      shape('ellipse', 'btn-start', { x: 124, y: 96, rx: 6, ry: 6, fill: 'var(--vis-green)' }),
      shape('ellipse', 'btn-stop', { x: 144, y: 96, rx: 6, ry: 6, fill: 'var(--vis-red)' }),
      shape('rect', 'panel-line', { x: 116, y: 110, width: 38, height: 4, rx: 2, fill: 'var(--vis-steel)' }),
    ], OUTLINE, { name: 'Buttons' }),
  ], {}, { name: 'Machine' });
}

/** A bar filled in proportion to `fraction` (0–1), with a label and a value on top */
function bar(id: string, y: number, label: string, value: string, fraction: string, rules: VisualNode['rules'] = []): VisualNode {
  return group(id, [
    text(`${id}-label`, 0, 0, label, 9, { fill: 'var(--vis-grey)' }),
    text(`${id}-value`, 138, 0, '—', 9, { fontWeight: '600', textAnchor: 'end', ...LABEL }, { bindings: { text: value } }),
    shape('rect', `${id}-track`, { x: 0, y: 4, width: 138, height: 7, rx: 3.5, fill: 'color-mix(in srgb, var(--vis-steel) 30%, var(--vis-white))' }),
    shape('rect', `${id}-fill`, { x: 0, y: 4, width: 0, height: 7, rx: 3.5, fill: 'var(--vis-blue)' }, { bindings: { width: `clamp(${fraction}, 0, 1) * 138` }, rules, smooth: 700 }),
  ], { x: 28, y }, { name: label });
}

export function machineSymbol(): VisualDefinition {
  const nodes: VisualNode[] = [
    group('machine', [
      text('name', W / 2, 15, 'Machine', 12, { fontWeight: '700', textAnchor: 'middle', ...LABEL }, { name: 'Name', bindings: { text: 'inputs.name' } }),
      text('source', W / 2, 29, '', 9, { textAnchor: 'middle', fill: 'var(--vis-grey)' }, { name: 'Fed by', bindings: { text: 'inputs.source' } }),
      signalTower(),
      cabinet(),
      bar('speed', 158, 'Speed', 'concat(round(inputs.speed, 1), " / ", round(inputs.target, 1), " per min")', 'inputs.speed / inputs.target'),
      bar('temperature', 182, 'Temperature', 'concat(round(inputs.temperature, 1), " °C")', 'inputs.temperature / inputs.maxTemperature', [
        { when: 'inputs.temperature > inputs.maxTemperature * 0.85', set: { fill: 'var(--vis-orange)' } },
        { when: 'inputs.temperature > inputs.maxTemperature', set: { fill: 'var(--vis-alarm)' }, effect: 'blink' },
      ]),
      text('count', 28, 210, '', 10, { fontWeight: '600', ...LABEL }, { name: 'Parts made', bindings: { text: 'concat(round(inputs.count), " parts")' } }),
      text('power', 166, 210, '', 10, { fontWeight: '600', textAnchor: 'end', ...LABEL }, { name: 'Power', bindings: { text: 'concat(round(inputs.power, 1), " kW")' } }),
    ], {}, { name: 'Machine', bindings: { opacity: 'inputs.status ? 1 : 0.5' } }),
    group('belt', [
      shape('rect', 'belt-body', { x: 0, y: 218, width: W, height: 12, fill: 'var(--vis-belt)' }),
      shape('line', 'belt-marks', { x1: 0, y1: 224, x2: W, y2: 224, stroke: 'var(--vis-belt-mark)', strokeWidth: 2, strokeDasharray: '8 6' }, { effects: [{ type: 'flow', when: RUNNING }] }),
    ], {}, { name: 'Belt' }),
  ];
  return {
    version: 2,
    width: W,
    height: MACHINE_HEIGHT,
    mode: 'flat',
    grid: true,
    gridSize: 2,
    inputs: INPUTS,
    paints: [
      { id: 'body', type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: 'var(--vis-white)' }, { offset: 1, color: 'color-mix(in srgb, var(--vis-steel) 40%, var(--vis-white))' }] },
    ],
    nodes,
  };
}
