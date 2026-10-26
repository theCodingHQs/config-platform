/**
 * The demo's drawings, both made of copies of the Machine symbol:
 *   Plant floor    every machine in its line's area, each copy wired to its own machine's tags
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
const LINE_GAP = 28;
const TOP = 44;

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

export function plantFloor(machines: readonly DemoMachine[], symbolId: string): VisualDefinition {
  const areas: VisualNode[] = [];
  const copies: VisualNode[] = [];
  let x = MARGIN;
  const lines = [...new Set(machines.map((m) => m.line))];
  lines.forEach((line, li) => {
    const inLine = machines.filter((m) => m.line === line);
    const start = x;
    for (const m of inLine) {
      copies.push(symbol(m.code, symbolId, { x, y: TOP, name: m.name, source: SOURCE_LABELS[m.source], target: targetPerMinute(m), maxTemperature: temperatureLimit(m) }, { name: m.name, bindings: liveInputs(m.code) }));
      x += MACHINE_WIDTH;
    }
    const id = `area${li + 1}`;
    areas.push(group(id, [
      shape('rect', `${id}-floor`, { x: start - 10, y: 8, width: x - start + 20, height: TOP + MACHINE_HEIGHT + 4, rx: 6, fill: 'var(--vis-zone)', stroke: 'var(--vis-floor-line)' }),
      text(`${id}-label`, start - 2, 26, line.toUpperCase(), 11, { fontWeight: '700', fill: 'var(--vis-grey)' }),
    ], {}, { name: line, locked: true }));
    x += LINE_GAP;
  });
  const width = x - LINE_GAP + MARGIN;
  const codes = machines.map((m) => m.code);
  const totalsY = TOP + MACHINE_HEIGHT + 42;
  const total = (id: string, at: number, expr: string, name: string) =>
    text(id, at, totalsY, '', 14, { fontWeight: '700', textAnchor: 'middle', fill: 'var(--vis-label)' }, { name, bindings: { text: expr } });
  return {
    version: 2,
    width,
    height: totalsY + 18,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    nodes: [
      ...areas,
      ...copies,
      total('total-running', width * 0.2, `concat(sum(${codes.map((c) => `${tag(c, 'status')} == "running" ? 1 : 0`).join(', ')}), " of ${codes.length} running")`, 'Running'),
      total('total-parts', width * 0.4, `concat(round(sum(${codes.map((c) => tag(c, 'count')).join(', ')})), " parts made")`, 'Parts made'),
      total('total-rate', width * 0.6, `concat(round(sum(${codes.map((c) => tag(c, 'speed')).join(', ')}) * 60), " parts/h")`, 'Output rate'),
      total('total-power', width * 0.8, `concat(round(sum(${codes.map((c) => tag(c, 'power')).join(', ')}), 1), " kW")`, 'Power'),
    ],
  };
}

export function machineView(machines: readonly DemoMachine[], symbolId: string): VisualDefinition {
  const REC = 'ds.ds_machine[0]';
  const sourceByCode = machines.flatMap((m) => [`"${m.code}"`, `"${SOURCE_LABELS[m.source]}"`]).join(', ');
  return {
    version: 2,
    width: MACHINE_WIDTH + 16,
    height: MACHINE_HEIGHT + 12,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    nodes: [
      symbol('machine', symbolId, { x: 8, y: 6 }, {
        name: 'Picked machine',
        bindings: {
          ...liveInputs('state.code'),
          name: `${REC} ? ${REC}.name : state.code`,
          source: `pick(state.code, ${sourceByCode}, "")`,
          // The register stores parts per hour; the symbol wants parts per minute
          target: `${REC} && ${REC}.hourly_target ? ${REC}.hourly_target / 60 : 0`,
          maxTemperature: `${REC} && ${REC}.max_temperature ? ${REC}.max_temperature : 100`,
        },
      }),
    ],
  };
}
