/**
 * The Machine entity, extended for monitoring: a code that links each record to its live tags
 * (machines.<code>.*), its configuration (targets, shifts), where its data comes from, and a
 * status that live rules keep up to date. Also the Downtime log that rules write to.
 */
import { DEMO_MACHINES, SOURCE_LABELS, type SourceKind } from '../catalog.js';
import type { ApiClient } from './api-client.js';
import { ensureEntity, select, type EntityInfo, type FieldSpec } from './entities.js';

export const MACHINE_STATUS_OPTIONS = select(
  ['running', 'Running', 'success'],
  ['idle', 'Idle', 'neutral'],
  ['alarm', 'Alarm', 'danger'],
  ['stopped', 'Stopped', 'warning'],
  ['maintenance', 'Maintenance', 'warning'],
);

const MACHINE_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, unique: true },
  { name: 'work_center', label: 'Work Center', type: 'text' },
  { name: 'code', label: 'Machine Code', type: 'text', unique: true },
  { name: 'machine_type', label: 'Type', type: 'select', config: select(['cnc', 'CNC'], ['lathe', 'Lathe'], ['press', 'Press'], ['molding', 'Molding'], ['welding', 'Welding'], ['painting', 'Painting'], ['assembly', 'Assembly'], ['other', 'Other']) },
  { name: 'line', label: 'Production Line', type: 'select', config: select(['Line 1', 'Line 1'], ['Line 2', 'Line 2'], ['Line 3', 'Line 3']) },
  { name: 'status', label: 'Status', type: 'select', config: MACHINE_STATUS_OPTIONS },
  { name: 'status_since', label: 'Status Since', type: 'date', config: { includeTime: true } },
  { name: 'data_source', label: 'Data Source', type: 'select', config: select(...(Object.entries(SOURCE_LABELS) as Array<[SourceKind, string]>), ['none', 'Not connected']) },
  { name: 'hourly_target', label: 'Hourly Target (parts)', type: 'number', config: { precision: 8, scale: 0 } },
  { name: 'shift_hours', label: 'Shift Length (h)', type: 'number', config: { precision: 4, scale: 1 } },
  { name: 'shifts_per_day', label: 'Shifts per Day', type: 'number', config: { precision: 2, scale: 0 } },
  { name: 'daily_target', label: 'Daily Target (parts)', type: 'number', config: { precision: 10, scale: 0, formula: 'round(hourly_target * shift_hours * shifts_per_day)' } },
  { name: 'max_temperature', label: 'Max Temperature (°C)', type: 'number', config: { precision: 5, scale: 1 } },
  { name: 'manufacturer', label: 'Manufacturer', type: 'text' },
  { name: 'model', label: 'Model', type: 'text' },
  { name: 'installed_on', label: 'Installed On', type: 'date' },
  { name: 'active', label: 'Active', type: 'boolean' },
];

const DOWNTIME_FIELDS: FieldSpec[] = [
  { name: 'machine_code', label: 'Machine Code', type: 'text', required: true },
  { name: 'reason', label: 'Reason', type: 'select', config: select(['alarm', 'Alarm', 'danger'], ['stopped', 'Stopped', 'warning']) },
  { name: 'started_at', label: 'Started', type: 'date', config: { includeTime: true } },
  { name: 'ended_at', label: 'Ended', type: 'date', config: { includeTime: true } },
  { name: 'note', label: 'Note', type: 'text' },
];

export async function ensureMachineEntities(api: ApiClient, log: (line: string) => void): Promise<{ machine: EntityInfo; downtime: EntityInfo }> {
  const machine = await ensureEntity(api, { name: 'machine', label: 'Machine', icon: 'Cog', fields: MACHINE_FIELDS }, log);
  const downtime = await ensureEntity(api, { name: 'machine_downtime', label: 'Machine Downtime', icon: 'TimerOff', fields: DOWNTIME_FIELDS }, log);
  return { machine, downtime };
}

/** The demo machines' records: created when missing; existing ones only get empty fields filled */
export async function ensureMachineRecords(api: ApiClient, machine: EntityInfo, log: (line: string) => void): Promise<void> {
  const { data: existing } = await api.get<{ data: Array<Record<string, any>> }>(`/entities/${machine.id}/records?limit=200`);
  for (const m of DEMO_MACHINES) {
    const wanted: Record<string, unknown> = {
      name: m.name,
      work_center: m.workCenter,
      code: m.code,
      machine_type: m.machineType,
      line: m.line,
      status: 'running',
      data_source: m.source,
      hourly_target: m.hourlyTarget,
      shift_hours: 8,
      shifts_per_day: 2,
      max_temperature: m.baseTemperature + 45,
      manufacturer: m.manufacturer,
      model: m.model,
      installed_on: m.installedOn,
      active: true,
    };
    const record = existing.find((r) => r.code === m.code || r.name === m.name);
    if (!record) {
      await api.post(`/entities/${machine.id}/records`, wanted);
      log(`+ machine ${m.name}`);
      continue;
    }
    const missing = Object.fromEntries(Object.entries(wanted).filter(([k]) => record[k] === null || record[k] === undefined || record[k] === ''));
    if (Object.keys(missing).length) {
      await api.patch(`/entities/${machine.id}/records/${record.id}`, missing);
      log(`~ machine ${m.name}: filled ${Object.keys(missing).join(', ')}`);
    }
  }
}
