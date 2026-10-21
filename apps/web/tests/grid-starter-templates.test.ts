import { describe, expect, it } from 'vitest';
import {
  buildGridStarterTemplate,
  GRID_STARTER_TEMPLATES,
  GridExportTemplateDefinitionSchema,
  type ExecutiveReportEntityInput,
} from '@config-platform/schema';

const entity: ExecutiveReportEntityInput = {
  id: 'ent_employee',
  name: 'employee',
  label: 'Employee',
  fields: [
    { id: 'f_name', name: 'name', label: 'Name', type: 'text' },
    { id: 'f_department', name: 'department', label: 'Department', type: 'text' },
    { id: 'f_salary', name: 'salary', label: 'Salary', type: 'currency' },
    { id: 'f_hire_date', name: 'hire_date', label: 'Hire Date', type: 'date' },
    { id: 'f_status', name: 'status', label: 'Status', type: 'text' },
    { id: 'f_owner', name: 'owner', label: 'Owner', type: 'text' },
  ],
};

const DATA_STARTERS = GRID_STARTER_TEMPLATES.filter((starter) => starter.category === 'data');

describe('Grid starter templates', () => {
  it('provides four distinct entity starter layouts plus the interactive production target tracker', () => {
    expect(GRID_STARTER_TEMPLATES.map((starter) => starter.id)).toEqual([
      'executive',
      'operations',
      'financial',
      'audit',
      'production',
    ]);
    expect(GRID_STARTER_TEMPLATES.find((starter) => starter.id === 'production')?.category).toBe('interactive');

    const titles = DATA_STARTERS.map((starter) =>
      buildGridStarterTemplate(entity, starter.id).sheets[0].cells['0:0'].value,
    );
    expect(new Set(titles).size).toBe(4);
  });

  it.each(DATA_STARTERS)('builds a valid $name workbook without fake data rows', ({ id }) => {
    const template = buildGridStarterTemplate(entity, id);
    const parsed = GridExportTemplateDefinitionSchema.safeParse(template);

    expect(parsed.success).toBe(true);
    expect(template.datasets[0].source.baseEntityId).toBe(entity.id);
    expect(template.sheets[0].regions).toHaveLength(1);
    expect(template.sheets[0].regions[0].startRow).toBe(8);
    expect(template.sheets[0].regions[0].endRow).toBe(17);
    expect(template.sheets[0].cells['4:6'].binding).toMatchObject({
      datasetId: template.datasets[0].id,
      aggregateId: 'agg_max',
    });
    const numericColumn = template.datasets[0].fields.findIndex((field) => field.fieldPath === 'salary');
    const numericColumnLetter = String.fromCharCode(65 + numericColumn);
    expect(template.sheets[0].cells[`18:${numericColumn}`].formula).toBe(
      `SUM(${numericColumnLetter}9:${numericColumnLetter}18)`,
    );

    for (let row = 9; row <= 17; row++) {
      expect(template.sheets[0].cells[`${row}:0`].value).toBe('');
    }
  });

  it('prioritizes useful columns for operations, finance, and audit layouts', () => {
    const fieldNames = (id: 'operations' | 'financial' | 'audit') =>
      buildGridStarterTemplate(entity, id).datasets[0].fields.map((field) => field.fieldPath);

    expect(fieldNames('operations')[0]).toBe('status');
    expect(fieldNames('financial')[0]).toBe('salary');
    expect(fieldNames('audit')[0]).toBe('hire_date');
    expect(buildGridStarterTemplate(entity, 'audit').datasets[0].sort).toEqual([
      { fieldPath: 'hire_date', direction: 'desc' },
    ]);
  });

  it('does not invent bindings when entity field metadata is unavailable', () => {
    const template = buildGridStarterTemplate(
      { id: 'ent_empty', name: 'empty', label: 'Empty' },
      'executive',
    );

    expect(template.datasets[0].fields).toEqual([]);
    expect(template.sheets[0].regions).toEqual([]);
    expect(template.sheets[0].cells['7:0'].value).toBe('No fields available for this entity');
    expect(GridExportTemplateDefinitionSchema.safeParse(template).success).toBe(true);
    expect(template.charts).toEqual([]);
  });

  it.each(DATA_STARTERS)('adds two dataset charts to the $name layout', ({ id }) => {
    const template = buildGridStarterTemplate(entity, id);
    expect(template.charts).toHaveLength(2);
    for (const chart of template.charts!) {
      expect(chart.source.kind).toBe('dataset');
      expect(chart.anchor.sheetId).toBe(template.sheets[0].id);
    }
    // One chart beside the KPI cards/table, one below the totals row
    expect(template.charts![0].anchor.startCol).toBeGreaterThan(7);
    expect(template.charts![1].anchor.startRow).toBeGreaterThan(18);
  });

  it('builds the production target tracker without needing entity fields', () => {
    const template = buildGridStarterTemplate(entity, 'production');
    expect(GridExportTemplateDefinitionSchema.safeParse(template).success).toBe(true);
    expect(template.datasets).toEqual([]);
    expect(template.sheets[0].name).toBe('Production Tracker');
    expect(template.sheets[0].dataValidations?.[0]).toMatchObject({ type: 'checkbox', ref: 'C21:AG28' });
    expect(template.charts!.map((c) => c.type)).toEqual(['area', 'donut', 'bar', 'bar']);
  });
});
