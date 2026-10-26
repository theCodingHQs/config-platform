/**
 * The demo plant: eight machines, each fed by a different kind of live connection, so every kind
 * can be seen working side by side. Every machine produces the same tags whatever its source:
 *   machines.<code>.status       running | idle | alarm | stopped
 *   machines.<code>.speed        parts per minute
 *   machines.<code>.temperature  °C
 *   machines.<code>.count        parts made since the source started
 *   machines.<code>.power        kW
 * Pages and rules only use the tag names, never the kind.
 */

export type SourceKind = 'opcua' | 'agent-modbus' | 'modbus' | 'mqtt' | 'websocket' | 'http-poll' | 'http-push' | 'simulator';

export interface DemoMachine {
  /** Also the tag group: machines.m01 */
  code: string;
  name: string;
  workCenter: string;
  machineType: string;
  line: string;
  source: SourceKind;
  /** Parts per minute when running at full speed */
  ratedSpeed: number;
  /** Temperature when cold, °C */
  baseTemperature: number;
  hourlyTarget: number;
  manufacturer: string;
  model: string;
  installedOn: string;
}

export const DEMO_MACHINES: readonly DemoMachine[] = [
  { code: 'm01', name: 'CNC Mill 01', workCenter: 'Machining', machineType: 'cnc', line: 'Line 1', source: 'opcua', ratedSpeed: 12, baseTemperature: 24, hourlyTarget: 650, manufacturer: 'Generic Machines', model: 'VMC-850', installedOn: '2019-03-12' },
  { code: 'm02', name: 'CNC Mill 02', workCenter: 'Machining', machineType: 'cnc', line: 'Line 1', source: 'agent-modbus', ratedSpeed: 11, baseTemperature: 23, hourlyTarget: 600, manufacturer: 'Generic Machines', model: 'VMC-850', installedOn: '2021-07-05' },
  { code: 'm03', name: 'Lathe L-03', workCenter: 'Machining', machineType: 'lathe', line: 'Line 1', source: 'modbus', ratedSpeed: 9, baseTemperature: 25, hourlyTarget: 480, manufacturer: 'Turnwell', model: 'TL-400', installedOn: '2018-11-20' },
  { code: 'm04', name: 'Press P-04', workCenter: 'Stamping', machineType: 'press', line: 'Line 2', source: 'mqtt', ratedSpeed: 40, baseTemperature: 28, hourlyTarget: 2200, manufacturer: 'Formtec', model: 'HP-200', installedOn: '2016-02-14' },
  { code: 'm05', name: 'Injection Mold M-05', workCenter: 'Molding', machineType: 'molding', line: 'Line 2', source: 'websocket', ratedSpeed: 30, baseTemperature: 35, hourlyTarget: 1700, manufacturer: 'Polyform', model: 'IM-150', installedOn: '2022-01-10' },
  { code: 'm06', name: 'Welding Cell W-06', workCenter: 'Fabrication', machineType: 'welding', line: 'Line 3', source: 'http-poll', ratedSpeed: 6, baseTemperature: 26, hourlyTarget: 320, manufacturer: 'Joinrite', model: 'WC-2', installedOn: '2017-09-01' },
  { code: 'm07', name: 'Paint Line PL-07', workCenter: 'Finishing', machineType: 'painting', line: 'Line 3', source: 'http-push', ratedSpeed: 15, baseTemperature: 30, hourlyTarget: 850, manufacturer: 'Coatline', model: 'PL-6', installedOn: '2020-05-18' },
  { code: 'm08', name: 'Assembly A-08', workCenter: 'Assembly', machineType: 'assembly', line: 'Line 3', source: 'simulator', ratedSpeed: 8, baseTemperature: 22, hourlyTarget: 450, manufacturer: 'Generic Machines', model: 'AC-10', installedOn: '2023-04-03' },
];

export const MACHINE_STATUSES = ['running', 'idle', 'alarm', 'stopped'] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

/** How Modbus devices report status: a number */
export const STATUS_CODES: Record<MachineStatus, number> = { stopped: 0, running: 1, idle: 2, alarm: 3 };

/** What each kind is called on screen */
export const SOURCE_LABELS: Record<SourceKind, string> = {
  opcua: 'OPC UA',
  'agent-modbus': 'Edge agent (Modbus TCP)',
  modbus: 'Modbus TCP',
  mqtt: 'MQTT',
  websocket: 'WebSocket',
  'http-poll': 'HTTP polling',
  'http-push': 'HTTP push',
  simulator: 'Simulator',
};

export const machineByCode = (code: string): DemoMachine => {
  const m = DEMO_MACHINES.find((x) => x.code === code);
  if (!m) throw new Error(`No demo machine ${code}`);
  return m;
};

/** "Line 2" → "line2", as it appears in MQTT topics */
export const topicLine = (m: DemoMachine) => m.line.replace(/\s+/g, '').toLowerCase();
