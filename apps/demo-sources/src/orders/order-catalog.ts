/**
 * What the simulated order desk sells and to whom: product lines, order types, regions, customer
 * tiers, sales channels and order statuses, each as [value, label, weight]. The weights shape the
 * made-up history (more housings than assemblies, more orders from the north than for export).
 */

export type Choice = readonly [value: string, label: string, weight: number];

export const PRODUCT_LINES: readonly Choice[] = [
  ['housings', 'Housings', 34],
  ['brackets', 'Brackets', 27],
  ['panels', 'Panels', 21],
  ['fittings', 'Fittings', 11],
  ['assemblies', 'Assemblies', 7],
];

export const ORDER_TYPES: readonly Choice[] = [
  ['standard', 'Standard', 34],
  ['custom', 'Custom build', 25],
  ['repeat', 'Repeat order', 15],
  ['spares', 'Spare parts', 13],
  ['samples', 'Samples', 8],
  ['service', 'Service', 5],
];

export const REGIONS: readonly Choice[] = [
  ['north', 'North', 33],
  ['south', 'South', 23],
  ['east', 'East', 17],
  ['west', 'West', 11],
  ['central', 'Central', 9],
  ['export', 'Export', 7],
];

export const TIERS: readonly Choice[] = [
  ['key', 'Key account', 28],
  ['mid', 'Mid-size', 40],
  ['small', 'Small', 32],
];

/** Order value range by tier */
export const TIER_AMOUNTS: Record<string, [min: number, max: number]> = { key: [2400, 7200], mid: [900, 2600], small: [180, 1100] };

export const CHANNELS: readonly Choice[] = [
  ['direct', 'Direct', 40],
  ['distributor', 'Distributor', 30],
  ['online', 'Online', 20],
  ['partner', 'Partner', 10],
];

/** In the order an order moves through them; cancelled can happen before it ships */
export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'fulfilled', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const STATUS_LABELS: Record<OrderStatus, string> = { pending: 'Pending', processing: 'Processing', shipped: 'Shipped', fulfilled: 'Fulfilled', cancelled: 'Cancelled' };
export const OPEN_STATUSES: readonly OrderStatus[] = ['pending', 'processing', 'shipped'];

export const CUSTOMERS = [
  'Northgate Fabrication', 'Riverside Components', 'Summit Engineering', 'Harbor Systems', 'Oakline Industries',
  'Brightwater Supply', 'Ironwood Works', 'Clearview Equipment', 'Pinecrest Assembly', 'Redstone Controls',
  'Silverline Products', 'Westfield Machining', 'Bluepeak Instruments', 'Granite Point Tools', 'Meadowbrook Plastics',
  'Lakeshore Devices',
] as const;

export const labelOf = (choices: readonly Choice[], value: string): string => choices.find(([v]) => v === value)?.[1] ?? value;
