/**
 * Process overview: the whole simulated process area on one screen, every value live from the
 * "Process area · MQTT" connection (process.* tags):
 *   storage tanks TK-11/12/13 → blend tank TK-20 → conditioners C-1/2/3 → day tank TK-30
 *   → screens S-1/S-2 (rejects to TK-60) → feed tank TK-40 (+ additives) → line unit U-1
 *   → drain water to recovery tank TK-50, pumped back to the blend tank
 */
import type { VisualDefinition, VisualNode } from '@config-platform/schema';
import { ADDITIVE, conditioner, FACE, INK, LIQUID, P, pipe, pump, reading, readout, REJECT, screenVessel, tank, WATER } from './process-parts.js';
import { group, shape, text } from './shapes.js';

export const PROCESS_OVERVIEW_NAME = 'Process overview';
const W = 1600;
const H = 900;

const running = (path: string) => `${P(path)} == "running"`;
const flowing = (path: string) => `${P(path)} > 0`;

function storage(): VisualNode[] {
  const tanks: Array<[string, string, string, number]> = [['tk11', 'TK-11', 'Storage A', 40], ['tk12', 'TK-12', 'Storage B', 170], ['tk13', 'TK-13', 'Storage C', 300]];
  return tanks.flatMap(([base, tag, title, x]) => {
    const cx = x + 45;
    return [
      pipe(`${base}-out`, `${cx},262 ${cx},${286}`, running(`${base}.pump`)),
      pipe(`${base}-dis`, `${cx},${314} ${cx},345`, flowing(`${base}.flow`)),
      tank(base, x, 120, 90, 140, base, tag, title),
      pump(`p${base.slice(2)}`, cx, 300, P(`${base}.pump`), `P-${base.slice(2)}`, 'right', 'down'),
      readout(`${base}-solids`, x + 8, 130 + 140 - 40, P(`${base}.solids`), '%', { w: 74, decimals: 2 }),
    ];
  });
}

function blend(): VisualNode[] {
  return [
    // Storage header into the top of the blend tank
    pipe('header', '85,345 440,345 440,150 478,150', `${P('tk11.flow')} + ${P('tk12.flow')} + ${P('tk13.flow')} > 0`),
    readout('blend-in', 340, 353, `${P('tk11.flow')} + ${P('tk12.flow')} + ${P('tk13.flow')}`, 'L/min', { w: 90, decimals: 0 }),
    tank('tk20', 480, 120, 130, 170, 'tk20', 'TK-20', 'Blend tank', { low: 15, high: 95 }),
    // Agitator: motor on top, shaft and a spinning impeller
    group('agitator', [
      shape('rect', 'agit-motor', { x: 578, y: 96, width: 24, height: 22, rx: 4, fill: 'var(--vis-grey)' }, { rules: [{ when: running('tk20.agitator'), set: { fill: 'var(--vis-on)' } }] }),
      shape('rect', 'agit-shaft', { x: 588.5, y: 118, width: 3, height: 136, fill: 'var(--vis-steel)' }),
      group('agit-blades', [
        shape('ellipse', 'agit-blade', { x: 590, y: 256, rx: 16, ry: 4, fill: 'var(--vis-steel)' }),
      ], {}, { name: 'Impeller', effects: [{ type: 'pulse', when: running('tk20.agitator'), speed: 2 }] }),
    ], {}, { name: 'Agitator' }),
    readout('tk20-temp', 476, 300, P('tk20.temperature'), '°C', { w: 56 }),
    readout('tk20-solids', 558, 300, P('tk20.solids'), '%', { w: 56, decimals: 2 }),
    pipe('tk20-out', '545,292 545,346', running('tk20.pump')),
    pump('p20', 545, 360, P('tk20.pump'), 'P-20', 'below'),
  ];
}

function conditioners(): VisualNode[] {
  const rows: Array<[string, string, number]> = [['c1', 'C-1', 120], ['c2', 'C-2', 205], ['c3', 'C-3', 290]];
  return [
    pipe('to-cond', '559,360 660,360 660,151', flowing('tk20.flow')),
    readout('tk20-flow', 572, 372, P('tk20.flow'), 'L/min', { w: 80, decimals: 0 }),
    ...rows.flatMap(([base, tag, y]) => [
      pipe(`${base}-in`, `660,${y + 31} 690,${y + 31}`, flowing(`${base}.flow`)),
      pipe(`${base}-outp`, `820,${y + 31} 850,${y + 31}`, flowing(`${base}.flow`)),
      conditioner(base, 690, y, base, tag),
    ]),
    pipe('cond-out', '850,321 850,150 898,150', `${P('c1.flow')} + ${P('c2.flow')} + ${P('c3.flow')} > 0`),
  ];
}

function screens(): VisualNode[] {
  return [
    tank('tk30', 900, 120, 110, 150, 'tk30', 'TK-30', 'Day tank'),
    pipe('tk30-out', '955,272 955,296', running('tk30.pump')),
    pump('p30', 955, 310, P('tk30.pump'), 'P-30', 'below'),
    pipe('to-screens', '969,310 1183,310 1183,262', flowing('tk30.flow')),
    pipe('to-s1', '1103,310 1103,262', flowing('tk30.flow')),
    readout('tk30-flow', 990, 318, P('tk30.flow'), 'L/min', { w: 80, decimals: 0 }),
    // Accepts out of the top, into the feed tank
    pipe('accepts', '1103,150 1103,72 1330,72 1330,118', flowing('tk30.flow')),
    pipe('s2-acc', '1183,150 1183,72', flowing('tk30.flow')),
    // Rejects to the reject tank
    pipe('s1-rej', '1126,240 1140,240 1140,398', `${P('s1.reject')} > 0`, REJECT, 5),
    pipe('s2-rej', '1206,240 1218,240 1218,380 1180,380 1180,398', `${P('s2.reject')} > 0`, REJECT, 5),
    screenVessel('s1', 1080, 150, 's1', 'S-1'),
    screenVessel('s2', 1160, 150, 's2', 'S-2'),
    readout('s1-in', 1014, 236, P('s1.inlet'), 'kPa', { w: 62, decimals: 0, label: 'SCREENS IN' }),
    tank('tk60', 1120, 400, 80, 80, 'tk60', 'TK-60', 'Rejects', { liquid: REJECT, low: -1, high: 85, labelsBelow: true }),
    readout('rej-flow', 1210, 410, `${P('s1.reject')} + ${P('s2.reject')}`, 'L/min', { w: 74, decimals: 0, label: 'REJECTS' }),
  ];
}

function feed(): VisualNode[] {
  const dosing = (id: string, y: number, base: string, tag: string, title: string): VisualNode[] => [
    pipe(`${id}-line`, `1456,${y} 1370,${y} 1370,340 1306,340`, running(`${base}.pump`), ADDITIVE, 5),
    group(`${id}-tote`, [
      shape('rect', `${id}-tote-body`, { width: 58, height: 46, rx: 6, fill: FACE, stroke: 'color-mix(in srgb, var(--vis-steel) 75%, var(--vis-dark))', strokeWidth: 1.5 }),
      shape('rect', `${id}-tote-liquid`, { x: 4, y: 18, width: 50, height: 24, rx: 4, fill: ADDITIVE, opacity: 0.55 }),
      text(`${id}-tote-tag`, 29, -6, title, 9, { textAnchor: 'middle', fontWeight: '700', fill: 'var(--vis-grey)' }),
    ], { x: 1500, y: y - 23 }, { name: title }),
    pump(id, 1470, y, P(`${base}.pump`), tag, 'below', 'left'),
    readout(`${id}-rate`, 1380, y - 30, P(`${base}.rate`), 'L/h', { w: 64 }),
  ];
  return [
    tank('tk40', 1250, 120, 100, 140, 'tk40', 'TK-40', 'Feed tank'),
    pipe('tk40-out', '1300,262 1300,286', running('tk40.pump')),
    pump('p40', 1300, 300, P('tk40.pump'), 'P-40', 'left', 'down'),
    ...dosing('a1', 160, 'add1', 'A-1', 'Additive A'),
    ...dosing('a2', 230, 'add2', 'A-2', 'Additive B'),
    // Down and along to the line unit's inlet
    pipe('to-unit', '1300,314 1300,530 330,530 330,566', flowing('tk40.flow')),
    readout('tk40-flow', 1310, 470, P('tk40.flow'), 'L/min', { w: 80, decimals: 0 }),
  ];
}

function lineUnit(): VisualNode[] {
  const zones = [1, 2, 3, 4, 5, 6];
  const dryers = [1, 2, 3, 4];
  const status = P('unit.status');
  const web = '360,640 1500,640';
  return [
    group('unit', [
      shape('rect', 'unit-body', { x: 300, y: 568, width: 1240, height: 170, rx: 18, fill: FACE, stroke: 'color-mix(in srgb, var(--vis-steel) 75%, var(--vis-dark))', strokeWidth: 1.5, shadow: true }),
      text('unit-tag', 320, 594, 'LINE UNIT U-1', 13, { fontWeight: '800', fill: INK }),
      text('unit-state', 434, 594, '—', 10, { fontWeight: '700', fill: 'var(--vis-grey)' }, {
        bindings: { text: `${status} == null ? "NO DATA" : upper(${status})` },
        rules: [{ when: `${status} == "running"`, set: { fill: 'var(--vis-on)' } }],
      }),
      // The product web running through the unit
      shape('polyline', 'web', { points: web, fill: 'none', stroke: LIQUID, strokeWidth: 4, strokeDasharray: '24 6', opacity: 0.8 }, { name: 'Web', effects: [{ type: 'flow', when: `${P('unit.speed')} > 0`, speed: 2.5 }] }),
      // Six vacuum zones: the bar grows with vacuum (0–50 kPa)
      ...zones.flatMap((z) => {
        const x = 360 + (z - 1) * 92;
        const v = P(`unit.zone${z}`);
        return [
          shape('rect', `zone${z}-box`, { x, y: 652, width: 80, height: 70, rx: 8, fill: 'color-mix(in srgb, var(--vis-steel) 12%, transparent)' }),
          shape('rect', `zone${z}-bar`, { x: x + 8, y: 716, width: 10, height: 0, rx: 3, fill: 'var(--vis-blue)' }, {
            bindings: { height: `clamp(${v}, 0, 50) / 50 * 54`, y: `716 - clamp(${v}, 0, 50) / 50 * 54` },
            smooth: 700,
          }),
          text(`zone${z}-l`, x + 26, 670, `ZONE ${z}`, 8, { fontWeight: '700', fill: 'var(--vis-grey)' }),
          text(`zone${z}-v`, x + 26, 696, '—', 14, { fontWeight: '800', fill: INK, fontFamily: 'monospace' }, { bindings: { text: `concat(round(${v}, 1))` } }),
          text(`zone${z}-u`, x + 26, 710, 'kPa vac', 7.5, { fill: 'var(--vis-grey)' }),
        ];
      }),
      // Four drying cylinders that turn with the line
      ...dryers.flatMap((d) => {
        const cx = 958 + (d - 1) * 104;
        const t = P(`unit.dry${d}`);
        return [
          group(`dry${d}`, [
            shape('ellipse', `dry${d}-drum`, { x: cx, y: 640, rx: 34, ry: 34, fill: 'url(#drum)', stroke: 'color-mix(in srgb, var(--vis-steel) 75%, var(--vis-dark))', strokeWidth: 1.5 }),
            shape('ellipse', `dry${d}-ring`, { x: cx, y: 640, rx: 24, ry: 24, fill: 'none', stroke: 'var(--vis-white)', strokeWidth: 2, strokeDasharray: '6 9', opacity: 0.8 }, { effects: [{ type: 'spin', when: `${P('unit.speed')} > 0`, speed: 1.5 }] }),
          ], {}, { name: `Dryer ${d}` }),
          text(`dry${d}-v`, cx, 700, '—', 13, { textAnchor: 'middle', fontWeight: '800', fill: INK, fontFamily: 'monospace' }, {
            bindings: { text: reading(t, '°C', 0) },
            rules: [{ when: `${t} > 115`, set: { fill: 'var(--vis-orange)' } }],
          }),
          text(`dry${d}-l`, cx, 714, `DRYER ${d}`, 8, { textAnchor: 'middle', fontWeight: '700', fill: 'var(--vis-grey)' }),
        ];
      }),
      // The finished roll, turning
      group('roll', [
        shape('ellipse', 'roll-body', { x: 1500, y: 640, rx: 26, ry: 26, fill: LIQUID, opacity: 0.85 }),
        shape('ellipse', 'roll-core', { x: 1500, y: 640, rx: 8, ry: 8, fill: 'var(--vis-white)' }),
        shape('rect', 'roll-mark', { x: 1498, y: 616, width: 4, height: 14, rx: 2, fill: 'var(--vis-white)' }),
      ], {}, { name: 'Roll', effects: [{ type: 'spin', when: `${P('unit.speed')} > 0`, speed: 1.2 }] }),
    ], {}, { name: 'Line unit U-1' }),
    // Speed, moisture and output on the unit's top edge
    readout('unit-speed', 640, 580, P('unit.speed'), 'm/min', { w: 96, decimals: 0, label: 'SPEED' }),
    readout('unit-moist', 750, 580, P('unit.moisture'), '%', { w: 70, label: 'MOISTURE', alarmWhen: `${P('unit.moisture')} > 7.5` }),
    readout('unit-output', 1420, 580, P('unit.output'), 't/h', { w: 80, decimals: 2, label: 'OUTPUT' }),
  ];
}

function recovery(): VisualNode[] {
  return [
    pipe('drain', '300,700 182,700', `${P('unit.speed')} > 0`, WATER),
    tank('tk50', 60, 580, 120, 150, 'tk50', 'TK-50', 'Recovery tank', { liquid: WATER }),
    pipe('tk50-out', '182,600 240,600 240,434', running('tk50.pump'), WATER),
    pump('p50', 240, 420, P('tk50.pump'), 'P-50', 'left', 'up'),
    pipe('return', '240,406 240,385 460,385 460,250 478,250', flowing('tk50.flow'), WATER),
    readout('tk50-flow', 262, 440, P('tk50.flow'), 'L/min', { w: 80, decimals: 0, label: 'RETURN' }),
  ];
}

/** Title, alarm count and the area's totals */
function chrome(): VisualNode[] {
  const alarms = P('totals.alarms');
  const totals: Array<[string, string]> = [
    ['Throughput', reading(P('totals.throughput'), 't/h')],
    ['Made today', reading(P('totals.made'), 't', 2)],
    ['Line speed', reading(P('unit.speed'), 'm/min', 0)],
    ['Power draw', reading(P('totals.power'), 'kW', 0)],
    ['Active alarms', `${alarms} == null ? "—" : concat(${alarms})`],
  ];
  const col = (W - 64) / totals.length;
  return [
    shape('rect', 'backdrop', { width: W, height: H, rx: 20, fill: 'color-mix(in srgb, var(--vis-floor) 70%, var(--vis-label-bg))' }, { locked: true }),
    text('title', 32, 46, 'PROCESS AREA 1', 24, { fontWeight: '800', fill: INK }),
    text('subtitle', 32, 66, 'Every value live from the control system (MQTT)', 11, { fill: 'var(--vis-grey)' }),
    group('alarm-badge', [
      shape('rect', 'alarm-pill', { width: 150, height: 34, rx: 17, fill: 'var(--vis-on)' }, { rules: [{ when: `${alarms} > 0`, set: { fill: 'var(--vis-alarm)' }, effect: 'pulse' }] }),
      text('alarm-text', 75, 22, 'NO ALARMS', 12, { textAnchor: 'middle', fontWeight: '800', fill: 'var(--vis-white)' }, {
        bindings: { text: `${alarms} > 0 ? concat(${alarms}, ${alarms} == 1 ? " ALARM" : " ALARMS") : "NO ALARMS"` },
      }),
    ], { x: W - 182, y: 26 }, { name: 'Alarm badge' }),
    group('totals', [
      shape('rect', 'totals-face', { width: W - 64, height: 84, rx: 16, fill: 'color-mix(in srgb, var(--vis-shade) 88%, var(--vis-blue))' }),
      ...totals.flatMap(([label, expr], i) => [
        text(`totals-${i}-l`, 28 + i * col, 32, label.toUpperCase(), 10, { fontWeight: '700', fill: 'color-mix(in srgb, var(--vis-light) 55%, transparent)' }),
        text(`totals-${i}-v`, 28 + i * col, 64, '—', 26, { fontWeight: '800', fill: 'var(--vis-light)' }, {
          name: label,
          bindings: { text: expr },
          ...(label === 'Active alarms' ? { rules: [{ when: `${alarms} > 0`, set: { fill: 'var(--vis-alarm)' }, effect: 'blink' as const }] } : {}),
        }),
      ]),
    ], { x: 32, y: H - 116 }, { name: 'Area totals' }),
  ];
}

export function processOverview(): VisualDefinition {
  return {
    version: 2,
    width: W,
    height: H,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    paints: [
      { id: 'drum', type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: 'color-mix(in srgb, var(--vis-steel) 50%, var(--vis-light))' }, { offset: 1, color: 'color-mix(in srgb, var(--vis-steel) 85%, var(--vis-dark))' }] },
    ],
    nodes: [...chrome(), ...recovery(), ...storage(), ...blend(), ...conditioners(), ...screens(), ...feed(), ...lineUnit()],
  };
}
