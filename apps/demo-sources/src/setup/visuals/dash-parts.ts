/**
 * Dashboard parts drawn as shapes, so a visual can be a live dashboard: cards, donut charts
 * (circle outlines cut into dashes, each turned to start where the last one ended), bar lists,
 * a line chart and pills. Every part takes the live expressions it shows.
 */
import type { VisualNode } from '@config-platform/schema';
import { group, shape, text } from './shapes.js';

export const O = (path: string) => `live.orders.${path}`;

export const INK = 'var(--vis-label)';
export const MUTED = 'var(--vis-grey)';
export const CARD = 'var(--vis-label-bg)';
export const ACCENT = 'color-mix(in srgb, var(--vis-blue) 55%, var(--vis-red))';
export const SERIES = [ACCENT, 'var(--vis-green)', 'var(--vis-yellow)', 'var(--vis-orange)', 'color-mix(in srgb, var(--vis-red) 60%, var(--vis-light))', 'var(--vis-blue)'];
export const tintOf = (colour: string, pct: number, base = CARD) => `color-mix(in srgb, ${colour} ${pct}%, ${base})`;

/** 128400 → "128.4k" */
export const kilo = (expr: string) => `${expr} == null ? "—" : concat(round(${expr} / 1000, 1), "k")`;
export const whole = (expr: string) => `${expr} == null ? "—" : concat(round(${expr}))`;

export function card(id: string, x: number, y: number, w: number, h: number, title: string, children: VisualNode[], fill = CARD): VisualNode {
  return group(id, [
    shape('rect', `${id}-bg`, { width: w, height: h, rx: 18, fill, stroke: 'color-mix(in srgb, var(--vis-steel) 22%, transparent)', strokeWidth: 1, shadow: true }),
    ...(title ? [text(`${id}-title`, 22, 34, title, 16, { fontWeight: '700', fill: INK })] : []),
    ...children,
  ], { x, y }, { name: title || id });
}

/** A rounded label with a coloured background: a status, a tier, a change */
export function pill(id: string, x: number, y: number, w: number, textExpr: string, colourRules: Array<[when: string, colour: string]>, fallback = MUTED, size = 10): VisualNode {
  return group(id, [
    shape('rect', `${id}-bg`, { width: w, height: size + 10, rx: (size + 10) / 2, fill: tintOf(fallback, 18) }, { rules: colourRules.map(([when, c]) => ({ when, set: { fill: tintOf(c, 22) } })) }),
    text(`${id}-t`, w / 2, size + 4, '—', size, { textAnchor: 'middle', fontWeight: '700', fill: fallback }, {
      bindings: { text: textExpr },
      rules: colourRules.map(([when, c]) => ({ when, set: { fill: `color-mix(in srgb, ${c} 80%, var(--vis-label))` } })),
    }),
  ], { x, y });
}

/** A donut: one dashed circle outline per share (shares in %) */
export function donut(id: string, cx: number, cy: number, r: number, thickness: number, shares: string[], colours = SERIES): VisualNode {
  const C = 2 * Math.PI * r;
  return group(id, [
    shape('ellipse', `${id}-track`, { x: cx, y: cy, rx: r, ry: r, fill: 'none', stroke: 'color-mix(in srgb, var(--vis-steel) 15%, transparent)', strokeWidth: thickness }),
    ...shares.map((share, i) => {
      const before = shares.slice(0, i);
      return shape('ellipse', `${id}-s${i}`, { x: cx, y: cy, rx: r, ry: r, fill: 'none', stroke: colours[i % colours.length], strokeWidth: thickness, strokeDasharray: `0 ${C}`, pivot: 'center' }, {
        bindings: {
          strokeDasharray: `concat(max(0, ${share} / 100 * ${C.toFixed(2)} - 2.5), " ", ${C.toFixed(2)})`,
          rotate: before.length ? `-90 + 3.6 * (${before.join(' + ')})` : '-90',
        },
      });
    }),
  ], {}, { name: `Donut ${id}` });
}

/** Legend rows beside a donut: dot, label, "34% (425)" */
export function legend(id: string, x: number, y: number, rows: Array<{ label: string; pct: string; count: string }>, colours = SERIES, gap = 30, valueX = 120): VisualNode {
  return group(id, rows.flatMap((row, i) => [
    shape('ellipse', `${id}-dot${i}`, { x: 6, y: i * gap - 4, rx: 6, ry: 6, fill: colours[i % colours.length] }),
    text(`${id}-l${i}`, 20, i * gap, row.label, 13, { fontWeight: '600', fill: INK }),
    text(`${id}-v${i}`, valueX, i * gap, '—', 13, { fill: MUTED, fontFamily: 'monospace' }, { bindings: { text: `concat(round(${row.pct}), "% (", ${row.count}, ")")` } }),
  ]), { x, y }, { name: `Legend ${id}` });
}

/** Horizontal bars, longest = the biggest count */
export function barList(id: string, x: number, y: number, labelW: number, barW: number, rows: Array<{ label: string; pct: string; count: string }>, colour = ACCENT, gap = 30): VisualNode {
  const biggest = `max(${rows.map((r) => r.count).join(', ')}, 1)`;
  return group(id, rows.flatMap((row, i) => {
    const width = `${row.count} / ${biggest} * ${barW}`;
    return [
      text(`${id}-l${i}`, labelW - 12, i * gap + 14, row.label, 13, { textAnchor: 'end', fontWeight: '600', fill: INK }),
      shape('rect', `${id}-b${i}`, { x: labelW, y: i * gap, width: 0, height: 20, rx: 5, fill: i === rows.length - 1 ? tintOf(colour, 55) : colour }, { bindings: { width }, smooth: 700 }),
      text(`${id}-v${i}`, labelW + 8, i * gap + 15, '—', 12.5, { fontWeight: '600', fill: INK, fontFamily: 'monospace' }, {
        bindings: { x: `${labelW + 8} + ${width}`, text: `concat(${row.count}, " (", round(${row.pct}), "%)")` },
        smooth: 700,
      }),
    ];
  }), { x, y }, { name: `Bars ${id}` });
}

/** A line chart over evenly spaced points: segments, a soft area under them, dots and labels */
export function lineChart(id: string, x: number, y: number, w: number, h: number, values: string[], labels: string[], peak: string, colour = ACCENT): VisualNode {
  const step = w / (values.length - 1);
  const top = `${peak} * 1.15`;
  const yOf = (v: string) => `${h} - ${v} / (${top}) * ${h}`;
  const nodes: VisualNode[] = [];
  // Grid lines at a quarter, half and three quarters of the top, labelled
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    nodes.push(shape('line', `${id}-g${f}`, { x1: 0, y1: h - f * h, x2: w, y2: h - f * h, stroke: 'color-mix(in srgb, var(--vis-steel) 20%, transparent)', strokeWidth: 1 }));
    nodes.push(text(`${id}-gl${f}`, -10, h - f * h + 4, '', 10, { textAnchor: 'end', fill: MUTED }, { bindings: { text: f === 0 ? '"0"' : kilo(`${top} * ${f}`) } }));
  }
  values.forEach((v, i) => {
    if (i < values.length - 1) {
      const x1 = i * step;
      const x2 = (i + 1) * step;
      const next = values[i + 1];
      nodes.push(shape('polygon', `${id}-a${i}`, { points: `${x1},${h} ${x2},${h} ${x2},${h} ${x1},${h}`, fill: colour, opacity: 0.12, stroke: 'none' }, {
        bindings: { points: `concat("${x1},${h} ${x1},", ${yOf(v)}, " ${x2},", ${yOf(next)}, " ${x2},${h}")` },
      }));
      nodes.push(shape('line', `${id}-s${i}`, { x1, y1: h, x2, y2: h, stroke: colour, strokeWidth: 3, strokeLinecap: 'round' }, { bindings: { y1: yOf(v), y2: yOf(next) }, smooth: 700 }));
    }
  });
  values.forEach((v, i) => {
    nodes.push(shape('ellipse', `${id}-d${i}`, { x: i * step, y: h, rx: 4.5, ry: 4.5, fill: CARD, stroke: colour, strokeWidth: 2.5 }, { bindings: { y: yOf(v) }, smooth: 700 }));
    nodes.push(text(`${id}-x${i}`, i * step, h + 20, '', 10, { textAnchor: 'middle', fill: MUTED }, { bindings: { text: labels[i] } }));
  });
  // The latest value, called out above its dot
  const last = values[values.length - 1];
  nodes.push(group(`${id}-callout`, [
    shape('rect', `${id}-callout-bg`, { x: -30, y: -34, width: 60, height: 22, rx: 11, fill: tintOf(colour, 20) }),
    text(`${id}-callout-t`, 0, -19, '—', 11.5, { textAnchor: 'middle', fontWeight: '700', fill: colour }, { bindings: { text: kilo(last) } }),
  ], { x: (values.length - 1) * step - 20, y: h }, { name: 'Latest value', bindings: { y: yOf(last) }, smooth: 700 }));
  return group(id, nodes, { x, y }, { name: `Line chart ${id}` });
}
