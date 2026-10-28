/** A stack light: red, amber and green lamps on a pole; the one for the status lights up, red blinks */
import { emptyVisualDefinition, type VisualDefinition, type VisualNode } from '../visuals/index.js';
import { group, shape } from './builder.js';
import { ALARM, PAUSED, RUNNING, STATUS_INPUT } from './status.js';

const UNLIT = 'color-mix(in srgb, var(--vis-steel) 45%, transparent)';

function lamp(id: string, y: number, when: string, colour: string, blink = false): VisualNode {
  return group(id, [
    shape('ellipse', `${id}-halo`, { x: 20, y: y + 9, rx: 19, ry: 15, fill: colour, opacity: 0 }, { rules: [{ when, set: { opacity: 0.3 }, effect: 'pulse' }] }),
    shape('rect', `${id}-lens`, { x: 11, y, width: 18, height: 18, rx: 4, fill: UNLIT }, { rules: [{ when, set: { fill: colour }, ...(blink ? { effect: 'blink' as const } : {}) }] }),
  ], {}, { name: id[0].toUpperCase() + id.slice(1) });
}

export function stackLightSymbol(): VisualDefinition {
  return {
    ...emptyVisualDefinition('flat'),
    width: 40,
    height: 130,
    gridSize: 2,
    inputs: [STATUS_INPUT],
    nodes: [
      shape('rect', 'pole', { x: 18, y: 66, width: 4, height: 52, fill: 'var(--vis-steel)' }, { name: 'Pole' }),
      shape('rect', 'foot', { x: 11, y: 116, width: 18, height: 12, rx: 2, fill: 'var(--vis-dark)' }, { name: 'Foot' }),
      shape('rect', 'cap', { x: 12, y: 4, width: 16, height: 5, rx: 2, fill: 'var(--vis-dark)' }, { name: 'Cap' }),
      lamp('red', 9, ALARM, 'var(--vis-alarm)', true),
      lamp('amber', 28, PAUSED, 'var(--vis-idle)'),
      lamp('green', 47, RUNNING, 'var(--vis-on)'),
    ],
  };
}
