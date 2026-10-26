/**
 * The Customer Order entity the order desk fills: live rules create a record for every order that
 * comes in and keep its status up to date. The first setup also adds the newest orders of the
 * history, so the register isn't empty before the source has run.
 */
import { CHANNELS, ORDER_STATUSES, ORDER_TYPES, PRODUCT_LINES, REGIONS, STATUS_LABELS, TIERS, type Choice } from '../orders/order-catalog.js';
import { orderHistory } from '../orders/order-book.js';
import { orderMessage } from '../sources/site-feeds.js';
import type { ApiClient } from './api-client.js';
import { ensureEntity, select, type EntityInfo, type FieldSpec } from './entities.js';

const SEED_COUNT = 30;

const STATUS_COLOURS: Record<string, string> = { pending: 'warning', processing: 'info', shipped: 'purple', fulfilled: 'success', cancelled: 'danger' };
const TIER_COLOURS: Record<string, string> = { key: 'purple', mid: 'info', small: 'amber' };
const options = (choices: readonly Choice[], colours: Record<string, string> = {}) => select(...choices.map(([v, l]) => [v, l, colours[v]] as [string, string, string?]));

export const ORDER_FIELDS: FieldSpec[] = [
  { name: 'order_no', label: 'Order No', type: 'text', required: true, unique: true },
  { name: 'ordered_at', label: 'Ordered', type: 'date', config: { includeTime: true } },
  { name: 'customer', label: 'Customer', type: 'text' },
  { name: 'product', label: 'Product Line', type: 'select', config: options(PRODUCT_LINES) },
  { name: 'order_type', label: 'Order Type', type: 'select', config: options(ORDER_TYPES) },
  { name: 'region', label: 'Region', type: 'select', config: options(REGIONS) },
  { name: 'tier', label: 'Tier', type: 'select', config: options(TIERS, TIER_COLOURS) },
  { name: 'channel', label: 'Channel', type: 'select', config: options(CHANNELS) },
  { name: 'quantity', label: 'Quantity', type: 'number', config: { precision: 8, scale: 0 } },
  { name: 'amount', label: 'Amount', type: 'number', config: { precision: 12, scale: 2 } },
  { name: 'status', label: 'Status', type: 'select', config: select(...ORDER_STATUSES.map((s) => [s, STATUS_LABELS[s], STATUS_COLOURS[s]] as [string, string, string])) },
];

export async function ensureOrderEntity(api: ApiClient, log: (line: string) => void): Promise<EntityInfo> {
  const entity = await ensureEntity(api, { name: 'customer_order', label: 'Customer Order', icon: 'ShoppingCart', fields: ORDER_FIELDS }, log);
  const { data } = await api.get<{ data: unknown[] }>(`/entities/${entity.id}/records?limit=1`);
  if (!data.length) {
    const newest = orderHistory(Date.now()).slice(-SEED_COUNT);
    for (const order of newest) await api.post(`/entities/${entity.id}/records`, orderMessage(order));
    log(`+ ${newest.length} customer orders from the history`);
  }
  return entity;
}
