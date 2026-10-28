/** A dial gauge: the needle sweeps from min to max as the value changes, with the value and its unit underneath */
import { emptyVisualDefinition, type VisualDefinition } from '../visuals/index.js';
import { group, shape, text } from './builder.js';

const CX = 70;
const CY = 66;
const R = 52;
/** The dial runs from 120° left of straight up to 120° right of it */
const SWEEP = 120;

const at = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.round((CX + r * Math.sin(a)) * 10) / 10, y: Math.round((CY - r * Math.cos(a)) * 10) / 10 };
};

export function gaugeSymbol(): VisualDefinition {
  const start = at(-SWEEP);
  const end = at(SWEEP);
  const ticks = [-120, -60, 0, 60, 120].map((deg, i) => {
    const outer = at(deg, R - 2);
    const inner = at(deg, R - 10);
    return shape('line', `tick${i}`, { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, stroke: 'var(--vis-grey)', strokeWidth: 1.5 });
  });
  return {
    ...emptyVisualDefinition('flat'),
    width: 140,
    height: 148,
    gridSize: 2,
    inputs: [
      { name: 'label', label: 'Label', type: 'text', default: 'Value' },
      { name: 'value', label: 'Value', type: 'number', default: 0 },
      { name: 'min', label: 'Lowest on the dial', type: 'number', default: 0 },
      { name: 'max', label: 'Highest on the dial', type: 'number', default: 100 },
      { name: 'unit', label: 'Unit', type: 'text', default: '' },
      { name: 'decimals', label: 'Decimal places', type: 'number', default: 0 },
      { name: 'alarm', label: 'Show as alarm', type: 'boolean', default: false },
    ],
    nodes: [
      shape('ellipse', 'face', { x: CX, y: CY, rx: R + 8, ry: R + 8, fill: 'var(--vis-label-bg)', stroke: 'color-mix(in srgb, var(--vis-steel) 40%, transparent)', strokeWidth: 1.5 }, {
        name: 'Face',
        rules: [{ when: 'inputs.alarm', set: { stroke: 'var(--vis-alarm)', strokeWidth: 3 }, effect: 'blink' }],
      }),
      shape('path', 'arc', { d: `M${start.x} ${start.y}A${R} ${R} 0 1 1 ${end.x} ${end.y}`, fill: 'none', stroke: 'color-mix(in srgb, var(--vis-steel) 35%, transparent)', strokeWidth: 6, strokeLinecap: 'round' }, { name: 'Dial' }),
      group('ticks', ticks, {}, { name: 'Ticks' }),
      group('needle', [
        shape('polygon', 'needle-hand', { points: `-3,0 0,${-(R - 6)} 3,0`, fill: 'var(--vis-blue)' }, { rules: [{ when: 'inputs.alarm', set: { fill: 'var(--vis-alarm)' } }] }),
        shape('ellipse', 'needle-hub', { x: 0, y: 0, rx: 5, ry: 5, fill: 'var(--vis-dark)' }),
      ], { x: CX, y: CY, rotate: -SWEEP, pivot: 'anchor' }, {
        name: 'Needle',
        bindings: { rotate: `scale(inputs.value, inputs.min, inputs.max, ${-SWEEP}, ${SWEEP})` },
        smooth: 600,
      }),
      text('value', CX, CY + 30, '0', 15, { textAnchor: 'middle', fontWeight: '800', fill: 'var(--vis-label)', fontFamily: 'monospace' }, {
        name: 'Value',
        bindings: { text: 'concat(round(inputs.value, inputs.decimals), inputs.unit ? concat(" ", inputs.unit) : "")' },
      }),
      text('label', CX, 143, 'Value', 10, { textAnchor: 'middle', fontWeight: '600', fill: 'var(--vis-grey)' }, { name: 'Label', bindings: { text: 'inputs.label' } }),
    ],
  };
}
