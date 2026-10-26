/**
 * Order desk: a sales dashboard drawn as one visual, every figure live from the "Order desk · MQTT"
 * connection (orders.* tags), so it moves the moment an order comes in or ships:
 *   three headline tiles · product lines (donut) · revenue over twelve months (line) · order types
 *   (bars) · the five newest orders · regions (bars) · statuses (donut) · revenue by tier per month
 *   (heat map)
 */
import type { VisualDefinition, VisualNode } from '@config-platform/schema';
import { ORDER_STATUSES, ORDER_TYPES, PRODUCT_LINES, REGIONS, STATUS_LABELS, TIERS, type Choice } from '../../orders/order-catalog.js';
import { RECENT_COUNT } from '../../orders/order-summary.js';
import { ACCENT, barList, card, CARD, donut, INK, kilo, legend, lineChart, MUTED, O, pill, SERIES, tintOf, whole } from './dash-parts.js';
import { group, shape, text } from './shapes.js';

export const ORDER_DESK_NAME = 'Order desk';
const W = 1600;
const H = 1160;
const M = 24;
const GAP = 20;
const MONTHS = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);

const rowsOf = (choices: readonly Choice[], group: string) => choices.map(([v, label]) => ({ label, pct: O(`${group}.${v}.pct`), count: O(`${group}.${v}.count`) }));

const STATUS_COLOURS: Record<string, string> = { pending: 'var(--vis-yellow)', processing: 'var(--vis-blue)', shipped: ACCENT, fulfilled: 'var(--vis-green)', cancelled: 'var(--vis-red)' };
const statusRules = (expr: string): Array<[string, string]> => ORDER_STATUSES.map((s) => [`${expr} == "${s}"`, STATUS_COLOURS[s]]);
const changeChip = (id: string, x: number, y: number, change: string) =>
  pill(id, x, y, 190, `${change} == null ? "—" : concat(${change} >= 0 ? "+" : "", ${change}, "% vs last year")`, [[`${change} >= 0`, 'var(--vis-green)'], [`${change} < 0`, 'var(--vis-red)']], MUTED, 13);

function header(): VisualNode[] {
  return [
    shape('rect', 'backdrop', { width: W, height: H, rx: 22, fill: tintOf(ACCENT, 6, 'color-mix(in srgb, var(--vis-floor) 55%, var(--vis-label-bg))') }, { locked: true }),
    group('logo', [
      shape('rect', 'logo-bg', { width: 52, height: 52, rx: 14, fill: ACCENT }),
      shape('polyline', 'logo-mark', { points: '13,34 22,24 30,30 40,17', fill: 'none', stroke: 'var(--vis-white)', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ], { x: M, y: 22 }, { name: 'Logo' }),
    text('title', M + 70, 50, 'Order Desk', 30, { fontWeight: '800', fill: INK }),
    text('subtitle', M + 70, 72, 'Sales performance · every figure live from the order system', 13, { fill: MUTED }),
    group('today', [
      shape('rect', 'today-bg', { width: 300, height: 52, rx: 14, fill: CARD, shadow: true }),
      shape('ellipse', 'today-dot', { x: 22, y: 26, rx: 6, ry: 6, fill: 'var(--vis-on)' }, { effects: [{ type: 'pulse', speed: 1 }] }),
      text('today-l', 38, 21, 'TODAY', 10, { fontWeight: '700', fill: MUTED }),
      text('today-v', 38, 40, '—', 15, { fontWeight: '800', fill: INK }, { bindings: { text: `concat(${O('today.orders')}, ${O('today.orders')} == 1 ? " order · " : " orders · ", ${kilo(O('today.revenue'))})` } }),
    ], { x: W - M - 300, y: 22 }, { name: 'Today' }),
  ];
}

function tiles(y: number, h: number): VisualNode[] {
  const w = (W - 2 * M - 2 * GAP) / 3;
  const big = (id: string, expr: string) => text(id, 26, 74, '—', 48, { fontWeight: '800', fill: INK }, { bindings: { text: whole(expr) } });
  const bar = (id: string, x: number, yy: number, bw: number, pct: string, colour: string): VisualNode[] => [
    shape('rect', `${id}-track`, { x, y: yy, width: bw, height: 10, rx: 5, fill: tintOf(colour, 15, 'var(--vis-label-bg)') }),
    shape('rect', `${id}-fill`, { x, y: yy, width: 0, height: 10, rx: 5, fill: colour }, { bindings: { width: `clamp(${pct}, 0, 100) / 100 * ${bw}` }, smooth: 800 }),
  ];
  // Orders per month as small bars, the current month darker
  const spark = MONTHS.map((m, i) =>
    shape('rect', `spark-${m}`, { x: w - 250 + i * 19, y: 120, width: 13, height: 0, rx: 3, fill: i === 11 ? ACCENT : tintOf(ACCENT, 40) }, {
      bindings: { height: `${O(`month.${m}.orders`)} / ${O('peak.orders')} * 80`, y: `120 - ${O(`month.${m}.orders`)} / ${O('peak.orders')} * 80` },
      smooth: 700,
    }),
  );
  return [
    card('tile-orders', M, y, w, h, '', [
      big('orders-v', O('ytd.orders')),
      text('orders-l', 26, 104, 'Orders this year', 19, { fontWeight: '600', fill: INK }),
      changeChip('orders-chip', 26, 124, O('ytd.change')),
      text('orders-note', 26, 176, 'against the same weeks last year', 12, { fill: MUTED }),
      ...spark,
      text('spark-l', w - 250, 142, 'Orders per month, last 12', 10, { fill: MUTED }),
    ]),
    card('tile-open', M + w + GAP, y, w, h, '', [
      big('open-v', O('open.orders')),
      text('open-l', 26, 104, 'Open orders', 19, { fontWeight: '600', fill: INK }),
      text('open-worth', 26, 136, '—', 15, { fill: INK }, { bindings: { text: `concat("worth ", ${kilo(O('open.value'))}, " · ", round(${O('open.shipped')}), "% already shipped")` } }),
      ...bar('open-bar', 26, 156, w - 52, O('open.shipped'), 'var(--vis-blue)'),
    ], tintOf('var(--vis-blue)', 9)),
    card('tile-done', M + 2 * (w + GAP), y, w, h, '', [
      big('done-v', O('fulfilled.orders')),
      text('done-l', 26, 104, 'Fulfilled this year', 19, { fontWeight: '600', fill: INK }),
      changeChip('done-chip', 26, 124, O('fulfilled.change')),
      text('done-rate', 26, 182, '—', 15, { fill: INK }, { bindings: { text: `concat(round(${O('fulfilled.rate')}), "% fulfilment rate")` } }),
      ...bar('done-bar', 230, 172, w - 256, O('fulfilled.rate'), 'var(--vis-orange)'),
    ], tintOf('var(--vis-orange)', 9)),
  ];
}

function middle(y: number, h: number): VisualNode[] {
  const w = (W - 2 * M - 2 * GAP) / 3;
  const products = rowsOf(PRODUCT_LINES, 'product');
  return [
    card('by-product', M, y, w, h, 'Sales by product line', [
      donut('product-donut', 120, 160, 74, 30, products.map((r) => r.pct)),
      text('product-total', 120, 166, '—', 24, { textAnchor: 'middle', fontWeight: '800', fill: INK }, { bindings: { text: whole(O('ytd.orders')) } }),
      text('product-total-l', 120, 184, 'orders', 11, { textAnchor: 'middle', fill: MUTED }),
      legend('product-legend', 236, 92, products, SERIES, 32, 118),
      text('product-note', 22, h - 18, 'This year, by number of orders', 11, { fill: MUTED }),
    ]),
    card('revenue', M + w + GAP, y, w, h, 'Revenue over time', [
      text('revenue-sub', 22, 54, 'Last twelve months', 12, { fill: MUTED }),
      lineChart('revenue-chart', 64, 84, w - 96, h - 132, MONTHS.map((m) => O(`month.${m}.revenue`)), MONTHS.map((m) => O(`month.${m}.label`)), O('peak.revenue')),
    ]),
    card('by-type', M + 2 * (w + GAP), y, w, h, 'Orders by type', [
      barList('type-bars', 22, 70, 120, w - 250, rowsOf(ORDER_TYPES, 'type'), ACCENT, 31),
    ]),
  ];
}

function lower(y: number, h: number): VisualNode[] {
  const tableW = 600;
  const w = (W - 2 * M - 2 * GAP - tableW) / 2;
  const cols = { order: 22, customer: 168, tier: 352, status: 448, amount: tableW - 22 };
  const rows = Array.from({ length: RECENT_COUNT }, (_, i) => {
    const r = (k: string) => O(`recent.r${i + 1}.${k}`);
    const ry = 92 + i * 34;
    return group(`recent-r${i + 1}`, [
      shape('rect', `recent-r${i + 1}-bg`, { x: 12, y: ry - 22, width: tableW - 24, height: 32, rx: 8, fill: i % 2 ? 'none' : 'color-mix(in srgb, var(--vis-steel) 7%, transparent)' }),
      text(`recent-r${i + 1}-no`, cols.order, ry, '—', 12, { fontWeight: '700', fill: INK, fontFamily: 'monospace' }, { bindings: { text: r('order_no') } }),
      text(`recent-r${i + 1}-cust`, cols.customer, ry, '—', 12.5, { fill: INK }, { bindings: { text: r('customer') } }),
      pill(`recent-r${i + 1}-tier`, cols.tier, ry - 15, 86, r('tier'), [[`${r('tier')} == "Key account"`, ACCENT], [`${r('tier')} == "Mid-size"`, 'var(--vis-blue)'], [`${r('tier')} == "Small"`, 'var(--vis-orange)']], MUTED, 10),
      pill(`recent-r${i + 1}-status`, cols.status, ry - 15, 86, `pick(${r('status')}, ${ORDER_STATUSES.map((s) => `"${s}", "${STATUS_LABELS[s]}"`).join(', ')}, "—")`, statusRules(r('status')), MUTED, 10),
      text(`recent-r${i + 1}-amt`, cols.amount, ry, '—', 13, { textAnchor: 'end', fontWeight: '700', fill: INK, fontFamily: 'monospace' }, { bindings: { text: `${r('amount')} == null ? "—" : concat(${r('amount')})` } }),
    ], {}, { name: `Order ${i + 1}` });
  });
  const statuses = ORDER_STATUSES.map((s) => ({ label: STATUS_LABELS[s], pct: O(`status.${s}.pct`), count: O(`status.${s}.count`) }));
  const statusColours = ORDER_STATUSES.map((s) => STATUS_COLOURS[s]);
  return [
    card('recent', M, y, tableW, h, 'Newest orders', [
      ...Object.entries({ order: 'ORDER', customer: 'CUSTOMER', tier: 'TIER', status: 'STATUS', amount: 'AMOUNT' }).map(([k, label]) =>
        text(`recent-h-${k}`, cols[k as keyof typeof cols] + (k === 'tier' || k === 'status' ? 43 : 0), 58, label, 10, { fontWeight: '700', fill: MUTED, textAnchor: k === 'amount' ? 'end' : k === 'tier' || k === 'status' ? 'middle' : 'start' }),
      ),
      ...rows,
    ]),
    card('by-region', M + tableW + GAP, y, w, h, 'Orders by region', [barList('region-bars', 22, 60, 96, w - 210, rowsOf(REGIONS, 'region'), ACCENT, 31)]),
    card('by-status', M + tableW + GAP + w + GAP, y, w, h, 'Orders by status', [
      donut('status-donut', 110, 150, 66, 28, statuses.map((r) => r.pct), statusColours),
      legend('status-legend', 210, 92, statuses, statusColours, 30, 96),
    ]),
  ];
}

function heatmap(y: number, h: number): VisualNode {
  const labelW = 130;
  const cellW = (W - 2 * M - 44 - labelW) / 12;
  const cellH = 34;
  const top = 74;
  const peak = O('peak.tier');
  const cells = TIERS.flatMap(([tier, label], r) => [
    text(`heat-${tier}-l`, 22, top + r * (cellH + 6) + 22, label, 13, { fontWeight: '600', fill: INK }),
    ...MONTHS.map((m, i) => {
      const v = O(`tier.${tier}.${m}`);
      const x = 22 + labelW + i * cellW;
      const cy = top + r * (cellH + 6);
      return group(`heat-${tier}-${m}`, [
        shape('rect', `heat-${tier}-${m}-c`, { x, y: cy, width: cellW - 6, height: cellH, rx: 7, fill: tintOf(ACCENT, 10) }, {
          bindings: { fill: `concat("color-mix(in srgb, ${ACCENT} ", round(scale(${v}, 0, ${peak}, 8, 92)), "%, var(--vis-label-bg))")` },
        }),
        text(`heat-${tier}-${m}-v`, x + (cellW - 6) / 2, cy + 22, '—', 12, { textAnchor: 'middle', fontWeight: '700', fill: INK }, {
          bindings: { text: kilo(v) },
          rules: [{ when: `${v} > ${peak} * 0.55`, set: { fill: 'var(--vis-white)' } }],
        }),
      ]);
    }),
  ]);
  const months = MONTHS.map((m, i) => text(`heat-h-${m}`, 22 + labelW + i * cellW + (cellW - 6) / 2, top - 12, '', 11, { textAnchor: 'middle', fontWeight: '700', fill: MUTED }, { bindings: { text: O(`month.${m}.label`) } }));
  return card('heat', M, y, W - 2 * M, h, 'Monthly revenue by customer tier', [
    ...months,
    ...cells,
    shape('rect', 'heat-scale', { x: W - 2 * M - 342, y: 22, width: 220, height: 10, rx: 5, fill: 'url(#heat)' }),
    text('heat-scale-l', W - 2 * M - 352, 32, 'lower', 11, { textAnchor: 'end', fill: MUTED }),
    text('heat-scale-h', W - 2 * M - 112, 32, 'higher', 11, { fill: MUTED }),
  ]);
}

export function orderDesk(): VisualDefinition {
  return {
    version: 2,
    width: W,
    height: H,
    mode: 'flat',
    grid: true,
    gridSize: 4,
    paints: [{ id: 'heat', type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: tintOf(ACCENT, 8) }, { offset: 1, color: tintOf(ACCENT, 92) }] }],
    nodes: [...header(), ...tiles(100, 210), ...middle(330, 290), ...lower(640, 270), heatmap(930, 206)],
  };
}
