/**
 * The machines themselves, one drawing per type, all standing on the same floor line (y 150) in a
 * 172-wide space. What moves follows the machine's live inputs: a spindle or chuck turns while it
 * runs, the press ram comes down once per part made, the robot's torch sparks, spray flows, parts
 * ride the conveyor.
 */
import type { VisualNode } from '../../visuals/index.js';
import { ACCENT, DARK, EDGE, GLASS, ITEM, RUNNING, SHELL, STEEL, glare, screen, workGlow } from './style.js';
import { group, shape } from '../builder.js';

/** Machine types the symbol can draw (the machine register's Machine Type values) */
export const MACHINE_LOOKS = ['cnc', 'lathe', 'press', 'molding', 'welding', 'painting', 'assembly'] as const;
export type MachineLook = (typeof MACHINE_LOOKS)[number];

const rect = (id: string, x: number, y: number, width: number, height: number, fill: string, extra: Record<string, string | number> = {}) =>
  shape('rect', id, { x, y, width, height, rx: 2, fill, ...extra });
const circle = (id: string, x: number, y: number, r: number, fill: string, extra: Record<string, string | number> = {}) =>
  shape('ellipse', id, { x, y, rx: r, ry: r, fill, ...extra });
const bar = (id: string, x1: number, y1: number, x2: number, y2: number, stroke: string, width: number) =>
  shape('line', id, { x1, y1, x2, y2, stroke, strokeWidth: width, strokeLinecap: 'round' });

/** Vertical machining centre: an enclosure with a window, the spindle working a block inside */
function cnc(): VisualNode[] {
  return [
    rect('cnc-plinth', 16, 140, 140, 10, DARK, { rx: 3 }),
    rect('cnc-body', 20, 36, 132, 106, SHELL, { rx: 10, ...EDGE }),
    rect('cnc-stripe', 20, 46, 132, 4, ACCENT, { rx: 0 }),
    rect('cnc-window', 30, 58, 84, 72, GLASS, { rx: 6, ...EDGE }),
    rect('cnc-table', 40, 118, 64, 6, STEEL),
    rect('cnc-block', 52, 106, 40, 12, ITEM),
    workGlow('cnc-glow', 72, 105, 9, 3),
    group('cnc-spindle', [rect('cnc-head', 62, 58, 20, 26, DARK, { rx: 3 }), rect('cnc-tool', 69, 84, 6, 16, STEEL, { rx: 1 })], {}, { name: 'Spindle', effects: [{ type: 'shake', when: RUNNING }] }),
    glare('cnc-glare', 30, 58, 22),
    screen('cnc-screen', 122, 60, 22, 30),
    circle('cnc-start', 127, 102, 3, 'var(--vis-green)'),
    circle('cnc-stop', 139, 102, 3, 'var(--vis-red)'),
  ];
}

/** Lathe: headstock with a turning chuck, the bar being turned, a tool on its carriage, tailstock */
function lathe(): VisualNode[] {
  const jaws = [0, 120, 240].map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    return rect(`lathe-jaw${i}`, 74 + Math.cos(r) * 11 - 3, 88 + Math.sin(r) * 11 - 3, 6, 6, STEEL, { rx: 1 });
  });
  return [
    rect('lathe-plinth', 10, 140, 154, 10, DARK, { rx: 3 }),
    rect('lathe-bed', 12, 112, 150, 30, SHELL, { rx: 6, ...EDGE }),
    rect('lathe-stripe', 12, 119, 150, 4, ACCENT, { rx: 0 }),
    rect('lathe-head', 16, 54, 46, 60, SHELL, { rx: 8, ...EDGE }),
    rect('lathe-head-stripe', 16, 62, 46, 4, ACCENT, { rx: 0 }),
    screen('lathe-screen', 24, 74, 30, 22),
    rect('lathe-bar', 84, 82, 48, 12, ITEM),
    group('lathe-chuck', [circle('lathe-chuck-body', 74, 88, 18, DARK), ...jaws, circle('lathe-chuck-hub', 74, 88, 4.5, STEEL)], {}, { name: 'Chuck', effects: [{ type: 'spin', when: RUNNING, speed: 2.5 }] }),
    rect('lathe-tail', 130, 68, 30, 46, SHELL, { rx: 6, ...EDGE }),
    rect('lathe-quill', 124, 84, 8, 8, STEEL, { rx: 1 }),
    workGlow('lathe-glow', 108, 95, 7, 3),
    group('lathe-carriage', [
      rect('lathe-saddle', 96, 98, 28, 14, DARK, { rx: 2 }),
      shape('polygon', 'lathe-tool', { points: '104,98 110,91 116,98', fill: STEEL }),
    ], {}, { name: 'Carriage', effects: [{ type: 'shake', when: RUNNING, speed: 0.5 }] }),
  ];
}

/** Press: a crown on two columns, the ram coming down once for every part made */
function press(): VisualNode[] {
  const down = `${RUNNING} && inputs.count % 2 == 1`;
  return [
    rect('press-plinth', 18, 142, 136, 8, DARK, { rx: 3 }),
    rect('press-col-l', 28, 46, 18, 98, SHELL, { rx: 3, ...EDGE }),
    rect('press-col-r', 126, 46, 18, 98, SHELL, { rx: 3, ...EDGE }),
    rect('press-rod', 81, 46, 10, 40, STEEL),
    group('press-ram', [rect('press-ram-body', 0, 0, 72, 28, DARK, { rx: 4 }), rect('press-die-top', 7, 28, 58, 6, STEEL, { rx: 1 })], { x: 50, y: 54 }, {
      name: 'Ram',
      bindings: { y: `${down} ? 82 : 54` },
      smooth: 220,
    }),
    rect('press-die', 57, 116, 58, 8, STEEL, { rx: 1 }),
    shape('ellipse', 'press-flash', { x: 86, y: 118, rx: 30, ry: 3, fill: 'var(--vis-orange)', opacity: 0 }, { name: 'Strike', rules: [{ when: down, set: { opacity: 0.6 } }] }),
    rect('press-bed', 22, 124, 128, 20, SHELL, { rx: 4, ...EDGE }),
    rect('press-crown', 20, 18, 132, 32, SHELL, { rx: 8, ...EDGE }),
    rect('press-stripe', 20, 28, 132, 4, ACCENT, { rx: 0 }),
    screen('press-screen', 106, 35, 36, 12),
  ];
}

/** Injection molding: clamp and mould on the left, heated barrel and hopper on the right */
function molding(): VisualNode[] {
  // No fill of their own: they take the group's, which turns orange while heating
  const heater = (i: number, x: number) => shape('rect', `mold-heat${i}`, { x, y: 75, width: 8, height: 20, rx: 2 });
  return [
    rect('mold-plinth', 8, 140, 162, 10, DARK, { rx: 3 }),
    rect('mold-base', 10, 112, 158, 30, SHELL, { rx: 6, ...EDGE }),
    rect('mold-stripe', 10, 119, 158, 4, ACCENT, { rx: 0 }),
    screen('mold-screen', 132, 124, 28, 14),
    group('mold-ties', [bar('mold-tie1', 16, 64, 80, 64, 'var(--vis-steel)', 3), bar('mold-tie2', 16, 104, 80, 104, 'var(--vis-steel)', 3)]),
    rect('mold-platen-back', 16, 52, 12, 62, DARK),
    rect('mold-clamp', 28, 78, 26, 10, STEEL, { rx: 1 }),
    rect('mold-platen-move', 54, 52, 10, 62, DARK),
    rect('mold-tool', 64, 62, 10, 42, ITEM, { rx: 1 }),
    rect('mold-platen-fixed', 74, 52, 10, 62, DARK),
    shape('polygon', 'mold-nozzle', { points: '90,80 84,85 90,90', fill: DARK }),
    rect('mold-barrel', 90, 78, 56, 14, STEEL, { rx: 3 }),
    group('mold-heaters', [heater(1, 98), heater(2, 114), heater(3, 130)], { fill: 'color-mix(in srgb, var(--vis-steel) 50%, var(--vis-dark))' }, {
      name: 'Heater bands',
      rules: [{ when: RUNNING, set: { fill: 'var(--vis-orange)' }, effect: 'pulse' }],
    }),
    rect('mold-neck', 124, 64, 8, 14, DARK, { rx: 1 }),
    shape('polygon', 'mold-hopper', { points: '112,38 144,38 134,64 122,64', fill: SHELL, ...EDGE }),
    rect('mold-hopper-stripe', 113, 44, 30, 3, ACCENT, { rx: 0 }),
    rect('mold-drive', 146, 74, 20, 24, SHELL, { rx: 3, ...EDGE }),
  ];
}

/** Welding cell: a robot arm behind a glass guard, sparking where its torch meets the part */
function welding(): VisualNode[] {
  const arm = 'var(--vis-orange)';
  return [
    rect('weld-floor', 12, 138, 150, 12, DARK, { rx: 3 }),
    rect('weld-guard', 14, 34, 146, 104, 'color-mix(in srgb, var(--vis-glass) 35%, transparent)', { rx: 6, ...EDGE }),
    rect('weld-rail', 14, 34, 146, 6, 'var(--vis-yellow)', { rx: 3 }),
    rect('weld-table', 92, 112, 58, 8, STEEL),
    rect('weld-leg1', 98, 120, 6, 18, DARK, { rx: 1 }),
    rect('weld-leg2', 138, 120, 6, 18, DARK, { rx: 1 }),
    rect('weld-part', 100, 103, 42, 9, ITEM, { rx: 1 }),
    rect('weld-base', 34, 118, 30, 20, DARK, { rx: 4 }),
    shape('ellipse', 'weld-turret', { x: 49, y: 117, rx: 17, ry: 6, fill: SHELL, ...EDGE }),
    group('weld-arm', [
      bar('weld-lower', 49, 112, 66, 64, arm, 12),
      bar('weld-upper', 66, 64, 110, 82, arm, 9),
      circle('weld-j1', 49, 112, 7, DARK),
      circle('weld-j2', 66, 64, 7, DARK),
      bar('weld-torch', 110, 82, 118, 100, DARK, 4),
      circle('weld-wrist', 110, 82, 4.5, DARK),
    ], {}, { name: 'Robot arm', effects: [{ type: 'shake', when: RUNNING, speed: 0.4 }] }),
    group('weld-spark', [circle('weld-spark-glow', 119, 103, 12, 'var(--vis-orange)', { opacity: 0.35 }), circle('weld-spark-core', 119, 103, 3.5, 'var(--vis-yellow)')], {}, {
      name: 'Spark',
      bindings: { visible: RUNNING },
      effects: [{ type: 'blink', speed: 3 }],
    }),
    glare('weld-glare', 14, 40, 26),
  ];
}

/** Paint booth: the part hangs on a rail, jets spray while it runs, the extraction fan turns */
function painting(): VisualNode[] {
  const blades = [0, 60, 120].map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    return bar(`paint-blade${i}`, 128 - Math.cos(r) * 9, 22 - Math.sin(r) * 9, 128 + Math.cos(r) * 9, 22 + Math.sin(r) * 9, 'var(--vis-steel)', 3.5);
  });
  return [
    rect('paint-plinth', 14, 140, 144, 10, DARK, { rx: 3 }),
    rect('paint-duct', 40, 14, 30, 18, STEEL, { rx: 3 }),
    circle('paint-fan-ring', 128, 22, 13, DARK),
    group('paint-fan', blades, {}, { name: 'Fan', effects: [{ type: 'spin', when: RUNNING, speed: 2 }] }),
    rect('paint-booth', 18, 30, 136, 112, SHELL, { rx: 10, ...EDGE }),
    rect('paint-stripe', 18, 40, 136, 4, ACCENT, { rx: 0 }),
    rect('paint-window', 28, 52, 92, 80, GLASS, { rx: 6, ...EDGE }),
    bar('paint-rail', 32, 60, 116, 60, DARK, 3),
    bar('paint-hook', 86, 60, 86, 72, DARK, 1.5),
    rect('paint-part', 72, 72, 30, 40, ITEM, { rx: 3 }),
    rect('paint-gun', 32, 78, 8, 30, DARK, { rx: 2 }),
    group('paint-jets', [82, 92, 102].map((y, i) => bar(`paint-jet${i}`, 42, y - 2, 68, y, 'var(--vis-liquid)', 3)), { strokeDasharray: '2 5' }, {
      name: 'Spray',
      bindings: { visible: RUNNING },
      effects: [{ type: 'flow', speed: 1.5 }],
    }),
    glare('paint-glare', 28, 52, 22),
    screen('paint-screen', 126, 60, 20, 28),
  ];
}

/** Assembly station: a gantry with a pick-and-place head over a conveyor carrying parts */
function assembly(): VisualNode[] {
  return [
    rect('asm-plinth', 14, 140, 144, 10, DARK, { rx: 3 }),
    rect('asm-post-l', 22, 34, 8, 106, 'var(--vis-steel)', { rx: 1 }),
    rect('asm-post-r', 142, 34, 8, 106, 'var(--vis-steel)', { rx: 1 }),
    rect('asm-beam', 18, 28, 136, 14, SHELL, { rx: 4, ...EDGE }),
    rect('asm-stripe', 18, 36, 136, 3, ACCENT, { rx: 0 }),
    group('asm-head', [
      rect('asm-carriage', 66, 42, 26, 12, DARK, { rx: 2 }),
      rect('asm-arm', 76, 54, 6, 28, STEEL, { rx: 1 }),
      shape('polyline', 'asm-gripper', { points: '70,90 70,83 88,83 88,90', fill: 'none', stroke: DARK, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], {}, { name: 'Pick-and-place head', effects: [{ type: 'shake', when: RUNNING, speed: 0.3 }] }),
    rect('asm-belt', 14, 100, 144, 14, DARK, { rx: 7 }),
    shape('line', 'asm-belt-marks', { x1: 22, y1: 107, x2: 150, y2: 107, stroke: 'var(--vis-belt-mark)', strokeWidth: 2, strokeDasharray: '6 6' }, { effects: [{ type: 'flow', when: RUNNING }] }),
    shape('line', 'asm-items', { x1: 22, y1: 95, x2: 150, y2: 95, stroke: ITEM, strokeWidth: 10, strokeDasharray: '12 22' }, { name: 'Parts', effects: [{ type: 'flow', when: RUNNING, speed: 0.4 }] }),
    rect('asm-leg1', 32, 114, 6, 26, DARK, { rx: 1 }),
    rect('asm-leg2', 134, 114, 6, 26, DARK, { rx: 1 }),
    rect('asm-bin1', 46, 120, 24, 18, ACCENT, { rx: 3, opacity: 0.85 }),
    rect('asm-bin2', 102, 120, 24, 18, ACCENT, { rx: 3, opacity: 0.85 }),
    screen('asm-screen', 116, 46, 22, 14),
  ];
}

const DRAW: Record<MachineLook, () => VisualNode[]> = { cnc, lathe, press, molding, welding, painting, assembly };

/** Every look, each shown only while the symbol's `look` input names it (an unknown look shows the first) */
export function machineLooks(): VisualNode[] {
  return MACHINE_LOOKS.map((look, i) => {
    const when = i === 0 ? `inputs.look == "${look}" || !inputs.look` : `inputs.look == "${look}"`;
    return { ...group(`look-${look}`, DRAW[look](), {}, { name: `${look} look` }), bindings: { visible: when } };
  });
}
