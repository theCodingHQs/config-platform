/**
 * How a demo machine's reading sits in Modbus holding registers, as a PLC's register map would
 * describe it (offsets from the machine's base address):
 *   +0     status code   uint16   0 stopped · 1 running · 2 idle · 3 alarm
 *   +1     speed         uint16   tenths of a part/min (scale 0.1)
 *   +2..3  count         uint32   high word first
 *   +4     temperature   int16    tenths of a °C (scale 0.1)
 *   +5..6  power         float32  kW, high word first
 */
import { STATUS_CODES } from '../catalog.js';
import type { MachineReading } from '../plant/sim-machine.js';

export const REGISTER_MAP = [
  { key: 'status_code', offset: 0, type: 'uint16', scale: 1 },
  { key: 'speed', offset: 1, type: 'uint16', scale: 0.1 },
  { key: 'count', offset: 2, type: 'uint32', scale: 1 },
  { key: 'temperature', offset: 4, type: 'int16', scale: 0.1 },
  { key: 'power', offset: 5, type: 'float32', scale: 1 },
] as const;

export const REGISTERS_PER_MACHINE = 7;

export function encodeReading(r: MachineReading): number[] {
  const words = new Array<number>(REGISTERS_PER_MACHINE).fill(0);
  const buf = Buffer.alloc(4);
  words[0] = STATUS_CODES[r.status];
  words[1] = Math.round(r.speed * 10) & 0xffff;
  buf.writeUInt32BE(r.count >>> 0, 0);
  words[2] = buf.readUInt16BE(0);
  words[3] = buf.readUInt16BE(2);
  buf.writeInt16BE(Math.round(r.temperature * 10), 0);
  words[4] = buf.readUInt16BE(0);
  buf.writeFloatBE(r.power, 0);
  words[5] = buf.readUInt16BE(0);
  words[6] = buf.readUInt16BE(2);
  return words;
}
