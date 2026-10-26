/**
 * The demo's drawings, both made of copies of the Machine symbol:
 *   Plant floor    every machine on its line's floor, and a plant totals display underneath
 *   Machine view   one copy that follows the machine picked on the page (state.code) and takes its
 *                  target and limit from the machine register (the page's data source)
 */
import type { VisualDefinition, VisualNode } from '@config-platform/schema';
import { SOURCE_LABELS, type DemoMachine } from '../../catalog.js';
import { tag } from '../pages/blocks.js';
import { MACHINE_HEIGHT, MACHINE_WIDTH } from './machine-symbol.js';
import { group, shape, symbol, text } from './shapes.js';

export const PLANT_FLOOR_NAME = 'Plant floor';
export const MACHINE_VIEW_NAME = 'Machine view';

const MARGIN = 24;
/** Space between machines in a line */
const GAP = 20;
/** Space around the machines inside a line's area, and above them for the line's name */
const AREA_PAD = 16;
const AREA_HEAD = 40;
const LINE_GAP = 24;
const AREA_TOP = 16;
const TOP = AREA_TOP + AREA_HEAD;
const TOTALS_H = 76;

/** The symbol's live inputs for a machine (a code, or state.code) */
const liveInputs = (code: string): Record<string, string> => ({
  status: tag(code, 'status'),
  speed: tag(code, 'speed'),
  temperature: tag(code, 'temperature'),
  count: tag(code, 'count'),
  power: tag(code, 'power'),
});

/** Same as the machine register's starting values: the hourly target per minute, 45 °C above cold */
const targetPerMinute = (m: DemoMachine) => Math.round((m.hourlyTarget / 60) * 10) / 10;
const temperatureLimit = (m: DemoMachine) => m.baseTemperature + 45;

/** Plant totals on one dark display, like the machines' own */
function totalsDisplay(x: number, y: number, width: number, readouts: Array<[string, string]>): VisualNode {
  const col = width / readouts.length;
  return group('totals', [
    shape('rect', 'totals-face', { width, height: TOTALS_H, rx: 14, fill: 'color-mix(in srgb, var(--vis-shade) 88%, var(--vis-blue))' }),
    ...readouts.flatMap(([label, expr], i) => [
      text(`totals-${i}-label`, 24 + i * col, 30, label.toUpperCase(), 9, { fontWeight: '600', fill: 'color-mix(in srgb, var(--vis-light) 55%, transparent)' }),
      text(`totals-${i}-value`, 24 + i * col, 58, '—', 22, { fontWeight: '800', fill: 'var(--vis-light)' }, { name: label, bindings: { text: expr } }),
    ]),
  ], { x, y }, { name: 'Plant totals' });
}

export function plantFloor(machines: readonly DemoMachine[], symbolId: string): VisualDefinition {
  const areas: VisualNode[] = [];
  const copies: VisualNode[] = [];
  let x = MARGIN + AREA_PAD;
  const lines = [...new Set(machines.map((m) => m.line))];
  lines.forEach((line, li) => {
    const inLine = machines.filter((m) => m.line === line);
    const start = x;
    inLine.forEach((m, i) => {
      copies.push(symbol(m.code, symbolId, { x, y: TOP, name: m.name, look: m.machineType, source: SOURCE_LABELS[m.source], target: targetPerMinute(m), maxTemperature: temperatureLimit(m) }, { name: m.name, bindings: liveInputs(m.code) }));
      x += MACHINE_WIDTH;
      if (i < inLine.length - 1) x += GAP;
    });
    const id = `area${li + 1}`;
    areas.push(group(id, [
      shape('rect', `${id}-floor`, { x: start - AREA_PAD, y: AREA_TOP, width: x - start + 2 * AREA_PAD, height: AREA_HEAD + MACHINE_HEIGHT + AREA_PAD, rx: 18, fill: 'var(--vis-label-bg)' }),
      text(`${id}-label`, start + 2, AREA_TOP + 26, line.toUpperCase(), 10, { fontWeight: '700', fill: 'var(--vis-grey)' }),
      text(`${id}-count`, x - 2, AREA_TOP + 26, `${inLine.length} machines`, 9, { textAnchor: 'end', fill: 'var(--vis-grey)' }),
    ], {}, { name: line, locked: true }));
    x += AREA_PAD + LINE_GAP + AREA_PAD;
  });
  const width = x - LINE_GAP - AREA_PAD + MARGIN;

  const codes = machines.map((m) => m.code);
  const totalsY = TOP + MACHINE_HEIGHT + AREA_PAD + 16;
  const sumOf = (key: string) => `sum(${codes.map((c) => tag(c, key)).join(', ')})`;
  return {
    version: 2,
    width,
    height: totalsY + TOTALS_H + MARGIN,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    nodes: [
      ...areas,
      ...copies,
      totalsDisplay(MARGIN, totalsY, width - 2 * MARGIN, [
        ['Running now', `concat(sum(${codes.map((c) => `${tag(c, 'status')} == "running" ? 1 : 0`).join(', ')}), " of ${codes.length}")`],
        ['Parts made', `concat(round(${sumOf('count')}))`],
        ['Output rate', `concat(round(${sumOf('speed')} * 60), " /h")`],
        ['Power draw', `concat(round(${sumOf('power')}, 1), " kW")`],
      ]),
    ],
  };
}

export function machineView(machines: readonly DemoMachine[], symbolId: string): VisualDefinition {
  const REC = 'ds.ds_machine[0]';
  const sourceByCode = machines.flatMap((m) => [`"${m.code}"`, `"${SOURCE_LABELS[m.source]}"`]).join(', ');
  return {
    version: 2,
    width: MACHINE_WIDTH + 32,
    height: MACHINE_HEIGHT + 32,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    nodes: [
      symbol('machine', symbolId, { x: 16, y: 16 }, {
        name: 'Picked machine',
        bindings: {
          ...liveInputs('state.code'),
          name: `${REC} ? ${REC}.name : state.code`,
          look: `${REC} ? ${REC}.machine_type : ""`,
          source: `pick(state.code, ${sourceByCode}, "")`,
          // The register stores parts per hour; the symbol wants parts per minute
          target: `${REC} && ${REC}.hourly_target ? ${REC}.hourly_target / 60 : 0`,
          maxTemperature: `${REC} && ${REC}.max_temperature ? ${REC}.max_temperature : 100`,
        },
      }),
    ],
  };
}
