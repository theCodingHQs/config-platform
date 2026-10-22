import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCalculatedFields,
  calculateRecord,
  formulaReferences,
  FormulaError,
  type FormulaField,
} from '../dist/calculated-fields.js';

const days = Array.from({ length: 31 }, (_, i) => ({ name: `day_${String(i + 1).padStart(2, '0')}`, type: 'boolean' }));

// The production sheet, with its totals as calculated fields
const sheetFields: FormulaField[] = [
  { name: 'machine', type: 'reference', config: { targetEntityId: 't_machine' } },
  { name: 'month', type: 'date' },
  { name: 'planned_days', type: 'number' },
  ...days,
  // Declared before what it depends on: order of evaluation comes from dependencies
  { name: 'attainment_pct', type: 'number', config: { formula: 'if(planned_days > 0, round(days_met * 100 / planned_days, 1), 0)' } },
  { name: 'days_met', type: 'number', config: { formula: 'countTrue(range("day_01", "day_31"))' } },
  { name: 'gap_days', type: 'number', config: { formula: 'max(planned_days - days_met, 0)' } },
  { name: 'machine_name', type: 'text', config: { formula: 'machine.name' } },
  { name: 'label', type: 'text', config: { formula: 'concat(machine.name, " (", machine.work_center, ")")' } },
];
const machineFields: FormulaField[] = [{ name: 'name', type: 'text' }, { name: 'work_center', type: 'text' }];
const targets = (link: FormulaField) => (link.config?.targetEntityId === 't_machine' ? machineFields : undefined);

describe('calculated fields', () => {
  it('orders formulas by dependency and calculates a production sheet', () => {
    const plan = planCalculatedFields(sheetFields, targets);
    const order = plan.map((f) => f.name);
    assert.ok(order.indexOf('days_met') < order.indexOf('attainment_pct'));
    assert.ok(order.indexOf('days_met') < order.indexOf('gap_days'));

    const record: Record<string, unknown> = { machine: 'm1', planned_days: 26 };
    for (let d = 1; d <= 31; d++) record[`day_${String(d).padStart(2, '0')}`] = d <= 14;
    const result = calculateRecord(plan, sheetFields, record, { machine: { name: 'CNC Mill 01', work_center: 'Machining' } });
    assert.deepEqual(result, {
      days_met: 14,
      attainment_pct: 53.8,
      gap_days: 12,
      machine_name: 'CNC Mill 01',
      label: 'CNC Mill 01 (Machining)',
    });

    // No plan: no division by zero; no linked machine: lookups are empty
    const empty = calculateRecord(plan, sheetFields, { planned_days: 0 }, { machine: null });
    assert.equal(empty.attainment_pct, 0);
    assert.equal(empty.days_met, 0);
    assert.equal(empty.machine_name, null);
  });

  it('rejects formulas that cannot be calculated, with a clear reason', () => {
    const check = (formula: string, type = 'number', extra: FormulaField[] = []) =>
      assert.throws(() => planCalculatedFields([...sheetFields.slice(0, 34), ...extra, { name: 'x', type, config: { formula } }], targets), FormulaError);
    check('planned_dayz * 2');                 // unknown field
    check('evil(planned_days)');               // unknown function
    check('planned_days +');                   // syntax
    check('range("day_31", "day_01")');        // reversed range
    check('month.name');                       // lookup through a non-link field
    check('machine.serial');                   // lookup of a missing target field
    check('machine.owner.name');               // nested lookups
    check('x + 1');                            // uses itself
    check('planned_days', 'date');             // dates can't be calculated (yet)
    assert.throws(
      () => planCalculatedFields([
        { name: 'a', type: 'number', config: { formula: 'b + 1' } },
        { name: 'b', type: 'number', config: { formula: 'a + 1' } },
      ], targets),
      /loop: a → b → a/,
    );
  });

  it('lists what a formula uses (for rename/delete protection)', () => {
    const refs = formulaReferences('round(days_met * 100 / planned_days, 1) + countTrue(range("day_01", "day_07")) + len(machine.name)'.replace(' + len(machine.name)', ''));
    assert.deepEqual([...refs.fields].sort(), ['days_met', 'planned_days']);
    assert.deepEqual(refs.ranges, [['day_01', 'day_07']]);
    assert.deepEqual(formulaReferences('upper(machine.name)').lookups, [{ link: 'machine', field: 'name' }]);
  });

  it('a formula that fails at run time stores nothing instead of a wrong value', () => {
    const fields: FormulaField[] = [{ name: 'note', type: 'text' }, { name: 'n', type: 'number', config: { formula: 'note * 2' } }];
    const plan = planCalculatedFields(fields, targets);
    assert.equal(calculateRecord(plan, fields, { note: 'abc' }).n, null);
    assert.equal(calculateRecord(plan, fields, { note: '21' }).n, 42);
  });
});
