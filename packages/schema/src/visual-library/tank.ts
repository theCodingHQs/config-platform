/** A vertical tank whose liquid rises and falls with its level (0–100); the outline blinks red outside the low/high limits */
import { emptyVisualDefinition, type VisualDefinition } from '../visuals/index.js';
import { shape, text } from './builder.js';

const OUTLINE = 'color-mix(in srgb, var(--vis-steel) 75%, var(--vis-dark))';
const TOP = 26;
const HEIGHT = 186;
const INNER = HEIGHT - 8;
const LEVEL = 'clamp(inputs.level, 0, 100)';

export function tankSymbol(): VisualDefinition {
  return {
    ...emptyVisualDefinition('flat'),
    width: 120,
    height: 220,
    gridSize: 2,
    inputs: [
      { name: 'name', label: 'Name', type: 'text', default: 'Tank' },
      { name: 'level', label: 'Level (0–100)', type: 'number', default: 0 },
      { name: 'low', label: 'Too low below', type: 'number', default: 10 },
      { name: 'high', label: 'Too high above', type: 'number', default: 90 },
      { name: 'liquid', label: 'Liquid colour', type: 'color', default: 'var(--vis-liquid)' },
    ],
    nodes: [
      text('name', 60, 16, 'Tank', 12, { textAnchor: 'middle', fontWeight: '700', fill: 'var(--vis-label)' }, { name: 'Name', bindings: { text: 'inputs.name' } }),
      shape('rect', 'shell', { x: 10, y: TOP, width: 100, height: HEIGHT, rx: 12, fill: 'var(--vis-label-bg)', stroke: OUTLINE, strokeWidth: 1.5 }, {
        name: 'Shell',
        rules: [{ when: 'inputs.level < inputs.low || inputs.level > inputs.high', set: { stroke: 'var(--vis-alarm)', strokeWidth: 3 }, effect: 'blink' }],
      }),
      shape('rect', 'liquid', { x: 14, y: TOP + HEIGHT - 4, width: 92, height: 0, rx: 8, fill: 'var(--vis-liquid)', opacity: 0.85 }, {
        name: 'Liquid',
        bindings: { height: `${LEVEL} / 100 * ${INNER}`, y: `${TOP + HEIGHT - 4} - ${LEVEL} / 100 * ${INNER}`, fill: 'inputs.liquid' },
        smooth: 900,
      }),
      // Scale marks at 25 / 50 / 75 %
      ...[0.25, 0.5, 0.75].map((f, i) => {
        const y = Math.round((TOP + HEIGHT - 4 - f * INNER) * 10) / 10;
        return shape('line', `mark${i}`, { x1: 96, y1: y, x2: 106, y2: y, stroke: OUTLINE, strokeWidth: 1, opacity: 0.6 }, { name: `${f * 100}% mark` });
      }),
      text('level', 60, TOP + HEIGHT / 2 + 6, '0%', 18, { textAnchor: 'middle', fontWeight: '800', fill: 'var(--vis-label)' }, { name: 'Level', bindings: { text: 'concat(round(inputs.level), "%")' } }),
    ],
  };
}
