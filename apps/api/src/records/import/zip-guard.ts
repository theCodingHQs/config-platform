export class ZipBombError extends Error {
  public statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ZipBombError';
  }
}

export interface ZipLimits {
  maxEntries?: number; // default: 500
  maxUncompressedSize?: number; // default: 150MB (157,286,400 bytes)
  maxCompressionRatio?: number; // default: 20
}

/**
 * Inspects a ZIP buffer's Central Directory without decompressing the payload.
 * Thwarts zip-bomb attacks by capping entry count, total uncompressed size,
 * and compression ratio before any unzipping or XML parsing happens.
 */
export function inspectZipBuffer(buffer: Buffer, limits: ZipLimits = {}): void {
  const maxEntries = limits.maxEntries ?? 500;
  const maxUncompressedSize = limits.maxUncompressedSize ?? 150 * 1024 * 1024;
  const maxCompressionRatio = limits.maxCompressionRatio ?? 20;

  if (buffer.length < 22) {
    throw new ZipBombError('Invalid ZIP archive: file is too small');
  }

  // Find End of Central Directory Record (EOCD signature: 0x06054b50)
  // EOCD is at least 22 bytes from the end of the file (can have a variable-length comment up to 65535 bytes)
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.length, 65535 + 22);
  const searchStart = buffer.length - 22;
  const searchEnd = buffer.length - maxSearch;

  for (let i = searchStart; i >= searchEnd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new ZipBombError('Invalid ZIP archive: End of Central Directory signature not found');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxEntries) {
    throw new ZipBombError(
      `ZIP security check failed: entry count (${totalEntries}) exceeds safety cap of ${maxEntries}`
    );
  }

  if (cdOffset + cdSize > eocdOffset || cdOffset >= buffer.length) {
    throw new ZipBombError('Invalid ZIP archive: corrupted Central Directory offset');
  }

  let currentOffset = cdOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let entryCount = 0;

  while (currentOffset < cdOffset + cdSize) {
    if (currentOffset + 46 > buffer.length) break;

    const sig = buffer.readUInt32LE(currentOffset);
    if (sig !== 0x02014b50) {
      break;
    }

    const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(currentOffset + 24);
    const fileNameLen = buffer.readUInt16LE(currentOffset + 28);
    const extraLen = buffer.readUInt16LE(currentOffset + 30);
    const commentLen = buffer.readUInt16LE(currentOffset + 32);

    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    entryCount++;

    if (entryCount > maxEntries) {
      throw new ZipBombError(
        `ZIP security check failed: entry count (${entryCount}) exceeds safety cap of ${maxEntries}`
      );
    }

    if (totalUncompressed > maxUncompressedSize) {
      throw new ZipBombError(
        `ZIP security check failed: uncompressed size (${totalUncompressed} bytes) exceeds safety cap of ${maxUncompressedSize} bytes`
      );
    }

    currentOffset += 46 + fileNameLen + extraLen + commentLen;
  }

  if (totalCompressed > 0) {
    const ratio = totalUncompressed / totalCompressed;
    if (ratio > maxCompressionRatio && totalUncompressed > 1024 * 1024) {
      throw new ZipBombError(
        `ZIP security check failed: compression ratio (${ratio.toFixed(1)}:1) exceeds safety cap of ${maxCompressionRatio}:1`
      );
    }
  }
}
