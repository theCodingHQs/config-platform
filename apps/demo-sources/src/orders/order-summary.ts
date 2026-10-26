/**
 * The order desk's figures, as its reporting feed would publish them: this year against the same
 * part of last year, the last twelve months (m1 = eleven months ago … m12 = this month), shares by
 * product line, order type, region and status, revenue by customer tier per month, and the five
 * newest orders. Every number is worked out from the order book each time.
 */
import { OPEN_STATUSES, ORDER_STATUSES, ORDER_TYPES, PRODUCT_LINES, REGIONS, TIERS, labelOf, type Choice } from './order-catalog.js';
import type { Order } from './order-book.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const RECENT_COUNT = 5;

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const change = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : 0);
const sumAmount = (orders: Order[]) => orders.reduce((s, o) => s + o.amount, 0);

/** count and share of each choice: { housings: { count: 412, pct: 34.1 }, … } */
function shares(orders: Order[], choices: readonly Choice[] | readonly string[], key: (o: Order) => string) {
  const out: Record<string, { count: number; pct: number }> = {};
  for (const c of choices) {
    const value = typeof c === 'string' ? c : c[0];
    const count = orders.filter((o) => key(o) === value).length;
    out[value] = { count, pct: pct(count, orders.length) };
  }
  return out;
}

export function orderSummary(orders: readonly Order[], now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const sameTimeLastYear = Date.UTC(year - 1, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  const thisYear = orders.filter((o) => o.at >= yearStart && o.at <= now);
  const lastYearSoFar = orders.filter((o) => o.at >= Date.UTC(year - 1, 0, 1) && o.at <= sameTimeLastYear);
  const fulfilled = (list: Order[]) => list.filter((o) => o.status === 'fulfilled');
  const open = thisYear.filter((o) => OPEN_STATUSES.includes(o.status));
  const closed = thisYear.filter((o) => o.status === 'fulfilled' || o.status === 'cancelled');
  const today = orders.filter((o) => o.at >= Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));

  const month: Record<string, { label: string; orders: number; revenue: number }> = {};
  const tier: Record<string, Record<string, number>> = Object.fromEntries(TIERS.map(([t]) => [t, {}]));
  for (let i = 1; i <= 12; i++) {
    const from = Date.UTC(year, d.getUTCMonth() - (12 - i), 1);
    const to = Date.UTC(year, d.getUTCMonth() - (11 - i), 1);
    const inMonth = orders.filter((o) => o.at >= from && o.at < to);
    const label = MONTHS[new Date(from).getUTCMonth()];
    month[`m${i}`] = { label: i === 1 || label === 'Jan' ? `${label} ${String(new Date(from).getUTCFullYear()).slice(2)}` : label, orders: inMonth.length, revenue: sumAmount(inMonth) };
    for (const [t] of TIERS) tier[t][`m${i}`] = sumAmount(inMonth.filter((o) => o.tier === t));
  }
  const months = Object.values(month);
  const newest = [...orders].sort((a, b) => b.at - a.at).slice(0, RECENT_COUNT);

  return {
    ytd: { orders: thisYear.length, change: change(thisYear.length, lastYearSoFar.length), revenue: sumAmount(thisYear), revenueChange: change(sumAmount(thisYear), sumAmount(lastYearSoFar)) },
    open: { orders: open.length, value: sumAmount(open), shipped: pct(open.filter((o) => o.status === 'shipped').length, open.length) },
    fulfilled: { orders: fulfilled(thisYear).length, change: change(fulfilled(thisYear).length, fulfilled(lastYearSoFar).length), rate: pct(fulfilled(thisYear).length, closed.length) },
    today: { orders: today.length, revenue: sumAmount(today) },
    month,
    peak: {
      orders: Math.max(1, ...months.map((m) => m.orders)),
      revenue: Math.max(1, ...months.map((m) => m.revenue)),
      tier: Math.max(1, ...Object.values(tier).flatMap((byMonth) => Object.values(byMonth))),
    },
    product: shares(thisYear, PRODUCT_LINES, (o) => o.product),
    type: shares(thisYear, ORDER_TYPES, (o) => o.orderType),
    region: shares(thisYear, REGIONS, (o) => o.region),
    status: shares(thisYear, ORDER_STATUSES, (o) => o.status),
    tier,
    recent: Object.fromEntries(
      newest.map((o, i) => [`r${i + 1}`, { order_no: o.orderNo, customer: o.customer, product: labelOf(PRODUCT_LINES, o.product), tier: labelOf(TIERS, o.tier), status: o.status, amount: o.amount }]),
    ),
  };
}

export type OrderSummary = ReturnType<typeof orderSummary>;
