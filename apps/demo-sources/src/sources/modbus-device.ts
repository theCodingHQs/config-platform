/**
 * A PLC answering Modbus TCP: several machines' readings in holding registers (see
 * modbus-registers.ts), each machine at its own base address. Unread addresses are 0.
 */
import ModbusRTU from 'modbus-serial';
import type { Plant } from '../plant/plant.js';
import { encodeReading, REGISTERS_PER_MACHINE } from './modbus-registers.js';

export function startModbusDevice(plant: Plant, port: number, bases: Record<string, number>): () => Promise<void> {
  const register = (addr: number): number => {
    for (const [code, base] of Object.entries(bases)) {
      if (addr >= base && addr < base + REGISTERS_PER_MACHINE) return encodeReading(plant.reading(code))[addr - base];
    }
    return 0;
  };
  const server = new ModbusRTU.ServerTCP(
    {
      getHoldingRegister: (addr: number) => register(addr),
      getInputRegister: (addr: number) => register(addr),
      getMultipleHoldingRegisters: (addr: number, length: number) => Array.from({ length }, (_, i) => register(addr + i)),
      getMultipleInputRegisters: (addr: number, length: number) => Array.from({ length }, (_, i) => register(addr + i)),
    },
    { host: '0.0.0.0', port, unitID: 1 },
  );
  return () => new Promise((resolve) => server.close(() => resolve()));
}
