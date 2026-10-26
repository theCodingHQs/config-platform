/**
 * Live rules that turn the order desk's events into Customer Order records:
 *   order comes in    a new record with every detail of the order
 *   order moves on    that record's status changes (pending → processing → shipped → fulfilled)
 * Neither has a condition: a rule without one runs on every change of its tag, while a condition
 * only fires when it turns from false to true (and "a new order number" never turns false).
 */
import type { EntityInfo } from './entities.js';
import { ORDER_FIELDS } from './order-entity.js';

export function orderRulePlans(order: EntityInfo) {
  return [
    {
      name: 'Order desk: new order → Customer Order',
      enabled: true,
      trigger: { tag: 'orders.new.order_no' },
      cooldownSec: 0,
      action: {
        type: 'createRecord',
        entityId: order.id,
        fields: ORDER_FIELDS.map((f) => ({ field: f.name, value: f.name === 'order_no' ? 'value' : `live.orders.new.${f.name}` })),
      },
    },
    {
      name: 'Order desk: status change → Customer Order',
      enabled: true,
      trigger: { tag: 'orders.update.key' },
      cooldownSec: 0,
      action: {
        type: 'updateLatest',
        entityId: order.id,
        match: [{ field: 'order_no', op: 'equals', value: 'live.orders.update.order_no' }],
        fields: [{ field: 'status', value: 'live.orders.update.status' }],
      },
    },
  ];
}
