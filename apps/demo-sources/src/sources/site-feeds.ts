/**
 * Two more feeds on the demo MQTT broker, as a control system and a sales system would publish:
 *   site/process/state     the whole process area, every second
 *   site/orders/summary    the order desk's figures, every two seconds (retained)
 *   site/orders/new        {"order":{…}}  when an order comes in
 *   site/orders/update     {"key":"SO-…:shipped","order_no":"SO-…","status":"shipped"}  when one moves on
 */
import { OrderBook, type Order } from '../orders/order-book.js';
import { orderSummary } from '../orders/order-summary.js';
import { ProcessArea } from '../process/process-area.js';
import type { MqttPublish } from './mqtt-broker.js';

export const TOPICS = {
  process: 'site/process/state',
  summary: 'site/orders/summary',
  newOrder: 'site/orders/new',
  update: 'site/orders/update',
} as const;

/** An order as the feed (and the Customer Order record) names its fields */
export const orderMessage = (o: Order) => ({
  order_no: o.orderNo,
  ordered_at: new Date(o.at).toISOString(),
  customer: o.customer,
  product: o.product,
  order_type: o.orderType,
  region: o.region,
  tier: o.tier,
  channel: o.channel,
  quantity: o.quantity,
  amount: o.amount,
  status: o.status,
});

export function processFeed(publish: MqttPublish): () => void {
  const area = new ProcessArea();
  const timer = setInterval(() => publish(TOPICS.process, area.tick(1)), 1000);
  return () => clearInterval(timer);
}

export function orderDeskFeed(publish: MqttPublish): () => void {
  const book = new OrderBook();
  let second = 0;
  const summary = () => publish(TOPICS.summary, orderSummary(book.orders), true);
  summary();
  const timer = setInterval(() => {
    const { newOrder, change } = book.tick();
    if (newOrder) publish(TOPICS.newOrder, { order: orderMessage(newOrder) });
    if (change) publish(TOPICS.update, { key: `${change.orderNo}:${change.status}`, order_no: change.orderNo, status: change.status });
    if (++second % 2 === 0 || newOrder) summary();
  }, 1000);
  return () => clearInterval(timer);
}
