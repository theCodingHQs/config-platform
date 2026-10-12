import { describe, it, expect } from 'vitest';
import {
  buildPersonalMonthlyBudgetBenchmark,
  type GridExportTemplateDefinition,
} from '@config-platform/schema';
import {
  gridTemplateToUniver,
  univerToGridTemplate,
} from '../src/studio/export-grid/univer-adapter';

describe('Univer Spreadsheet Engine Adapter Round-Trip Tests', () => {
  it('losslessly round-trips the full Personal Monthly Budget benchmark', () => {
    const original = buildPersonalMonthlyBudgetBenchmark();

    // 1. Convert Grid JSON -> Univer Workbook Snapshot
    const univerSnapshot = gridTemplateToUniver(original);
    expect(univerSnapshot).toBeDefined();
    expect(univerSnapshot.sheets).toBeDefined();

    // 2. Convert Univer Workbook Snapshot -> Grid JSON
    const roundTripped = univerToGridTemplate(univerSnapshot);

    // 3. Deep equality assertion: roundTripped equals original
    expect(roundTripped).toEqual(original);
  });

  it('losslessly preserves merges', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"merges_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_merges',
          name: 'Merges Test',
          order: 0,
          merges: [
            { startRow: 0, startCol: 0, endRow: 0, endCol: 5 },
            { startRow: 2, startCol: 1, endRow: 4, endCol: 3 },
          ],
          cells: {
            '0:0': { value: 'Merged Header' },
          },
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].merges).toEqual(original.sheets[0].merges);
    expect(restored).toEqual(original);
  });

  it('losslessly preserves styles (font, fill, alignment, wrapText, borders)', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"styles_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_styles',
          name: 'Styles Test',
          order: 0,
          merges: [],
          cells: {
            '0:0': {
              value: 'Styled Cell',
              style: {
                font: {
                  name: 'Arial',
                  size: 14,
                  bold: true,
                  italic: true,
                  underline: true,
                  strike: true,
                  color: '#1E293B',
                },
                fill: {
                  fgColor: '#F1F5F9',
                },
                alignment: {
                  horizontal: 'center',
                  vertical: 'middle',
                  wrapText: true,
                },
                border: {
                  top: { style: 'thin', color: '#94A3B8' },
                  bottom: { style: 'thin', color: '#94A3B8' },
                  left: { style: 'thin', color: '#94A3B8' },
                  right: { style: 'thin', color: '#94A3B8' },
                },
              },
            },
          },
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].cells['0:0'].style).toEqual(original.sheets[0].cells['0:0'].style);
    expect(restored).toEqual(original);
  });

  it('losslessly preserves number formats', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"numfmt_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_numfmt',
          name: 'Number Formats',
          order: 0,
          merges: [],
          cells: {
            '0:0': { value: 1250.5, numFmt: '$#,##0.00' },
            '0:1': { value: -45, numFmt: '$#,##0;($#,##0);$0' },
            '0:2': { value: 0.155, numFmt: '0.0%' },
          },
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].cells['0:0'].numFmt).toBe('$#,##0.00');
    expect(restored.sheets[0].cells['0:1'].numFmt).toBe('$#,##0;($#,##0);$0');
    expect(restored.sheets[0].cells['0:2'].numFmt).toBe('0.0%');
    expect(restored).toEqual(original);
  });

  it('losslessly preserves formulas', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"formulas_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_formula',
          name: 'Formulas',
          order: 0,
          merges: [],
          cells: {
            '0:0': { value: 100 },
            '1:0': { value: 200 },
            '2:0': { value: 300, formula: 'SUM(A1:A2)' },
            '3:0': { value: 50, formula: 'A3-250' },
          },
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].cells['2:0'].formula).toBe('SUM(A1:A2)');
    expect(restored.sheets[0].cells['3:0'].formula).toBe('A3-250');
    expect(restored).toEqual(original);
  });

  it('losslessly preserves conditional formats (iconSet rules and cfvo thresholds)', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"cf_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_cf',
          name: 'CF Test',
          order: 0,
          merges: [],
          cells: {},
          regions: [],
          conditionalFormats: [
            {
              ref: 'E12:E21',
              type: 'iconSet',
              iconSet: {
                iconSet: '3TrafficLights1',
                reverse: false,
                showValue: true,
                cfvo: [
                  { type: 'percent', value: 0 },
                  { type: 'percent', value: 33 },
                  { type: 'percent', value: 67 },
                ],
              },
            },
          ],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].conditionalFormats).toEqual(original.sheets[0].conditionalFormats);
    expect(restored).toEqual(original);
  });

  it('losslessly preserves freeze panes', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"freeze_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_freeze',
          name: 'Freeze Test',
          order: 0,
          freezePanes: { rowSplit: 2, colSplit: 1 },
          merges: [],
          cells: {},
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].freezePanes).toEqual({ rowSplit: 2, colSplit: 1 });
    expect(restored).toEqual(original);
  });

  it('losslessly preserves structured entityId/fieldId bindings and repeating regions', () => {
    const original: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"bindings_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_bindings',
          name: 'Bindings Test',
          order: 0,
          merges: [],
          cells: {
            '0:0': {
              value: '{{ Customer Balance }}',
              binding: {
                entityId: 't_customers',
                fieldId: 'c_account_balance',
                displayLabel: 'Customer Balance',
              },
            },
            '5:0': {
              value: '{{ Customer Name }}',
              binding: {
                entityId: 't_customers',
                fieldId: 'c_name',
                displayLabel: 'Customer Name',
              },
            },
            '5:1': {
              value: '{{ Balance }}',
              binding: {
                entityId: 't_customers',
                fieldId: 'c_balance',
                displayLabel: 'Balance',
              },
            },
          },
          regions: [
            {
              id: 'reg_customers',
              entityId: 't_customers',
              displayLabel: 'Customer Records Band',
              startRow: 5,
              endRow: 25,
              startCol: 0,
              endCol: 3,
              columns: [
                { col: 0, fieldId: 'c_name', displayLabel: 'Customer Name' },
                { col: 1, fieldId: 'c_balance', displayLabel: 'Balance' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    const snapshot = gridTemplateToUniver(original);
    const restored = univerToGridTemplate(snapshot);
    expect(restored.sheets[0].cells['0:0'].binding).toEqual(original.sheets[0].cells['0:0'].binding);
    expect(restored.sheets[0].cells['0:0'].value).toBe('{{ Customer Balance }}');
    expect(restored.sheets[0].regions).toEqual(original.sheets[0].regions);
    expect(restored).toEqual(original);
  });

  it('binding row placeholder text round-trips through the Univer adapter', () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"placeholder_test"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Employees',
          order: 0,
          merges: [],
          cells: {},
          regions: [
            {
              id: 'reg_emp',
              entityId: 't_employee',
              displayLabel: 'Employees Region',
              startRow: 2,
              endRow: 10,
              startCol: 0,
              endCol: 2,
              columns: [
                { col: 0, fieldId: 'f_first_name', displayLabel: 'First Name' },
                { col: 1, fieldId: 'f_salary', displayLabel: 'Salary' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    // 1. Adapter populates placeholder text in first row of region
    const univerData = gridTemplateToUniver(template);
    const sheetData = univerData.sheets['sheet_1'];
    expect(sheetData.cellData[2][0].v).toBe('{{ First Name }}');
    expect(sheetData.cellData[2][1].v).toBe('{{ Salary }}');

    // 2. Serializing back retains the placeholder text in the binding row
    const restored = univerToGridTemplate(univerData);
    expect(restored.sheets[0].cells['2:0'].value).toBe('{{ First Name }}');
    expect(restored.sheets[0].cells['2:1'].value).toBe('{{ Salary }}');
    expect(restored.sheets[0].cells['2:0'].binding).toEqual({
      entityId: 't_employee',
      fieldId: 'f_first_name',
      displayLabel: 'First Name',
    });
  });

  it('editing a bound cell keeps the binding intact', () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"edit_bound_cell"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Sheet 1',
          order: 0,
          merges: [],
          cells: {
            '1:1': {
              value: '{{ Total Revenue }}',
              binding: {
                entityId: 't_finance',
                fieldId: 'f_rev',
                displayLabel: 'Total Revenue',
              },
            },
          },
          regions: [],
          conditionalFormats: [],
        },
      ],
    };

    const univerData = gridTemplateToUniver(template);
    expect(univerData.sheets['sheet_1'].cellData[1][1].v).toBe('{{ Total Revenue }}');

    // Simulate user editing the cell text in Univer
    univerData.sheets['sheet_1'].cellData[1][1].v = 'Accidentally Edited Text';

    // The binding remains intact when serialized back
    const restored = univerToGridTemplate(univerData);
    expect(restored.sheets[0].cells['1:1'].binding).toEqual({
      entityId: 't_finance',
      fieldId: 'f_rev',
      displayLabel: 'Total Revenue',
    });
    // Stores placeholder derived from binding label
    expect(restored.sheets[0].cells['1:1'].value).toBe('{{ Total Revenue }}');
  });

  it('a template saved from the designer contains no sample data rows', () => {
    const template: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"no_sample_data"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Sheet 1',
          order: 0,
          merges: [],
          cells: {
            '0:0': { value: 'Header Report' },
          },
          regions: [
            {
              id: 'reg_1',
              entityId: 't_sales',
              displayLabel: 'Sales Data',
              startRow: 2,
              endRow: 6,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: 'f_rep', displayLabel: 'Representative' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    };

    const univerData = gridTemplateToUniver(template);

    // Simulate preview or mock injecting sample data rows inside the region
    univerData.sheets['sheet_1'].cellData[3] = {
      0: { v: 'John Doe Sample' },
    };
    univerData.sheets['sheet_1'].cellData[4] = {
      0: { v: 'Jane Smith Sample' },
    };

    // Serialize back as saved template
    const saved = univerToGridTemplate(univerData);

    // Header outside region is kept
    expect(saved.sheets[0].cells['0:0'].value).toBe('Header Report');

    // Binding row (startRow 2) has placeholder
    expect(saved.sheets[0].cells['2:0'].value).toBe('{{ Representative }}');

    // Rows 3 and 4 contain NO sample data rows in the saved template!
    expect(saved.sheets[0].cells['3:0']).toBeUndefined();
    expect(saved.sheets[0].cells['4:0']).toBeUndefined();
  });
});

