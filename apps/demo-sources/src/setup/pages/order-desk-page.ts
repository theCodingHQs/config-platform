/**
 * Order Desk: the live sales dashboard (a visual fed by orders.* tags) above the Customer Order
 * register that live rules fill as orders come in and move on, with filters for the register.
 */
import { ORDER_STATUSES, REGIONS, STATUS_LABELS, TIERS } from '../../orders/order-catalog.js';
import { fieldId } from '../entities.js';
import { card, grid, header, liveBadge, row, stack, stat, text } from './blocks.js';
import type { PageContext, PageSpec } from './context.js';

const filter = (id: string, label: string, placeholder: string, valueKey: string, options: Array<{ label: string; value: string }>) => ({
  id,
  type: 'select',
  props: { label, valueKey, options, placeholder, clearable: true, minWidth: 200 },
});

export function orderDeskPage(ctx: PageContext): PageSpec {
  const F = (n: string) => fieldId(ctx.order, n);
  const entityId = ctx.order.id;
  return {
    name: 'Order Desk',
    route: '/sales/order-desk',
    icon: 'ShoppingCart',
    folder: { name: 'Sales', icon: 'ShoppingCart' },
    draft: {
      schemaVersion: 2,
      id: 'pg_order_desk',
      version: 1,
      route: '/sales/order-desk',
      width: 'full',
      state: { region: '', status: '', tier: '' },
      dataSources: [
        {
          id: 'ds_orders',
          entityId,
          filter: { region: '{{ state.region }}', status: '{{ state.status }}', tier: '{{ state.tier }}' },
          sort: { fieldId: F('ordered_at'), order: 'desc' },
          limit: 15,
        },
      ],
      root: stack('root', { direction: 'vertical', gap: 20, padding: 24 }, [
        header('od', 'Order Desk', 'The dashboard is one drawing from Studio → Visuals, every figure a live value from the order system. Below it, the orders it logs as records.', [liveBadge('od_live')]),
        card('od_dashboard', '', [{ id: 'od_visual', type: 'visual', props: { visualId: ctx.visuals.orderDesk } }], { padding: 'none', variant: 'flat' }),

        text('od_logged', 'Logged as Customer Order records by live rules', 'caption', { color: 'muted', weight: 'semibold' }),
        grid('od_kpis', 4, [
          stat('od_k_total', 'Orders logged', entityId, { icon: 'ShoppingCart' }),
          stat('od_k_value', 'Value logged', entityId, { op: 'sum', fieldId: F('amount'), icon: 'Banknote', color: 'accent' }),
          stat('od_k_pending', 'Waiting to start', entityId, { filter: { status: 'pending' }, icon: 'Clock', color: 'warning' }),
          stat('od_k_shipped', 'On the way', entityId, { filter: { status: 'shipped' }, icon: 'Truck', color: 'success' }),
        ]),
        card('od_register', 'Customer orders', [
          row('od_filters', [
            filter('od_f_region', 'Region', 'All regions', 'region', REGIONS.map(([value, label]) => ({ label, value }))),
            filter('od_f_status', 'Status', 'All statuses', 'status', ORDER_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s }))),
            filter('od_f_tier', 'Tier', 'All tiers', 'tier', TIERS.map(([value, label]) => ({ label, value }))),
          ], { align: 'end' }),
          {
            id: 'od_table',
            type: 'table',
            props: {
              source: 'ds_orders',
              columns: ['order_no', 'ordered_at', 'customer', 'product', 'region', 'tier', 'channel', 'status', 'amount'].map((n) => ({ fieldId: F(n) })),
              pageSize: 15,
              striped: true,
              emptyMessage: 'No orders yet. They appear here as the order desk sends them.',
            },
          },
        ], { headerIcon: 'ClipboardList', subtitle: 'New orders appear and statuses change on their own, on every open screen.' }),
      ]),
    },
  };
}
