/**
 * The demo's drawings, both made of copies of the Machine symbol:
 *   Plant floor    every machine in its line's area, joined by flow lines that move while the
 *                  machine before them runs, and plant totals underneath
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
/** Space between machines in a line (the flow line runs across it) */
const GAP = 32;
/** Space around the machines inside a line's area, and above them for the line's name */
const AREA_PAD = 16;
const AREA_HEAD = 40;
const LINE_GAP = 24;
const AREA_TOP = 16;
const TOP = AREA_TOP + AREA_HEAD;
const TILE_H = 76;

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

/** From one machine's card to the next: dashes that flow while the first one runs */
function flowLine(id: string, x: number, from: DemoMachine): VisualNode {
  const y = TOP + MACHINE_HEIGHT / 2;
  return group(id, [
    shape('line', `${id}-dashes`, { x1: x + 4, y1: y, x2: x + GAP - 10, y2: y, stroke: 'var(--vis-steel)', strokeWidth: 3, strokeLinecap: 'round', strokeDasharray: '1 7' }, {
      rules: [{ when: `${tag(from.code, 'status')} == "running"`, set: { stroke: 'var(--vis-blue)' } }],
      effects: [{ type: 'flow', when: `${tag(from.code, 'status')} == "running"`, speed: 0.6 }],
    }),
    shape('polyline', `${id}-head`, { points: `${x + GAP - 12},${y - 4} ${x + GAP - 7},${y} ${x + GAP - 12},${y + 4}`, fill: 'none', stroke: 'var(--vis-steel)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, {
      rules: [{ when: `${tag(from.code, 'status')} == "running"`, set: { stroke: 'var(--vis-blue)' } }],
    }),
  ], {}, { name: `Flow from ${from.name}` });
}

/** A totals tile under the floor */
function tile(id: string, x: number, y: number, width: number, label: string, value: string): VisualNode {
  return group(id, [
    shape('rect', `${id}-card`, { width, height: TILE_H, rx: 14, fill: 'var(--vis-label-bg)', stroke: 'var(--vis-floor-line)', shadow: true }),
    text(`${id}-label`, 18, 28, label.toUpperCase(), 9, { fontWeight: '600', fill: 'var(--vis-grey)' }),
    text(`${id}-value`, 18, 58, '—', 24, { fontWeight: '800', fill: 'var(--vis-label)' }, { bindings: { text: value } }),
  ], { x, y }, { name: label });
}

export function plantFloor(machines: readonly DemoMachine[], symbolId: string): VisualDefinition {
  const areas: VisualNode[] = [];
  const flows: VisualNode[] = [];
  const copies: VisualNode[] = [];
  let x = MARGIN + AREA_PAD;
  const lines = [...new Set(machines.map((m) => m.line))];
  lines.forEach((line, li) => {
    const inLine = machines.filter((m) => m.line === line);
    const start = x;
    inLine.forEach((m, i) => {
      copies.push(symbol(m.code, symbolId, { x, y: TOP, name: m.name, source: SOURCE_LABELS[m.source], target: targetPerMinute(m), maxTemperature: temperatureLimit(m) }, { name: m.name, bindings: liveInputs(m.code) }));
      x += MACHINE_WIDTH;
      if (i < inLine.length - 1) {
        flows.push(flowLine(`flow-${m.code}`, x, m));
        x += GAP;
      }
    });
    const id = `area${li + 1}`;
    areas.push(group(id, [
      shape('rect', `${id}-floor`, { x: start - AREA_PAD, y: AREA_TOP, width: x - start + 2 * AREA_PAD, height: AREA_HEAD + MACHINE_HEIGHT + AREA_PAD, rx: 22, fill: 'color-mix(in srgb, var(--vis-zone) 55%, transparent)', stroke: 'var(--vis-floor-line)', strokeDasharray: '6 6' }),
      text(`${id}-label`, start + 2, AREA_TOP + 26, line.toUpperCase(), 10, { fontWeight: '700', fill: 'var(--vis-grey)' }),
      text(`${id}-count`, x - 2, AREA_TOP + 26, `${inLine.length} machines`, 9, { textAnchor: 'end', fill: 'var(--vis-grey)' }),
    ], {}, { name: line, locked: true }));
    x += AREA_PAD + LINE_GAP + AREA_PAD;
  });
  const width = x - LINE_GAP - AREA_PAD + MARGIN;

  const codes = machines.map((m) => m.code);
  const tilesY = TOP + MACHINE_HEIGHT + AREA_PAD + 20;
  const tileW = (width - 2 * MARGIN - 3 * 16) / 4;
  const tileAt = (i: number) => MARGIN + i * (tileW + 16);
  const sumOf = (key: string) => `sum(${codes.map((c) => tag(c, key)).join(', ')})`;
  return {
    version: 2,
    width,
    height: tilesY + TILE_H + MARGIN,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    nodes: [
      ...areas,
      ...flows,
      ...copies,
      tile('total-running', tileAt(0), tilesY, tileW, 'Running now', `concat(sum(${codes.map((c) => `${tag(c, 'status')} == "running" ? 1 : 0`).join(', ')}), " of ${codes.length}")`),
      tile('total-parts', tileAt(1), tilesY, tileW, 'Parts made', `concat(round(${sumOf('count')}))`),
      tile('total-rate', tileAt(2), tilesY, tileW, 'Output rate', `concat(round(${sumOf('speed')} * 60), " /h")`),
      tile('total-power', tileAt(3), tilesY, tileW, 'Power draw', `concat(round(${sumOf('power')}, 1), " kW")`),
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
          source: `pick(state.code, ${sourceByCode}, "")`,
          // The register stores parts per hour; the symbol wants parts per minute
          target: `${REC} && ${REC}.hourly_target ? ${REC}.hourly_target / 60 : 0`,
          maxTemperature: `${REC} && ${REC}.max_temperature ? ${REC}.max_temperature : 100`,
        },
      }),
    ],
  };
}
