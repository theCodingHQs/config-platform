import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportWizard, exampleText } from '../src/studio/ImportWizard';
import { AppBarProvider } from '../src/context/app-bar-context';
import * as apiClient from '../src/api/client';

const analysis: apiClient.SheetAnalysis = {
  sheets: ['October Sheets'],
  selectedSheet: 'October Sheets',
  rowCount: 5,
  suggestedLabel: 'Production Tracker',
  suggestedName: 'production_tracker',
  dateFormat: 'ISO',
  dateFormatAmbiguous: false,
  columns: [
    { header: 'Machine', include: true, name: 'machine', label: 'Machine', kind: 'text', samples: ['CNC Mill 01'], filled: 5 },
    { header: 'Month', include: true, name: 'month', label: 'Month', kind: 'month', samples: ['2026-10-01T00:00:00.000Z'], filled: 5 },
    { header: 'Planned Days', include: true, name: 'planned_days', label: 'Planned Days', kind: 'number', samples: ['26'], filled: 5 },
    { header: 'Status', include: true, name: 'status', label: 'Status', kind: 'select', options: ['Down', 'Running'], samples: ['Running', 'Down'], filled: 5 },
    { header: 'Empty', include: false, name: 'empty', label: 'Empty', kind: 'text', samples: [], filled: 0 },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWizard(onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppBarProvider>
        <ImportWizard tenantId="t" onClose={() => {}} onCreated={onCreated} />
      </AppBarProvider>
    </QueryClientProvider>,
  );
  return onCreated;
}

async function chooseFile() {
  const file = new File(['fake'], 'Production Tracker.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  fireEvent.change(screen.getByLabelText(/Choose an Excel or CSV file/), { target: { files: [file] } });
  await screen.findByText(/5 rows found/);
  return file;
}

describe('Import wizard (Start from an Excel sheet)', () => {
  it('suggests fields, lets them be adjusted, then creates the entity, a page and a report', async () => {
    vi.spyOn(apiClient, 'analyzeSheet').mockResolvedValue(analysis);
    const create = vi.spyOn(apiClient, 'createFromSheet').mockResolvedValue({
      entity: { id: 't_new', name: 'production_tracker', label: 'Production Tracker', physicalTableName: 'tbl', version: 1 },
      fields: [
        { id: 'f1', name: 'machine', label: 'Machine', type: 'text', physicalColumnName: 'c1', required: false, unique: false, position: 0, config: {} },
        { id: 'f2', name: 'planned_days', label: 'Planned Days', type: 'number', physicalColumnName: 'c2', required: false, unique: false, position: 1, config: {} },
      ],
      insertedCount: 5,
    });
    const page = vi.spyOn(apiClient, 'createPage').mockResolvedValue({ id: 'p1' } as any);
    const publish = vi.spyOn(apiClient, 'publishPage').mockResolvedValue({} as any);
    const report = vi.spyOn(apiClient, 'createExportTemplate').mockResolvedValue({ id: 'r1' } as any);
    const onCreated = renderWizard();

    const file = await chooseFile();
    // Suggested name and types
    expect(screen.getByLabelText('Name')).toHaveValue('Production Tracker');
    expect(screen.getByLabelText('Type for Month')).toHaveValue('month');
    expect(screen.getByLabelText('Import Empty')).not.toBeChecked();
    expect(screen.getByText(/2 choices: Down, Running/)).toBeInTheDocument();

    // Adjust: Planned Days as text, a nicer name for the entity
    fireEvent.change(screen.getByLabelText('Type for Planned Days'), { target: { value: 'text' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Production Sheet' } });
    expect(screen.getByLabelText('System name')).toHaveValue('production_sheet');

    fireEvent.click(screen.getByRole('button', { name: /Create Production Sheet \(5 rows\)/ }));
    await screen.findByText(/is ready with 5 records/);

    const plan = create.mock.calls[0][1];
    expect(create.mock.calls[0][0]).toBe(file);
    expect(plan).toMatchObject({ entityName: 'production_sheet', entityLabel: 'Production Sheet', sheetName: 'October Sheets' });
    expect(plan.columns.find((c) => c.header === 'Planned Days')!.kind).toBe('text');
    expect(plan.columns.find((c) => c.header === 'Status')!.options).toEqual(['Down', 'Running']);

    expect(page).toHaveBeenCalledWith('t', expect.objectContaining({ name: 'Production Tracker', route: '/production-tracker' }));
    expect(publish).toHaveBeenCalledWith('t', 'p1');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ entityId: 't_new' }));
    expect(onCreated).toHaveBeenCalledWith({ entityId: 't_new', insertedCount: 5, pageId: 'p1', reportId: 'r1' });
  });

  it('when rows do not fit, nothing else is created and the rows are listed', async () => {
    vi.spyOn(apiClient, 'analyzeSheet').mockResolvedValue(analysis);
    vi.spyOn(apiClient, 'createFromSheet').mockRejectedValue(
      new apiClient.ApiError(422, 'Import validation failed with 1 error(s). No records were imported.', [
        { row: 7, column: 'Planned Days', message: 'Planned Days must be a valid number' },
      ] as any),
    );
    const page = vi.spyOn(apiClient, 'createPage');
    renderWizard();
    await chooseFile();
    fireEvent.click(screen.getByRole('button', { name: /Create Production Tracker/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was created');
    expect(within(alert).getByText(/Row 7, Planned Days: Planned Days must be a valid number/)).toBeInTheDocument();
    expect(page).not.toHaveBeenCalled();
    // Still on the review step, ready to adjust and retry
    expect(screen.getByLabelText('Type for Planned Days')).toBeInTheDocument();
  });

  it('page and report are optional', async () => {
    vi.spyOn(apiClient, 'analyzeSheet').mockResolvedValue(analysis);
    vi.spyOn(apiClient, 'createFromSheet').mockResolvedValue({
      entity: { id: 't_new', name: 'production_tracker', label: 'Production Tracker', physicalTableName: 'tbl', version: 1 },
      fields: [],
      insertedCount: 5,
    });
    const page = vi.spyOn(apiClient, 'createPage');
    const report = vi.spyOn(apiClient, 'createExportTemplate');
    renderWizard();
    await chooseFile();
    fireEvent.click(screen.getByLabelText(/A page to see, add and edit/));
    fireEvent.click(screen.getByLabelText(/An Excel report of/));
    fireEvent.click(screen.getByRole('button', { name: /Create Production Tracker/ }));
    await screen.findByText(/is ready with 5 records/);
    expect(page).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('if the page cannot be created, the entity and records are kept and the reason is shown', async () => {
    vi.spyOn(apiClient, 'analyzeSheet').mockResolvedValue(analysis);
    vi.spyOn(apiClient, 'createFromSheet').mockResolvedValue({
      entity: { id: 't_new', name: 'production_tracker', label: 'Production Tracker', physicalTableName: 'tbl', version: 1 },
      fields: [],
      insertedCount: 5,
    });
    vi.spyOn(apiClient, 'createPage').mockRejectedValue(new Error("Route '/production-tracker' already exists"));
    vi.spyOn(apiClient, 'createExportTemplate').mockResolvedValue({ id: 'r1' } as any);
    const onCreated = renderWizard();
    await chooseFile();
    fireEvent.click(screen.getByRole('button', { name: /Create Production Tracker/ }));
    await screen.findByText(/is ready with 5 records/);
    expect(screen.getByText(/The page wasn't created: Route '\/production-tracker' already exists/)).toBeInTheDocument();
    const result = onCreated.mock.calls[0][0];
    expect(result).toMatchObject({ entityId: 't_new', reportId: 'r1' });
    expect(result.pageId).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});

describe('Import wizard examples', () => {
  it('shows spreadsheet dates in the viewer date format, and text as written', () => {
    const india = { locale: 'en-IN', dateFormat: 'DD/MM/YYYY' as const };
    expect(exampleText('2026-10-01T00:00:00.000Z', 'date', india)).toBe('01/10/2026');
    expect(exampleText('2026-10-01T00:00:00.000Z', 'month', { locale: 'en-GB' })).toMatch(/Oct(ober)? 2026/);
    expect(exampleText('25/10/2026', 'date', india)).toBe('25/10/2026');
    expect(exampleText('Tool change', 'text', india)).toBe('Tool change');
  });
});
