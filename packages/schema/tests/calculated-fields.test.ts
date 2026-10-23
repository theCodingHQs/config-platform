import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCalculatedFields,
  calculateRecord,
  formulaReferences,
  FormulaError,
  formulaProblem,
  type FormulaField,
} from '../dist/calculated-fields.js';
import { SOLUTION_TEMPLATES } from '../dist/solution-templates.js';

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

  it('a text field never stores "NaN" from maths that went wrong', () => {
    const fields: FormulaField[] = [{ name: 'note', type: 'text' }, { name: 't', type: 'text', config: { formula: 'note - 1' } }];
    const plan = planCalculatedFields(fields, targets);
    assert.equal(calculateRecord(plan, fields, { note: 'abc' }).t, null);
  });
});

describe('formula type check (field dialog and saving a field)', () => {
  const inspection: FormulaField[] = [
    { name: 'machine', type: 'reference', config: { targetEntityId: 't_machine' } },
    { name: 'inspected_on', type: 'date' },
    { name: 'sample_size', type: 'number' },
    { name: 'defects', type: 'number' },
    { name: 'notes', type: 'text' },
    { name: 'checked', type: 'boolean' },
    { name: 'defect_rate', type: 'number', config: { formula: 'if(sample_size > 0, round(defects * 100 / sample_size, 2), 0)' } },
  ];
  const problem = (type: string, formula: string) =>
    formulaProblem({ name: 'new_field', type, config: { formula } }, [...inspection, { name: 'new_field', type, config: { formula } }], targets);

  it('refuses maths on text, and says how to join text instead', () => {
    const message = problem('text', 'machine.name - defect_rate');
    assert.match(message!, /Can't subtract with text: machine\.name is text/);
    assert.match(message!, /concat\(/);
    assert.equal(problem('text', 'machine.name + " - " + defect_rate'), null);
    assert.equal(problem('text', 'concat(machine.name, " - ", defect_rate)'), null);
    assert.match(problem('number', 'notes * 2')!, /If notes holds numbers, make it a Number field/);
  });

  it('a number field must get a number', () => {
    assert.match(problem('number', 'if(defect_rate <= 2, "Pass", "Reject")')!, /gives text, but this is a Number field/);
    assert.equal(problem('text', 'if(defect_rate <= 2, "Pass", "Reject")'), null);
    assert.equal(problem('number', 'round(defects / sample_size * 100, 1)'), null);
    assert.equal(problem('boolean', 'defect_rate > 2'), null);
  });

  it('refuses comparing numbers with text, and functions given the wrong kind of data', () => {
    assert.match(problem('boolean', 'defect_rate > notes')!, /compares defect_rate \(a number\) with notes \(text\)/);
    assert.equal(problem('boolean', 'inspected_on > "2026-01-01"'), null);
    assert.match(problem('number', 'sum(defects, notes)')!, /sum\(\) works on numbers, but notes is text/);
    assert.match(problem('number', 'sum(range("sample_size", "notes"))')!, /includes text/);
    assert.equal(problem('number', 'countTrue(range("checked", "checked"))'), null);
    assert.match(problem('text', 'inspected_on + 7')!, /adding a number to a date isn't supported/);
  });

  it('checks how many values a function takes', () => {
    assert.match(problem('text', 'if(defect_rate > 2, "Reject")')!, /if\(\) takes 3 values: if\(condition, value when true, value when false\)/);
    assert.match(problem('number', 'round()')!, /round\(\) takes 1 or 2 values/);
  });

  it('still reports unknown fields and syntax, without "Formula for …" in front', () => {
    assert.equal(problem('number', 'defectz * 2'), "Unknown field 'defectz'");
    assert.match(problem('number', 'defects *')!, /^Formula syntax error/);
  });

  it('an older formula that fails the check doesn\'t stop records being calculated', () => {
    const fields: FormulaField[] = [...inspection, { name: 'label', type: 'text', config: { formula: 'machine.name - defect_rate' } }];
    assert.doesNotThrow(() => planCalculatedFields(fields, targets));
    assert.throws(() => planCalculatedFields(fields, targets, { checkTypesOf: ['label'] }), /Formula for 'label': Can't subtract/);
  });

  it('every ready-made template passes the check', () => {
    for (const template of SOLUTION_TEMPLATES) {
      const byKey = new Map(template.entities.map((e) => [e.key, e]));
      for (const entity of template.entities) {
        const fields: FormulaField[] = entity.fields.map((f) => ({ name: f.name, type: f.type, config: { ...f.config, ...(f.link ? { targetEntityId: f.link } : {}) } }));
        const linked = (link: FormulaField) => byKey.get(String(link.config?.targetEntityId))?.fields;
        const calculated = fields.filter((f) => f.config?.formula).map((f) => f.name);
        assert.doesNotThrow(() => planCalculatedFields(fields, linked, { checkTypesOf: calculated }), `${template.name} → ${entity.name}`);
      }
    }
    const sheet = sheetFields.filter((f) => f.config?.formula).map((f) => f.name);
    assert.doesNotThrow(() => planCalculatedFields(sheetFields, targets, { checkTypesOf: sheet }));
  });
});
