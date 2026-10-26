/**
 * Two MQTT connections for the site feeds (see sources/site-feeds.ts), with a tag for every value:
 *   Process area    process.tk11.level, process.c3.status, process.unit.speed, …
 *   Order desk      orders.ytd.orders, orders.month.m12.revenue, orders.tier.key.m3, orders.recent.r1.customer, …
 *                   and the latest events: orders.new.* (a new order), orders.update.* (a status change)
 * The tag lists are made from a sample message, so they always match what the feeds send.
 */
import { MQTT_PASSWORD, MQTT_USER, PORTS, SOURCE_HOST } from '../demo-config.js';
import { OrderBook } from '../orders/order-book.js';
import { orderSummary } from '../orders/order-summary.js';
import { ProcessArea } from '../process/process-area.js';
import { orderMessage, TOPICS } from '../sources/site-feeds.js';

type Tag = { tag: string; value: string; type: 'number' | 'text'; unit?: string; topic?: string; staleAfterSec?: number };

export const PROCESS_CONNECTION = 'Process area · MQTT';
export const ORDERS_CONNECTION = 'Order desk · MQTT';

/** Every leaf of a message by its dotted path: { a: { b: 1 } } → [["a.b", 1]] */
export function leaves(value: unknown, path = ''): Array<[string, unknown]> {
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, value]];
}

const PROCESS_UNITS: Array<[RegExp, string]> = [
  [/\.(level|solids|load|moisture|shipped)$/, '%'],
  [/\.(flow|reject)$/, 'L/min'],
  [/\.rate$/, 'L/h'],
  [/\.power$/, 'kW'],
  [/\.(inlet|outlet|zone\d)$/, 'kPa'],
  [/\.(temperature|dry\d)$/, '°C'],
  [/\.speed$/, 'm/min'],
  [/\.(output|throughput)$/, 't/h'],
  [/\.made$/, 't'],
];

const tagsFrom = (prefix: string, message: unknown, at: string, extra: Partial<Tag> = {}): Tag[] =>
  leaves(message).map(([path, v]) => {
    const unit = prefix === 'process' ? PROCESS_UNITS.find(([re]) => re.test(`.${path}`))?.[1] : undefined;
    return { tag: `${prefix}.${path}`, value: `${at}.${path}`, type: typeof v === 'number' ? 'number' : 'text', ...(unit ? { unit } : {}), ...extra };
  });

const mqtt = (topics: string[]) => ({ url: `mqtt://${SOURCE_HOST}:${PORTS.mqtt}`, username: MQTT_USER, password: MQTT_PASSWORD, topics, qos: 0, format: 'json' });

export function processConnection() {
  return {
    name: PROCESS_CONNECTION,
    kind: 'mqtt',
    enabled: true,
    agentId: null,
    settings: mqtt([TOPICS.process]),
    tags: tagsFrom('process', new ProcessArea().tick(1), 'message', { staleAfterSec: 10 }),
  };
}

export function ordersConnection() {
  const book = new OrderBook(Date.now(), Math.random, 0);
  const sample = book.orders[book.orders.length - 1];
  // The order number last: rules start on it, and read the other new-order tags from the same message
  const newOrderTags = tagsFrom('orders.new', { ...orderMessage(sample), order_no: sample.orderNo }, 'message.order', { topic: TOPICS.newOrder });
  return {
    name: ORDERS_CONNECTION,
    kind: 'mqtt',
    enabled: true,
    agentId: null,
    settings: mqtt(['site/orders/#']),
    tags: [
      ...tagsFrom('orders', orderSummary(book.orders), 'message', { topic: TOPICS.summary }),
      ...newOrderTags.filter((t) => t.tag !== 'orders.new.order_no'),
      ...newOrderTags.filter((t) => t.tag === 'orders.new.order_no'),
      ...tagsFrom('orders.update', { key: 'k', order_no: 'n', status: 's' }, 'message', { topic: TOPICS.update }),
    ],
  };
}
