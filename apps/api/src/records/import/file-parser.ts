import { Readable } from 'node:stream';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { inspectZipBuffer } from './zip-guard.js';

export class InvalidFileContentError extends Error {
  public statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileContentError';
  }
}

export type DetectedFileType = 'csv' | 'xlsx';

export const MAX_XLSX_ROW_CAP = 10000;

/**
 * Sniffs file content by magic bytes rather than file extension alone.
 */
export function detectFileType(buffer: Buffer, originalFilename?: string): DetectedFileType {
  if (!buffer || buffer.length === 0) {
    throw new InvalidFileContentError('Uploaded file is empty');
  }

  // XLSX magic bytes: PK\x03\x04 (ZIP archive header)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return 'xlsx';
  }

  // Check for common binary signatures to reject renamed non-CSV files
  // PE (Windows executable): MZ
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw new InvalidFileContentError('Invalid file: executable files (PE/EXE) are not permitted');
  }

  // ELF (Linux executable): \x7fELF
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    throw new InvalidFileContentError('Invalid file: executable files (ELF) are not permitted');
  }

  // PDF: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    throw new InvalidFileContentError('Invalid file: PDF documents cannot be imported as data');
  }

  // Check for binary null bytes in the first 8 KB (CSV is plain text)
  const inspectLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < inspectLength; i++) {
    if (buffer[i] === 0x00) {
      throw new InvalidFileContentError(
        'Invalid file content: binary null bytes detected in non-CSV file'
      );
    }
  }

  // Default to CSV
  return 'csv';
}

export interface ParsedTableData {
  sheets: string[];
  selectedSheet: string;
  columns: string[];
  rows: Record<string, any>[];
}

/**
 * Parses a CSV buffer into header columns and record objects.
 * Handles UTF-8 with or without BOM, quoted newlines, and escaping.
 */
export function parseCsvContent(buffer: Buffer): ParsedTableData {
  try {
    const records: string[][] = parse(buffer, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      return {
        sheets: ['Sheet1'],
        selectedSheet: 'Sheet1',
        columns: [],
        rows: [],
      };
    }

    const rawHeaders = records[0];
    const columns: string[] = rawHeaders.map((h, idx) => {
      const clean = (h || '').trim();
      return clean.length > 0 ? clean : `Column_${idx + 1}`;
    });

    const rows: Record<string, any>[] = [];
    for (let r = 1; r < records.length; r++) {
      const rowValues = records[r];
      // Skip completely empty rows
      if (rowValues.every((val) => !val || val.trim() === '')) {
        continue;
      }

      const rowObj: Record<string, any> = {};
      for (let c = 0; c < columns.length; c++) {
        rowObj[columns[c]] = rowValues[c] !== undefined ? rowValues[c] : null;
      }
      rows.push(rowObj);
    }

    return {
      sheets: ['Sheet1'],
      selectedSheet: 'Sheet1',
      columns,
      rows,
    };
  } catch (err: any) {
    throw new InvalidFileContentError(`Failed to parse CSV: ${err.message}`);
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes XML entities plus Excel's _xHHHH_ escapes (used for control characters). */
function decodeXmlText(text: string): string {
  return text
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e.startsWith('#x')) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
      if (e.startsWith('#')) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
      return XML_ENTITIES[e];
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Reads the shared strings table directly from the zip. ExcelJS's streaming reader filled it
 * nondeterministically (sometimes not at all), leaving text cells unresolved. Rich text is
 * flattened to plain text (as the importer does anyway); phonetic runs (<rPh>) are skipped.
 */
async function readSharedStrings(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const xml = await file.async('string');
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    const body = (si[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let text = '';
    for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += t[1];
    strings.push(decodeXmlText(text));
  }
  return strings;
}

/**
 * Parses an XLSX buffer using exceljs with zip-bomb protection.
 * Reads cached cell values/results, ignores formulas and hyperlinks, never executes macros.
 */
export async function parseXlsxContent(
  buffer: Buffer,
  requestedSheetName?: string
): Promise<ParsedTableData> {
  // 1. Guard against zip-bombs before extraction
  inspectZipBuffer(buffer);

  // 2. Stream-parse workbook
  try {
    // ExcelJS's streaming reader resolved text cells nondeterministically (headers read as
    // "[object Object]" about half the time, so every mapped field came out empty). The shared
    // strings are therefore read directly from the zip and pre-loaded; the worksheet itself is
    // still streamed, keeping memory bounded for very large sheets.
    const sharedStrings = await readSharedStrings(buffer);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      worksheets: 'emit',
      sharedStrings: 'ignore', // keep the pre-read table below; don't reset it mid-stream
    });
    (reader as any).model = { sheets: [] };
    (reader as any).sharedStrings = sharedStrings;

    const sheets: string[] = [];
    let selectedSheet = '';
    const columns: string[] = [];
    const colIndexToName = new Map<number, string>();
    const rows: Record<string, any>[] = [];

    for await (const worksheet of reader) {
      const ws = worksheet as any;
      const sheetName = ws.name || `Sheet${ws.id || '1'}`;
      sheets.push(sheetName);

      // If already processed the target sheet, drain or skip
      if (selectedSheet) {
        continue;
      }

      if (requestedSheetName && sheetName !== requestedSheetName) {
        continue;
      }

      selectedSheet = sheetName;

      for await (const row of worksheet) {
        if (row.number === 1) {
          row.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
            let rawVal = cell.value;
            if (rawVal && typeof rawVal === 'object') {
              if ('result' in rawVal) rawVal = (rawVal as any).result;
              else if ('text' in rawVal) rawVal = (rawVal as any).text;
            }
            const colName = rawVal ? String(rawVal).trim() : `Column_${colNumber}`;
            columns.push(colName);
            colIndexToName.set(colNumber, colName);
          });
          continue;
        }

        let hasValues = false;
        const rowObj: Record<string, any> = {};

        colIndexToName.forEach((colName, colNumber) => {
          const cell = row.getCell(colNumber);
          let val = cell.value;

          // Extract cached formula result or text link, never evaluate
          if (val !== null && val !== undefined && typeof val === 'object') {
            if ('result' in val) {
              val = (val as any).result;
            } else if ('text' in val) {
              val = (val as any).text;
            } else if (val instanceof Date) {
              val = val.toISOString();
            } else if ('richText' in val && Array.isArray((val as any).richText)) {
              val = (val as any).richText.map((t: any) => t.text || '').join('');
            }
          }

          if (val !== null && val !== undefined && String(val).trim() !== '') {
            hasValues = true;
          }
          rowObj[colName] = val ?? null;
        });

        if (hasValues) {
          if (rows.length >= MAX_XLSX_ROW_CAP) {
            throw new InvalidFileContentError(
              `XLSX row cap exceeded: maximum allowed is ${MAX_XLSX_ROW_CAP.toLocaleString()} data rows`
            );
          }
          rows.push(rowObj);
        }
      }
    }

    return {
      sheets,
      selectedSheet: selectedSheet || sheets[0] || '',
      columns,
      rows,
    };
  } catch (err: any) {
    if (err instanceof InvalidFileContentError) {
      throw err;
    }
    throw new InvalidFileContentError(`Failed to read XLSX archive: ${err.message}`);
  }
}

/**
 * Universal parser for both CSV and XLSX
 */
export async function parseImportFile(
  buffer: Buffer,
  originalFilename?: string,
  sheetName?: string
): Promise<ParsedTableData> {
  const fileType = detectFileType(buffer, originalFilename);
  if (fileType === 'xlsx') {
    return parseXlsxContent(buffer, sheetName);
  }
  return parseCsvContent(buffer);
}
