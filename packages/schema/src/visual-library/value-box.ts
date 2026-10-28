/** A labelled value in a box ("Flow 418 L/min"); the box blinks red while it's an alarm */
import { emptyVisualDefinition, type VisualDefinition } from '../visuals/index.js';
import { shape, text } from './builder.js';

export function valueBoxSymbol(): VisualDefinition {
  return {
    ...emptyVisualDefinition('flat'),
    width: 120,
    height: 56,
    gridSize: 2,
    inputs: [
      { name: 'label', label: 'Label', type: 'text', default: 'Value' },
      { name: 'value', label: 'Value', type: 'number', default: 0 },
      { name: 'unit', label: 'Unit', type: 'text', default: '' },
      { name: 'decimals', label: 'Decimal places', type: 'number', default: 1 },
      { name: 'alarm', label: 'Show as alarm', type: 'boolean', default: false },
    ],
    nodes: [
      text('label', 60, 12, 'Value', 10, { textAnchor: 'middle', fontWeight: '600', fill: 'var(--vis-grey)' }, { name: 'Label', bindings: { text: 'inputs.label' } }),
      shape('rect', 'box', { x: 2, y: 18, width: 116, height: 36, rx: 6, fill: 'var(--vis-label-bg)', stroke: 'color-mix(in srgb, var(--vis-steel) 40%, transparent)', strokeWidth: 1 }, {
        name: 'Box',
        rules: [{ when: 'inputs.alarm', set: { stroke: 'var(--vis-alarm)', strokeWidth: 2.5 }, effect: 'blink' }],
      }),
      text('value', 60, 42, '0', 16, { textAnchor: 'middle', fontWeight: '700', fill: 'var(--vis-label)', fontFamily: 'monospace' }, {
        name: 'Value',
        bindings: { text: 'concat(round(inputs.value, inputs.decimals), inputs.unit ? concat(" ", inputs.unit) : "")' },
      }),
    ],
  };
}
