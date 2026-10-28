/**
 * Built-in symbols: ship with the app, so every workspace has them without setting anything up.
 * Drawings place them by their `builtin:` id like any other symbol; they can't be changed or
 * deleted, only copied into a workspace symbol to make one's own.
 *
 * An id, once shipped, must never change, and a symbol's inputs may only be added to (never
 * renamed or removed): drawings everywhere depend on both.
 */
import type { Visual, VisualDefinition } from '../visuals/index.js';
import { carrierSymbol } from './carrier.js';
import { gaugeSymbol } from './gauge.js';
import { machineSymbol } from './machine/symbol.js';
import { pumpSymbol } from './pump.js';
import { stackLightSymbol } from './stack-light.js';
import { stationSymbol } from './station.js';
import { tankSymbol } from './tank.js';
import { valueBoxSymbol } from './value-box.js';

export { MACHINE_HEIGHT, MACHINE_WIDTH } from './machine/symbol.js';
export { MACHINE_LOOKS, type MachineLook } from './machine/looks.js';
export { STATION_LOOKS } from './station.js';
export * from './builder.js';

export const BUILTIN_PREFIX = 'builtin:';

export const BUILTIN_SYMBOL_IDS = {
  machine: 'builtin:machine',
  stackLight: 'builtin:stack-light',
  tank: 'builtin:tank',
  pump: 'builtin:pump',
  gauge: 'builtin:gauge',
  valueBox: 'builtin:value-box',
  station: 'builtin:station',
  carrier: 'builtin:carrier',
} as const;

export interface BuiltinSymbol {
  id: string;
  name: string;
  description: string;
  build: () => VisualDefinition;
}

export const BUILTIN_SYMBOLS: readonly BuiltinSymbol[] = [
  { id: BUILTIN_SYMBOL_IDS.machine, name: 'Machine', description: 'A machine drawn for its type, with a stack light and a display of its status, speed, temperature and count', build: machineSymbol },
  { id: BUILTIN_SYMBOL_IDS.stackLight, name: 'Stack light', description: 'Red, amber and green lamps that follow a status', build: stackLightSymbol },
  { id: BUILTIN_SYMBOL_IDS.tank, name: 'Tank', description: 'A tank whose liquid follows a level, warning outside its limits', build: tankSymbol },
  { id: BUILTIN_SYMBOL_IDS.pump, name: 'Pump', description: 'A pump that turns while running and blinks in alarm', build: pumpSymbol },
  { id: BUILTIN_SYMBOL_IDS.gauge, name: 'Gauge', description: 'A dial whose needle follows a value between a minimum and maximum', build: gaugeSymbol },
  { id: BUILTIN_SYMBOL_IDS.valueBox, name: 'Value box', description: 'A labelled value with its unit', build: valueBoxSymbol },
  { id: BUILTIN_SYMBOL_IDS.station, name: 'Station', description: 'One station of a line in five looks, with lamps for its state', build: stationSymbol },
  { id: BUILTIN_SYMBOL_IDS.carrier, name: 'Carrier', description: 'A carrier that travels along a track, with a lift and a free/busy badge', build: carrierSymbol },
];

export const isBuiltinRef = (id: string | undefined): boolean => Boolean(id?.startsWith(BUILTIN_PREFIX));

const SHIPPED = new Date(0).toISOString();
const cache = new Map<string, Visual>();

/** A built-in symbol as a saved visual (read-only), or undefined for an unknown id */
export function builtinSymbol(id: string): Visual | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  const spec = BUILTIN_SYMBOLS.find((s) => s.id === id);
  if (!spec) return undefined;
  const definition = spec.build();
  const visual: Visual = { id, name: spec.name, kind: 'symbol', definition, elementCount: definition.nodes.length, version: 1, createdAt: SHIPPED, updatedAt: SHIPPED };
  cache.set(id, visual);
  return visual;
}
