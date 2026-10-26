/**
 * Saves the demo's symbol and drawings in Studio → Visuals, matched by name: the symbol first, so
 * the drawings can place it by its id.
 */
import type { VisualDefinition } from '@config-platform/schema';
import type { DemoMachine } from '../../catalog.js';
import type { ApiClient } from '../api-client.js';
import { MACHINE_SYMBOL_NAME, machineSymbol } from './machine-symbol.js';
import { MACHINE_VIEW_NAME, PLANT_FLOOR_NAME, machineView, plantFloor } from './plant-floor.js';

export interface DemoVisualIds {
  plantFloor: string;
  machineView: string;
}

interface Summary {
  id: string;
  name: string;
  kind: 'drawing' | 'symbol';
  version: number;
}

async function save(api: ApiClient, existing: Summary[], name: string, kind: Summary['kind'], definition: VisualDefinition, log: (line: string) => void): Promise<string> {
  const found = existing.find((v) => v.name === name && v.kind === kind);
  if (found) {
    await api.put(`/visuals/${found.id}`, { name, kind, definition, expectedVersion: found.version });
    log(`~ visual ${name}`);
    return found.id;
  }
  const created = await api.post<{ id: string }>('/visuals', { name, kind, definition });
  log(`+ visual ${name}`);
  return created.id;
}

export async function publishVisuals(api: ApiClient, machines: readonly DemoMachine[], log: (line: string) => void): Promise<DemoVisualIds> {
  const existing = await api.get<Summary[]>('/visuals');
  const symbolId = await save(api, existing, MACHINE_SYMBOL_NAME, 'symbol', machineSymbol(), log);
  return {
    plantFloor: await save(api, existing, PLANT_FLOOR_NAME, 'drawing', plantFloor(machines, symbolId), log),
    machineView: await save(api, existing, MACHINE_VIEW_NAME, 'drawing', machineView(machines, symbolId), log),
  };
}
