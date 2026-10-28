/** A pump: grey when stopped, green with its rotor turning while running, red and blinking in alarm; the arrow shows which way it pumps (turn the copy to change it) */
import { emptyVisualDefinition, type VisualDefinition } from '../visuals/index.js';
import { group, shape, text } from './builder.js';
import { ALARM, RUNNING, STATUS_INPUT } from './status.js';

export function pumpSymbol(): VisualDefinition {
  return {
    ...emptyVisualDefinition('flat'),
    width: 80,
    height: 80,
    gridSize: 2,
    inputs: [{ name: 'name', label: 'Name', type: 'text', default: 'Pump' }, STATUS_INPUT],
    nodes: [
      shape('rect', 'outlet', { x: 40, y: 22, width: 36, height: 12, rx: 2, fill: 'var(--vis-steel)' }, { name: 'Outlet' }),
      shape('ellipse', 'body', { x: 34, y: 28, rx: 22, ry: 22, fill: 'var(--vis-grey)', stroke: 'var(--vis-white)', strokeWidth: 2, shadow: true }, {
        name: 'Body',
        rules: [
          { when: RUNNING, set: { fill: 'var(--vis-on)' } },
          { when: ALARM, set: { fill: 'var(--vis-alarm)' }, effect: 'blink' },
        ],
      }),
      group('rotor', [0, 60, 120].map((deg, i) => shape('rect', `vane${i}`, { x: -2, y: -14, width: 4, height: 28, rx: 2, fill: 'var(--vis-white)', opacity: 0.7, rotate: deg, pivot: 'anchor' })), { x: 34, y: 28 }, {
        name: 'Rotor',
        effects: [{ type: 'spin', when: RUNNING, speed: 2 }],
      }),
      shape('polygon', 'arrow', { points: '64,22 74,28 64,34', fill: 'var(--vis-white)' }, { name: 'Direction' }),
      text('name', 34, 70, 'Pump', 10, { textAnchor: 'middle', fontWeight: '700', fill: 'var(--vis-label)' }, { name: 'Name', bindings: { text: 'inputs.name' } }),
    ],
  };
}
