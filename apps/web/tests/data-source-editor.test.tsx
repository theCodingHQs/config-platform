import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DataSourceDefinition, ErdTable } from '@config-platform/schema';
import { DataSourceEditorModal } from '../src/studio/DataSourceEditorModal';
import { filterToRows, rowsToFilter, filterOpsForColumn, filterOpsForColumns } from '../src/studio/data-source-filter-rows';

const column = (id: string, name: string, label: string, type: string, position: number) => ({
  id, name, label, type, physicalColumnName: id, required: false, unique: false, isPrimary: false, position, isForeignKey: type === 'reference', config: {},
});

const sheets: ErdTable = {
  id: 't_sheet',
  name: 'production_sheet',
  label: 'Production Sheet',
  physicalTableName: 't_sheet',
  version: 1,
  columns: [
    column('c_machine', 'machine', 'Machine', 'reference', 0),
    column('c_month', 'month', 'Month', 'date', 1),
    column('c_name', 'machine_name', 'Machine Name', 'text', 2),
    column('c_wc', 'work_center', 'Work Center', 'text', 3),
  ] as any,
};

describe('Data source filter editor', () => {
  it('converts filters to rows and back, keeping operator filters', () => {
    const filter = { month: '{{ state.month }}', machine_name: { contains: '{{ state.q }}' }, planned: { gte: 1, lte: 5 } };
    const rows = filterToRows(filter);
    expect(rows).toEqual([
      { field: 'month', op: 'eq', value: '{{ state.month }}' },
      { field: 'machine_name', op: 'contains', value: '{{ state.q }}' },
      { field: 'planned', op: 'gte', value: 1 },
      { field: 'planned', op: 'lte', value: 5 },
    ]);
    expect(rowsToFilter(rows)).toEqual(filter);
    // Only operators the records API accepts for the field type are offered
    expect(filterOpsForColumn({ type: 'text' })).toContain('contains');
    expect(filterOpsForColumn({ type: 'reference' })).not.toContain('contains');
    expect(filterOpsForColumn({ type: 'date' })).toContain('gte');
    // A multi-field condition offers only operators every field accepts
    expect(filterOpsForColumns([{ type: 'text' }, { type: 'reference' }])).not.toContain('contains');
    expect(filterOpsForColumns([{ type: 'text' }, { type: 'text' }])).toContain('contains');
  });

  it('shows name-keyed and operator filters, and saves a chosen operator', () => {
    const onSave = vi.fn();
    const dataSources: DataSourceDefinition[] = [{
      id: 'ds_sheets',
      entityId: 't_sheet',
      limit: 100,
      filter: { month: '{{ state.month }}', machine: '{{ state.machineSearch }}' },
    }];
    render(<DataSourceEditorModal isOpen onClose={() => {}} dataSources={dataSources} entities={[sheets]} onSave={onSave} />);

    // A filter keyed by field name is recognised instead of showing "Select Field"
    expect(screen.getByLabelText('Filter 1 field').textContent).toBe('Month');
    // Link fields explain that they match the record id
    expect(screen.getByText(/matches the linked record's id/i)).toBeTruthy();

    // One search box over two fields: pick Machine Name and Work Center (instead of Machine), then contains
    fireEvent.click(screen.getByLabelText('Filter 2 field'));
    fireEvent.click(screen.getByLabelText('Machine Name (machine_name)'));
    fireEvent.click(screen.getByLabelText('Work Center (work_center)'));
    fireEvent.click(screen.getByLabelText('Machine (machine)'));
    expect(screen.getByLabelText('Filter 2 field').textContent).toBe('Machine Name or Work Center');
    fireEvent.change(screen.getByLabelText('Filter 2 operator'), { target: { value: 'contains' } });
    fireEvent.click(screen.getByText('Save Data Sources'));

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        filter: { month: '{{ state.month }}', 'c_name,c_wc': { contains: '{{ state.machineSearch }}' } },
      }),
    ]);
  });
});
