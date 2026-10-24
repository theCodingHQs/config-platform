/**
 * Turning Modbus registers into numbers. Registers are 16-bit; 32-bit values span two, and
 * devices disagree on which comes first (wordOrder). Pure, so every case is tested.
 */
export type ModbusType = 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32' | 'bool';

/** How many 16-bit registers a value takes */
export function registerCount(type: ModbusType): number {
  return type === 'uint32' || type === 'int32' || type === 'float32' ? 2 : 1;
}

export function decodeRegisters(words: number[], type: ModbusType, wordOrder: 'big' | 'little' = 'big', scale = 1): number | boolean {
  if (type === 'bool') return Boolean(words[0]);
  const buf = Buffer.alloc(4);
  if (registerCount(type) === 1) {
    buf.writeUInt16BE(words[0] & 0xffff, 0);
    const raw = type === 'int16' ? buf.readInt16BE(0) : buf.readUInt16BE(0);
    return applyScale(raw, scale);
  }
  const [high, low] = wordOrder === 'big' ? [words[0], words[1]] : [words[1], words[0]];
  buf.writeUInt16BE(high & 0xffff, 0);
  buf.writeUInt16BE(low & 0xffff, 2);
  const raw = type === 'float32' ? buf.readFloatBE(0) : type === 'int32' ? buf.readInt32BE(0) : buf.readUInt32BE(0);
  return applyScale(raw, scale);
}

/** Scaled values are rounded to 6 significant decimals, so 215 × 0.1 shows as 21.5 */
function applyScale(raw: number, scale: number): number {
  const value = raw * scale;
  return scale === 1 ? value : Number(value.toPrecision(12));
}
