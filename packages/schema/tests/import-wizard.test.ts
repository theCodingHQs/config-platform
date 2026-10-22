import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImportColumns, fieldNameFromHeader, wizardFieldSpec, entityNameFromTitle } from '../dist/import-wizard.js';

describe('import wizard: suggesting fields from a sheet', () => {
  it('reads a factory production sheet', () => {
    const rows = [
      { Machine: 'CNC Mill 01', 'Work Center': 'Machining', Month: '2026-10-01T00:00:00.000Z', 'Planned Days': '26', 'Day 1': 'x', 'Day 2': '', Status: 'Running', Notes: 'Spindle check' },
      { Machine: 'CNC Mill 02', 'Work Center': 'Machining', Month: '2026-10-01T00:00:00.000Z', 'Planned Days': '24', 'Day 1': '', 'Day 2': 'x', Status: 'Running', Notes: '' },
      { Machine: 'Lathe L-03', 'Work Center': 'Machining', Month: '2026-09-01T00:00:00.000Z', 'Planned Days': '22', 'Day 1': 'x', 'Day 2': 'x', Status: 'Down', Notes: 'Waiting for part' },
      { Machine: 'Press P-04', 'Work Center': 'Stamping', Month: '2026-09-01T00:00:00.000Z', 'Planned Days': '20', 'Day 1': 'x', 'Day 2': '', Status: 'Running', Notes: '' },
      { Machine: 'Paint PL-07', 'Work Center': 'Finishing', Month: '2026-09-01T00:00:00.000Z', 'Planned Days': '18', 'Day 1': '', 'Day 2': '', Status: 'Idle', Notes: '' },
    ];
    const headers = ['Machine', 'Work Center', 'Month', 'Planned Days', 'Day 1', 'Day 2', 'Status', 'Notes', 'Empty'];
    const result = analyzeImportColumns(headers, rows);
    const byHeader = Object.fromEntries(result.columns.map((c) => [c.header, c]));

    assert.equal(byHeader['Machine'].kind, 'text');
    assert.equal(byHeader['Work Center'].kind, 'select');
    assert.deepEqual(byHeader['Work Center'].options, ['Finishing', 'Machining', 'Stamping']);
    assert.equal(byHeader['Month'].kind, 'month');
    assert.equal(byHeader['Planned Days'].kind, 'number');
    assert.equal(byHeader['Day 1'].kind, 'boolean');
    assert.equal(byHeader['Day 1'].name, 'day_1');
    assert.equal(byHeader['Status'].kind, 'select');
    assert.equal(byHeader['Notes'].kind, 'text');
    // A column with no values isn't suggested
    assert.equal(byHeader['Empty'].include, false);
    assert.equal(byHeader['Planned Days'].name, 'planned_days');
  });

  it('works out the date order of text dates, and says when it cannot', () => {
    const uk = analyzeImportColumns(['When'], [{ When: '25/10/2026' }, { When: '03/11/2026' }]);
    assert.equal(uk.dateFormat, 'DD/MM/YYYY');
    assert.equal(uk.columns[0].kind, 'date');
    const us = analyzeImportColumns(['When'], [{ When: '10/25/2026' }, { When: '11/03/2026' }]);
    assert.equal(us.dateFormat, 'MM/DD/YYYY');
    const unclear = analyzeImportColumns(['When'], [{ When: '01/02/2026' }, { When: '03/04/2026' }]);
    assert.equal(unclear.dateFormatAmbiguous, true);
  });

  it('stays conservative so the import succeeds', () => {
    const mixed = analyzeImportColumns(['Qty'], [{ Qty: '5' }, { Qty: 'n/a' }, { Qty: '7' }]);
    assert.equal(mixed.columns[0].kind, 'text');
    const thousands = analyzeImportColumns(['Units'], [{ Units: '1,200' }, { Units: '950' }]);
    assert.equal(thousands.columns[0].kind, 'text');
    // Few repeated values are a choice list only with enough rows to tell
    const short = analyzeImportColumns(['Shift'], [{ Shift: 'A' }, { Shift: 'B' }]);
    assert.equal(short.columns[0].kind, 'text');
  });

  it('makes safe, unique names', () => {
    const used = new Set<string>();
    assert.equal(fieldNameFromHeader('Attainment %', used), 'attainment_pct');
    assert.equal(fieldNameFromHeader('Attainment %', used), 'attainment_pct_2');
    assert.equal(fieldNameFromHeader('2nd shift', used), 'f_2nd_shift');
    assert.equal(fieldNameFromHeader('ID', used), 'id_value');
    assert.equal(fieldNameFromHeader('Température', used), 'temperature');
    assert.equal(entityNameFromTitle('Production Tracker 2026.xlsx'), 'production_tracker_2026');
  });

  it('turns reviewed columns into fields', () => {
    assert.deepEqual(wizardFieldSpec({ name: 'month', label: 'Month', kind: 'month' }), {
      name: 'month', label: 'Month', type: 'date', config: { granularity: 'month' },
    });
    assert.deepEqual(wizardFieldSpec({ name: 'status', label: 'Status', kind: 'select', options: ['Down', 'Running'] }).config, {
      options: [{ label: 'Down', value: 'Down' }, { label: 'Running', value: 'Running' }],
    });
  });
});
