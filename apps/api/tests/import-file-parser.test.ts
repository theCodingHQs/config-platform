import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseXlsxContent } from '../src/records/import/file-parser.js';

describe('XLSX import parser', () => {
  it('parses text cells deterministically when the sheet precedes sharedStrings in the zip', async () => {
    // Regression: the streaming reader raced in this (Excel-typical) part order and about half
    // the time read the header as "[object Object]", so every imported field came out empty.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['SKU', 'Title', 'Price', 'Active']);
    const r2 = ws.addRow(['SKU-001', 'Widget', null, true]);
    r2.getCell(3).value = { formula: '100 + 50', result: 150 } as any;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const order = Object.keys((await JSZip.loadAsync(buffer)).files);
    expect(order.indexOf('xl/worksheets/sheet1.xml')).toBeLessThan(order.indexOf('xl/sharedStrings.xml'));

    for (let i = 0; i < 25; i++) {
      const parsed = await parseXlsxContent(buffer);
      expect(parsed.columns).toEqual(['SKU', 'Title', 'Price', 'Active']);
      // Cached formula result is read, never evaluated
      expect(parsed.rows).toEqual([{ SKU: 'SKU-001', Title: 'Widget', Price: 150, Active: true }]);
    }
  });

});

describe('XLSX import parser: text decoding', () => {
  it('reads rich text, XML-escaped characters and repeated strings correctly', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Note']);
    ws.addRow([{ richText: [{ text: 'Bold ', font: { bold: true } }, { text: 'part' }] } as any, 'A & B <c> "q" \'s\'']);
    ws.addRow(['Name', 'Ünïcödé ✓']);
    const parsed = await parseXlsxContent(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.rows).toEqual([
      { Name: 'Bold part', Note: 'A & B <c> "q" \'s\'' },
      { Name: 'Name', Note: 'Ünïcödé ✓' },
    ]);
  });
});
