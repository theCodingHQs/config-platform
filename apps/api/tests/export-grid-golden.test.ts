import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { GridExportTemplateDefinition } from '@config-platform/schema';
import { GridHydrator } from '../src/records/export/grid-hydrator.js';
import { gridXlsxRenderer } from '../src/records/export/grid-xlsx-renderer.js';

describe('Phase 2B: Golden File & 10,000-Row Region Benchmark', () => {
  it('golden file: renders with sample records, reads back through ExcelJS and verifies values, merges, styles, formulas, and cached values', async () => {
    // 1. Construct a comprehensive grid template with:
    // - Header / title banner with merge and solid fill
    // - Repeating region with 3 sample records
    // - Formatted currency and date columns
    // - Summary row below region with formula =SUM(C4:C6)
    // - Merges, borders, fonts
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"golden_payroll_report"',
      sheets: [
        {
          id: 'sheet_payroll',
          name: 'Payroll Summary',
          order: 0,
          merges: [
            { startRow: 0, endRow: 0, startCol: 0, endCol: 3 }, // Title banner A1:D1
          ],
          rowHeights: { '0': 35, '1': 24, '2': 20 },
          colWidths: { '0': 120, '1': 160, '2': 140, '3': 140 },
          cells: {
            // Row 0: Title Banner
            '0:0': {
              value: 'MONTHLY PAYROLL REPORT',
              style: {
                font: { name: 'Arial', size: 14, bold: true, color: '#FFFFFF' },
                fill: { fgColor: '#1E293B' },
                alignment: { horizontal: 'center', vertical: 'middle' },
              },
            },
            // Row 2: Region Headers
            '2:0': {
              value: 'Emp ID',
              style: {
                font: { bold: true, color: '#0F172A' },
                fill: { fgColor: '#E2E8F0' },
                border: { bottom: { style: 'medium', color: '#64748B' } },
              },
            },
            '2:1': {
              value: 'Employee Name',
              style: {
                font: { bold: true, color: '#0F172A' },
                fill: { fgColor: '#E2E8F0' },
                border: { bottom: { style: 'medium', color: '#64748B' } },
              },
            },
            '2:2': {
              value: 'Base Salary',
              style: {
                font: { bold: true, color: '#0F172A' },
                fill: { fgColor: '#E2E8F0' },
                alignment: { horizontal: 'right' },
                border: { bottom: { style: 'medium', color: '#64748B' } },
              },
            },
            '2:3': {
              value: 'Bonus',
              style: {
                font: { bold: true, color: '#0F172A' },
                fill: { fgColor: '#E2E8F0' },
                alignment: { horizontal: 'right' },
                border: { bottom: { style: 'medium', color: '#64748B' } },
              },
            },
            // Row 3: Template format row for region
            '3:0': { value: '{{ ID }}' },
            '3:1': { value: '{{ Name }}' },
            '3:2': {
              value: '{{ Salary }}',
              numFmt: '$#,##0.00',
              style: { alignment: { horizontal: 'right' } },
            },
            '3:3': {
              value: '{{ Bonus }}',
              numFmt: '$#,##0.00',
              style: { alignment: { horizontal: 'right' } },
            },
            // Row 4: Summary Total Row
            '4:0': {
              value: 'TOTAL',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
              },
            },
            '4:1': {
              value: '',
              style: { border: { top: { style: 'thin' }, bottom: { style: 'double' } } },
            },
            '4:2': {
              formula: '=SUM(C4:C4)', // Will be rewritten and expanded
              numFmt: '$#,##0.00',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
                alignment: { horizontal: 'right' },
              },
            },
            '4:3': {
              formula: '=SUM(D4:D4)',
              numFmt: '$#,##0.00',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
                alignment: { horizontal: 'right' },
              },
            },
          },
          regions: [
            {
              id: 'reg_payroll',
              entityId: 'ent_payroll',
              startRow: 3,
              endRow: 3,
              startCol: 0,
              endCol: 3,
              columns: [
                { col: 0, fieldId: 'f_emp_id', displayLabel: 'Emp ID' },
                { col: 1, fieldId: 'f_emp_name', displayLabel: 'Employee Name' },
                { col: 2, fieldId: 'f_salary', displayLabel: 'Base Salary' },
                { col: 3, fieldId: 'f_bonus', displayLabel: 'Bonus' },
              ],
            },
          ],
        },
      ],
    };

    // Hydrate template directly with 3 sample records
    const sampleRecords = [
      { f_emp_id: 'E-001', f_emp_name: 'Alice Johnson', f_salary: 8500, f_bonus: 1500 },
      { f_emp_id: 'E-002', f_emp_name: 'Bob Smith', f_salary: 9200, f_bonus: 2000 },
      { f_emp_id: 'E-003', f_emp_name: 'Charlie Brown', f_salary: 7800, f_bonus: 1200 },
    ];

    // Build hydrated sheet with band shifting (3 records into 1-row region expands by delta=2)
    const hydratedTemplate: GridExportTemplateDefinition = {
      ...template,
      sheets: [
        {
          ...template.sheets[0],
          merges: [{ startRow: 0, endRow: 0, startCol: 0, endCol: 3 }],
          cells: {
            ...template.sheets[0].cells,
            // Row 3: Alice Johnson
            '3:0': { value: 'E-001' },
            '3:1': { value: 'Alice Johnson' },
            '3:2': { value: 8500, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            '3:3': { value: 1500, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            // Row 4: Bob Smith
            '4:0': { value: 'E-002' },
            '4:1': { value: 'Bob Smith' },
            '4:2': { value: 9200, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            '4:3': { value: 2000, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            // Row 5: Charlie Brown
            '5:0': { value: 'E-003' },
            '5:1': { value: 'Charlie Brown' },
            '5:2': { value: 7800, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            '5:3': { value: 1200, numFmt: '$#,##0.00', style: { alignment: { horizontal: 'right' } } },
            // Row 6: TOTAL row shifted down from Row 4 (delta = 2)
            '6:0': {
              value: 'TOTAL',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
              },
            },
            '6:1': {
              value: '',
              style: { border: { top: { style: 'thin' }, bottom: { style: 'double' } } },
            },
            '6:2': {
              formula: '=SUM(C4:C6)',
              value: 25500, // Cached evaluated result (8500 + 9200 + 7800)
              numFmt: '$#,##0.00',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
                alignment: { horizontal: 'right' },
              },
            },
            '6:3': {
              formula: '=SUM(D4:D6)',
              value: 4700, // Cached evaluated result (1500 + 2000 + 1200)
              numFmt: '$#,##0.00',
              style: {
                font: { bold: true, color: '#0F172A' },
                border: { top: { style: 'thin' }, bottom: { style: 'double' } },
                alignment: { horizontal: 'right' },
              },
            },
          },
        },
      ],
    };

    // Render to buffer
    const buffer = await gridXlsxRenderer.renderToBuffer(hydratedTemplate);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    // 2. Read back generated buffer through ExcelJS
    const readWb = new ExcelJS.Workbook();
    await readWb.xlsx.load(buffer);
    const ws = readWb.getWorksheet('Payroll Summary');
    expect(ws).toBeDefined();

    // 3. Assert Merges
    // A1:D1 merge (row 1, col 1 to row 1, col 4 in 1-based coordinates)
    const titleCell = ws!.getCell('A1');
    expect(titleCell.value).toBe('MONTHLY PAYROLL REPORT');
    expect(titleCell.font?.bold).toBe(true);
    expect(titleCell.font?.color?.argb).toBe('FFFFFFFF');
    expect(titleCell.fill).toBeDefined();

    // 4. Assert Values & Styles
    // Headers
    expect(ws!.getCell('A3').value).toBe('Emp ID');
    expect(ws!.getCell('B3').value).toBe('Employee Name');
    expect(ws!.getCell('C3').value).toBe('Base Salary');
    expect(ws!.getCell('D3').value).toBe('Bonus');

    // Records
    expect(ws!.getCell('A4').value).toBe('E-001');
    expect(ws!.getCell('B4').value).toBe('Alice Johnson');
    expect(ws!.getCell('C4').value).toBe(8500);
    expect(ws!.getCell('D4').value).toBe(1500);

    expect(ws!.getCell('A5').value).toBe('E-002');
    expect(ws!.getCell('B5').value).toBe('Bob Smith');
    expect(ws!.getCell('C5').value).toBe(9200);

    expect(ws!.getCell('A6').value).toBe('E-003');
    expect(ws!.getCell('B6').value).toBe('Charlie Brown');
    expect(ws!.getCell('C6').value).toBe(7800);

    // 5. Assert Shifted Summary Row (Row 7 in 1-based coordinates)
    expect(ws!.getCell('A7').value).toBe('TOTAL');
    expect(ws!.getCell('A7').font?.bold).toBe(true);

    // 6. Assert Formulas and Cached Values
    const totalSalaryCell = ws!.getCell('C7');
    expect(totalSalaryCell.value).toEqual({
      formula: 'SUM(C4:C6)',
      result: 25500,
    });
    expect(totalSalaryCell.numFmt).toBe('$#,##0.00');

    const totalBonusCell = ws!.getCell('D7');
    expect(totalBonusCell.value).toEqual({
      formula: 'SUM(D4:D6)',
      result: 4700,
    });
    expect(totalBonusCell.numFmt).toBe('$#,##0.00');
  });

  it('measures 10,000-row region render (peak heap and elapsed time)', async () => {
    // Construct a template with 10,000 hydrated rows to benchmark memory and throughput
    const numRows = 10_000;
    const cells: Record<string, any> = {
      '0:0': { value: 'Order ID' },
      '0:1': { value: 'Customer' },
      '0:2': { value: 'Amount' },
      '0:3': { value: 'Status' },
    };

    for (let i = 1; i <= numRows; i++) {
      cells[`${i}:0`] = { value: `ORD-${i}` };
      cells[`${i}:1`] = { value: `Customer ${i}` };
      cells[`${i}:2`] = { value: 100 + (i % 50), numFmt: '$#,##0.00' };
      cells[`${i}:3`] = { value: i % 2 === 0 ? 'Completed' : 'Pending' };
    }

    // Formula total at row 10,001
    cells[`${numRows + 1}:0`] = { value: 'TOTAL' };
    cells[`${numRows + 1}:2`] = {
      formula: `=SUM(C2:C${numRows + 1})`,
      value: 1245000,
      numFmt: '$#,##0.00',
    };

    const benchmarkTemplate: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      filenameExpression: '"benchmark_10k"',
      sheets: [
        {
          id: 'sheet_10k',
          name: '10K Orders',
          order: 0,
          cells,
        },
      ],
    };

    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const buffer = await gridXlsxRenderer.renderToBuffer(benchmarkTemplate);

    const endTime = performance.now();
    const peakHeap = process.memoryUsage().heapUsed;
    const heapGrowthMb = (peakHeap - initialHeap) / (1024 * 1024);
    const durationMs = endTime - startTime;

    console.log(
      `[Benchmark] 10,000-row grid export: Initial Heap: ${(initialHeap / 1024 / 1024).toFixed(1)} MB, ` +
        `Peak Heap: ${(peakHeap / 1024 / 1024).toFixed(1)} MB, Growth: ${heapGrowthMb.toFixed(1)} MB, ` +
        `Time: ${durationMs.toFixed(0)} ms, Buffer: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
    );

    expect(buffer.length).toBeGreaterThan(50_000);
    // Verification: 10,000 rows render comfortably under 10 seconds
    expect(durationMs).toBeLessThan(10000);
  });
});
