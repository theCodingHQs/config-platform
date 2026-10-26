/**
 * Saves the demo's symbol and drawings in Studio → Visuals, matched by name: the symbol first, so
 * the drawings can place it by its id. A visual that already exists is left as it is (it may have
 * been changed in the editor) unless it's named in `refresh` (or refresh is 'all').
 */
import type { VisualDefinition } from '@config-platform/schema';
import type { DemoMachine } from '../../catalog.js';
import type { ApiClient } from '../api-client.js';
import { MACHINE_SYMBOL_NAME, machineSymbol } from './machine-symbol.js';
import { MACHINE_VIEW_NAME, PLANT_FLOOR_NAME, machineView, plantFloor } from './plant-floor.js';
import { ORDER_DESK_NAME, orderDesk } from './order-desk.js';
import { PROCESS_OVERVIEW_NAME, processOverview } from './process-overview.js';

export interface DemoVisualIds {
  plantFloor: string;
  machineView: string;
  processOverview: string;
  orderDesk: string;
}

export type Refresh = 'all' | ReadonlySet<string>;

interface Summary {
  id: string;
  name: string;
  kind: 'drawing' | 'symbol';
  version: number;
}

async function save(api: ApiClient, existing: Summary[], refresh: Refresh, name: string, kind: Summary['kind'], definition: VisualDefinition, log: (line: string) => void): Promise<string> {
  const found = existing.find((v) => v.name === name && v.kind === kind);
  if (found && refresh !== 'all' && !refresh.has(name)) {
    log(`= visual ${name} (kept as it is)`);
    return found.id;
  }
  if (found) {
    await api.put(`/visuals/${found.id}`, { name, kind, definition, expectedVersion: found.version });
    log(`~ visual ${name}`);
    return found.id;
  }
  const created = await api.post<{ id: string }>('/visuals', { name, kind, definition });
  log(`+ visual ${name}`);
  return created.id;
}

export async function publishVisuals(api: ApiClient, machines: readonly DemoMachine[], refresh: Refresh, log: (line: string) => void): Promise<DemoVisualIds> {
  const existing = await api.get<Summary[]>('/visuals');
  const put = (name: string, kind: Summary['kind'], definition: VisualDefinition) => save(api, existing, refresh, name, kind, definition, log);
  const symbolId = await put(MACHINE_SYMBOL_NAME, 'symbol', machineSymbol());
  return {
    plantFloor: await put(PLANT_FLOOR_NAME, 'drawing', plantFloor(machines, symbolId)),
    machineView: await put(MACHINE_VIEW_NAME, 'drawing', machineView(machines, symbolId)),
    processOverview: await put(PROCESS_OVERVIEW_NAME, 'drawing', processOverview()),
    orderDesk: await put(ORDER_DESK_NAME, 'drawing', orderDesk()),
  };
}
