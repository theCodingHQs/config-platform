/**
 * The simulated order desk's order book. Every day before today has a fixed history (the same
 * on every run, so `setup` and the running source agree on it); from the moment the source starts,
 * new orders come in every few seconds and open orders move on through their statuses.
 * Each change is handed out as an event, at most one new order and one status change per tick,
 * since a live tag holds one value at a time.
 */
import { CHANNELS, CUSTOMERS, ORDER_TYPES, PRODUCT_LINES, REGIONS, TIER_AMOUNTS, TIERS, type Choice, type OrderStatus } from './order-catalog.js';

export interface Order {
  orderNo: string;
  /** ms since 1970 */
  at: number;
  customer: string;
  product: string;
  orderType: string;
  region: string;
  tier: string;
  channel: string;
  quantity: number;
  amount: number;
  status: OrderStatus;
}

export interface StatusChange {
  orderNo: string;
  status: OrderStatus;
}

const DAY = 86_400_000;
/** The history starts here */
export const HISTORY_START = Date.UTC(2025, 0, 1);

/** Small, fast, seedable random numbers */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickWeighted = (choices: readonly Choice[], r: number): string => {
  const total = choices.reduce((s, c) => s + c[2], 0);
  let x = r * total;
  for (const [value, , weight] of choices) if ((x -= weight) < 0) return value;
  return choices[choices.length - 1][0];
};

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** SO-261026-51234: the date and the second of the day it came in (one order a second at most) */
export function orderNumber(at: number): string {
  const d = new Date(at);
  const secOfDay = Math.floor((at - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 1000);
  return `SO-${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(secOfDay, 5)}`;
}

/** A new order at `at`, its details drawn with `random` */
export function makeOrder(at: number, random: () => number, status: OrderStatus = 'pending'): Order {
  const tier = pickWeighted(TIERS, random());
  const [lo, hi] = TIER_AMOUNTS[tier];
  const quantity = 5 + Math.floor(random() * 120);
  return {
    orderNo: orderNumber(at),
    at,
    customer: CUSTOMERS[Math.floor(random() * CUSTOMERS.length)],
    product: pickWeighted(PRODUCT_LINES, random()),
    orderType: pickWeighted(ORDER_TYPES, random()),
    region: pickWeighted(REGIONS, random()),
    tier,
    channel: pickWeighted(CHANNELS, random()),
    quantity,
    amount: Math.round((lo + random() * (hi - lo)) / 10) * 10,
    status,
  };
}

/** Where an order of this age has got to by now (history only) */
function settledStatus(ageDays: number, r: number): OrderStatus {
  if (r < 0.03) return 'cancelled';
  if (ageDays < 1) return r < 0.5 ? 'pending' : 'processing';
  if (ageDays < 3) return r < 0.4 ? 'processing' : 'shipped';
  if (ageDays < 8) return r < 0.55 ? 'shipped' : 'fulfilled';
  return 'fulfilled';
}

/** The orders of one day, the same every time it's asked for */
export function ordersOfDay(dayStart: number, today: number): Order[] {
  const dayIndex = Math.round((dayStart - HISTORY_START) / DAY);
  const random = seededRandom(dayIndex * 7919 + 17);
  const weekday = new Date(dayStart).getUTCDay();
  // Business picks up over time; quieter at weekends
  const rate = (1.3 + dayIndex * 0.0018) * (weekday === 0 || weekday === 6 ? 0.35 : 1.2);
  const count = Math.floor(rate + random() * 1.6);
  const times = Array.from({ length: count }, () => dayStart + Math.floor((7 + random() * 11) * 3600) * 1000).sort((a, b) => a - b);
  return times.map((at, i) => {
    const order = makeOrder(at + i * 1000, random);
    return { ...order, status: settledStatus((today - dayStart) / DAY, random()) };
  });
}

/** Every order from HISTORY_START up to the start of the day `now` falls in */
export function orderHistory(now: number): Order[] {
  const today = Math.floor(now / DAY) * DAY;
  const orders: Order[] = [];
  for (let day = HISTORY_START; day < today; day += DAY) orders.push(...ordersOfDay(day, today));
  return orders;
}

/** Chance per second of an open order moving on */
const NEXT: Partial<Record<OrderStatus, Array<[OrderStatus, number]>>> = {
  pending: [['processing', 1 / 25], ['cancelled', 1 / 400]],
  processing: [['shipped', 1 / 35], ['cancelled', 1 / 600]],
  shipped: [['fulfilled', 1 / 45]],
};

export class OrderBook {
  readonly orders: Order[];
  private readonly changes: StatusChange[] = [];
  private lastNew: Order | null = null;

  constructor(
    now = Date.now(),
    private readonly random: () => number = Math.random,
    /** New orders per second, on average */
    private readonly rate = 1 / 9,
  ) {
    this.orders = orderHistory(now);
  }

  /** Moves the book on by a second: maybe a new order, maybe some orders move on */
  tick(now = Date.now()): { newOrder: Order | null; change: StatusChange | null } {
    let newOrder: Order | null = null;
    if (this.random() < this.rate && (!this.lastNew || orderNumber(now) !== this.lastNew.orderNo)) {
      newOrder = makeOrder(now, this.random);
      this.orders.push(newOrder);
      this.lastNew = newOrder;
    }
    // Only the open orders of the last few weeks move on
    for (let i = this.orders.length - 1; i >= 0 && this.orders[i].at > now - 21 * DAY; i--) {
      const order = this.orders[i];
      for (const [status, chance] of NEXT[order.status] ?? []) {
        if (this.random() < chance) {
          order.status = status;
          this.changes.push({ orderNo: order.orderNo, status });
          break;
        }
      }
    }
    return { newOrder, change: this.changes.shift() ?? null };
  }
}
