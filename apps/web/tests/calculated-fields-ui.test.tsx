import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formulaProblem, type ErdTable } from '@config-platform/schema';
import { FormulaEditor } from '../src/studio/FormulaEditor';
import { UniqueRulesPanel } from '../src/studio/UniqueRulesPanel';
import { FormComponent } from '../src/components/form';
import { MetadataProvider } from '../src/context/metadata-context';
import { AppBarProvider } from '../src/context/app-bar-context';
import * as apiClient from '../src/api/client';

const col = (id: string, name: string, label: string, type: string, position: number, config: Record<string, unknown> = {}) => ({
  id, name, label, type, physicalColumnName: id, required: false, unique: false, isPrimary: false, position, isForeignKey: type === 'reference', config,
});

const sheet: ErdTable = {
  id: 't_sheet',
  name: 'sheet',
  label: 'Production Sheet',
  physicalTableName: 't_sheet',
  version: 3,
  uniqueRules: [],
  columns: [
    col('c_machine', 'machine', 'Machine', 'text', 0),
    col('c_month', 'month', 'Month', 'date', 1, { granularity: 'month' }),
    col('c_planned', 'planned_days', 'Planned Days', 'number', 2),
    col('c_met', 'days_met', 'Days on Target', 'number', 3, { formula: 'countTrue(range("day_01", "day_31"))' }),
  ] as any,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Formula editor', () => {
  function Harness({ type = 'number' }: { type?: string }) {
    const [formula, setFormula] = useState<string | null>(null);
    return (
      <>
        <FormulaEditor idPrefix="t" fieldType={type} formula={formula} onChange={setFormula} otherFields={sheet.columns} />
        <output data-testid="formula">{formula === null ? '(entered)' : formula}</output>
      </>
    );
  }

  it('switches between entered and calculated, and inserts field names', () => {
    render(<Harness />);
    expect(screen.getByTestId('formula').textContent).toBe('(entered)');
    fireEvent.click(screen.getByLabelText('Calculated'));
    fireEvent.click(screen.getByRole('button', { name: 'planned_days' }));
    expect(screen.getByTestId('formula').textContent).toBe('planned_days');
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'planned_days - days_met' } });
    expect(screen.getByTestId('formula').textContent).toBe('planned_days - days_met');
    fireEvent.click(screen.getByLabelText('Entered by people'));
    expect(screen.getByTestId('formula').textContent).toBe('(entered)');
  });

  it('is offered only for number, text and yes/no fields', () => {
    render(<Harness type="date" />);
    expect(screen.queryByLabelText('Calculated')).toBeNull();
  });

  it('shows why a formula can\'t work, under the formula box', () => {
    const problem = formulaProblem(
      { name: 'label', type: 'text', config: { formula: 'machine - planned_days' } },
      [...sheet.columns.map((c) => ({ name: c.name, type: c.type, config: c.config })), { name: 'label', type: 'text', config: { formula: 'machine - planned_days' } }],
      () => undefined,
    );
    render(<FormulaEditor idPrefix="t" fieldType="text" formula="machine - planned_days" onChange={() => {}} otherFields={sheet.columns} problem={problem} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Can't subtract with text: machine is text/);
    expect(screen.getByLabelText('Formula')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Prevent duplicates panel', () => {
  const renderPanel = (entity: ErdTable) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppBarProvider>
          <UniqueRulesPanel entity={entity} tenantId="t" />
        </AppBarProvider>
      </QueryClientProvider>,
    );

  it('adds a Machine + Month rule with the entity version', async () => {
    const save = vi.spyOn(apiClient, 'setUniqueRules').mockResolvedValue({ uniqueRules: [] });
    renderPanel(sheet);
    expect(screen.getByText(/No rules: duplicates are allowed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add rule/ }));
    fireEvent.click(screen.getByLabelText('Machine'));
    fireEvent.click(screen.getByLabelText('Month'));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule: Machine + Month' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('t_sheet', [{ fields: ['c_machine', 'c_month'] }], 3));
  });

  it('lists rules, removes one, and shows why a rule was refused', async () => {
    const save = vi.spyOn(apiClient, 'setUniqueRules').mockRejectedValue(
      new Error('Production Sheet already has records sharing the same Machine + Month: CNC Mill 01 / 2026-10-01 (2 records).'),
    );
    renderPanel({ ...sheet, uniqueRules: [{ id: 'abc123', fields: ['c_machine', 'c_month'] }] });
    expect(screen.getByText('Machine + Month')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule Machine + Month' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('t_sheet', [], 3));
    await waitFor(() => expect(screen.getByTestId('app-status-notification')).toHaveTextContent(/CNC Mill 01 \/ 2026-10-01/));
  });
});

describe('Forms and calculated fields', () => {
  it('shows a calculated field read-only and never sends it', async () => {
    vi.spyOn(apiClient, 'fetchRecord').mockResolvedValue({ id: 'r1', machine: 'CNC', planned_days: 26, days_met: 14 } as any);
    const update = vi.spyOn(apiClient, 'updateRecord').mockResolvedValue({ id: 'r1' } as any);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MetadataProvider tenantId="t" initialEntities={[sheet]}>
          <FormComponent entityId="t_sheet" mode="edit" recordId="r1" fields={[{ fieldId: 'c_planned' }, { fieldId: 'c_met' }]} />
        </MetadataProvider>
      </QueryClientProvider>,
    );
    const met = await screen.findByDisplayValue('14');
    expect(met).toBeDisabled();
    expect(screen.getByText('Calculated')).toBeInTheDocument();
    expect(screen.getByText(/Calculated automatically/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Update/i }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][3]).not.toHaveProperty('days_met');
  });
});
