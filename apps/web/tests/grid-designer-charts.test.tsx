import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GridTemplateDesigner } from '../src/studio/GridTemplateDesigner';
import { ChartEditorModal } from '../src/studio/export-grid/ChartEditorModal';
import { ChartOverlayCanvas } from '../src/studio/export-grid/ChartOverlayCanvas';
import type { GridChartDefinition } from '@config-platform/schema';

// Mock API client
const mockUpdateExportTemplate = vi.fn().mockResolvedValue({ success: true });
vi.mock('../src/api/client', () => ({
  getExportTemplate: vi.fn().mockImplementation((id: string) =>
    Promise.resolve({
      id,
      name: 'Sales & Revenue Report',
      entityId: 'ent_orders',
      version: 1,
      draft: {
        kind: 'grid',
        version: 1,
        schemaVersion: 3,
        parameters: [],
        datasets: [
          {
            id: 'ds_orders',
            name: 'Orders Dataset',
            source: { baseEntityId: 'ent_orders', joins: [] },
            fields: [
              { id: 'month', name: 'Month', fieldPath: 'month' },
              { id: 'revenue', name: 'Revenue', fieldPath: 'revenue' },
              { id: 'units', name: 'Units', fieldPath: 'units' },
            ],
            filters: [],
            sort: [],
            aggregates: [
              { id: 'total_revenue', name: 'Total Revenue', fieldId: 'revenue', fn: 'sum' },
            ],
          },
        ],
        charts: [
          {
            id: 'chart_existing',
            title: 'Monthly Revenue',
            type: 'bar',
            source: {
              kind: 'range',
              sheetId: 'sheet_0',
              categoryRange: 'A2:A7',
              series: [
                { name: 'Revenue', range: 'B2:B7', color: '#4F46E5' },
              ],
            },
            anchor: {
              sheetId: 'sheet_0',
              startCol: 1,
              startRow: 9,
              endCol: 8,
              endRow: 23,
            },
            options: {
              legend: true,
            },
          },
        ],
        filenameExpression: '"sales_report"',
        pdf: { mode: 'table' },
        sheets: [
          {
            id: 'sheet_0',
            name: 'Sheet 1',
            order: 0,
            merges: [],
            cells: {
              '0:0': { value: 'Month' },
              '0:1': { value: 'Revenue' },
              '1:0': { value: 'Jan' },
              '1:1': { value: 12000 },
              '2:0': { value: 'Feb' },
              '2:1': { value: 14500 },
            },
            regions: [],
            conditionalFormats: [],
          },
        ],
      },
    })
  ),
  updateExportTemplate: (...args: any[]) => mockUpdateExportTemplate(...args),
  publishExportTemplate: vi.fn().mockResolvedValue({}),
  downloadExportTemplateRenderPreview: vi.fn().mockResolvedValue(new Blob()),
  fetchExportTemplatePreviewData: vi.fn().mockResolvedValue({ draft: null }),
  fetchDatasetPreview: vi.fn().mockResolvedValue({ rows: [] }),
}));

// Mock metadata context
vi.mock('../src/context/metadata-context', () => ({
  useOptionalMetadata: () => ({
    tenantId: 'test_tenant',
    entities: [
      {
        id: 'ent_orders',
        name: 'Orders',
        fields: [
          { id: 'month', name: 'Month', type: 'text' },
          { id: 'revenue', name: 'Revenue', type: 'number' },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

// Mock theme context
vi.mock('../src/context/theme-context', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: vi.fn(),
  }),
}));

// Mock Univer UI Plugin
vi.mock('@univerjs/ui', async (importOriginal) => {
  const actual = await importOriginal<any>();
  class MockUniverUIPlugin {
    static pluginName = 'UNIVER_UI_PLUGIN';
    static type = 0;
    getPluginName() {
      return 'UNIVER_UI_PLUGIN';
    }
    onStarting() {}
    onReady() {}
    onRendered() {}
    onSteady() {}
  }
  return {
    ...actual,
    UniverUIPlugin: MockUniverUIPlugin,
  };
});

// Mock echarts init for jsdom environment
vi.mock('echarts', () => ({
  init: vi.fn().mockReturnValue({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
  (window as any).requestIdleCallback = (cb: any) => setTimeout(cb, 0);
  (window as any).cancelIdleCallback = (id: any) => clearTimeout(id);
});

describe('Phase B: Grid Designer Charts UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Charts tab in side panel and displays existing charts', async () => {
    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify Charts tab button is present
    const chartsTabBtn = await screen.findByTestId('charts-tab-btn');
    expect(chartsTabBtn).toBeInTheDocument();
    expect(chartsTabBtn.textContent).toContain('Charts (1)');

    // Switch to Charts tab
    fireEvent.click(chartsTabBtn);

    // Verify panel content
    const panel = await screen.findByTestId('charts-panel-tab');
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByTestId('chart-card-chart_existing')).toBeInTheDocument();
    expect(within(panel).getByText('Monthly Revenue')).toBeInTheDocument();
    expect(within(panel).getByText(/bar/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Range \(sheet_0!A2:A7\)/)).toBeInTheDocument();
  });

  it('opens ChartEditorModal when clicking Insert Chart button in header', async () => {
    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    const insertHeaderBtn = await screen.findByTestId('insert-chart-header-btn');
    expect(insertHeaderBtn).toBeInTheDocument();
    fireEvent.click(insertHeaderBtn);

    // Modal should be open
    const modal = await screen.findByTestId('chart-editor-modal');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByRole('heading', { name: 'Insert Chart' })).toBeInTheDocument();
    expect(within(modal).getByTestId('save-chart-btn')).toBeInTheDocument();
  });

  it('opens ChartEditorModal in edit mode when clicking Edit on an existing chart', async () => {
    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    const chartsTabBtn = await screen.findByTestId('charts-tab-btn');
    fireEvent.click(chartsTabBtn);

    const editBtn = await screen.findByTestId('panel-edit-chart-chart_existing');
    fireEvent.click(editBtn);

    expect(await screen.findByTestId('chart-editor-modal')).toBeInTheDocument();
    expect(screen.getByText('Edit Chart')).toBeInTheDocument();
    const titleInput = screen.getByDisplayValue('Monthly Revenue');
    expect(titleInput).toBeInTheDocument();
  });

  it('deletes an existing chart when clicking Delete in the Charts panel', async () => {
    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    const chartsTabBtn = await screen.findByTestId('charts-tab-btn');
    fireEvent.click(chartsTabBtn);

    const deleteBtn = await screen.findByTestId('panel-delete-chart-chart_existing');
    fireEvent.click(deleteBtn);

    // Chart card should be removed, and empty state should show
    await waitFor(() => {
      expect(screen.queryByTestId('chart-card-chart_existing')).toBeNull();
      expect(screen.getByText('No charts yet')).toBeInTheDocument();
    });
  });

  it('configures and saves a new dataset-based chart in ChartEditorModal', async () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    render(
      <ChartEditorModal
        isOpen={true}
        onClose={handleClose}
        onSave={handleSave}
        datasets={[
          {
            id: 'ds_1',
            name: 'Sales Data',
            source: { baseEntityId: 'sales', joins: [] },
            fields: [
              { id: 'region', name: 'Region', fieldPath: 'region' },
              { id: 'sales_amt', name: 'Sales Amount', fieldPath: 'sales_amt' },
            ],
            filters: [],
            sort: [],
            aggregates: [],
          },
        ]}
        sheets={[
          { id: 'sheet_0', name: 'Sheet 1', order: 0, merges: [], cells: {}, regions: [], conditionalFormats: [] },
        ]}
      />
    );

    // Choose Pie chart
    const pieBtn = screen.getByRole('button', { name: /Pie/i });
    fireEvent.click(pieBtn);

    // Switch to Dataset source
    const dsTab = screen.getByRole('button', { name: /Query Dataset/i });
    fireEvent.click(dsTab);

    // Change title
    const titleInput = screen.getByDisplayValue('Metric Overview');
    fireEvent.change(titleInput, { target: { value: 'Regional Sales Share' } });

    // Save chart
    const saveBtn = screen.getByTestId('save-chart-btn');
    fireEvent.click(saveBtn);

    expect(handleSave).toHaveBeenCalledTimes(1);
    const savedChart = handleSave.mock.calls[0][0] as GridChartDefinition;
    expect(savedChart.title).toBe('Regional Sales Share');
    expect(savedChart.type).toBe('pie');
    expect(savedChart.source.kind).toBe('dataset');
  });

  it('renders ChartOverlayCanvas floating cards over spreadsheet in design view', () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    const testCharts: GridChartDefinition[] = [
      {
        id: 'c1',
        title: 'Q1 Revenue',
        type: 'bar',
        source: {
          kind: 'range',
          sheetId: 'sheet_0',
          categoryRange: 'A2:A5',
          series: [{ name: 'Rev', range: 'B2:B5' }],
        },
        anchor: {
          sheetId: 'sheet_0',
          startCol: 0,
          startRow: 0,
          endCol: 6,
          endRow: 12,
        },
        options: {},
      },
    ];

    render(
      <ChartOverlayCanvas
        charts={testCharts}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={handleEdit}
        onDeleteChart={handleDelete}
      />
    );

    expect(screen.getByText('Q1 Revenue')).toBeInTheDocument();
    expect(screen.getByText(/bar/i)).toBeInTheDocument();
    expect(screen.getByTestId('edit-chart-c1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-chart-c1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('edit-chart-c1'));
    expect(handleEdit).toHaveBeenCalledWith(testCharts[0]);

    fireEvent.click(screen.getByTestId('delete-chart-c1'));
    expect(handleDelete).toHaveBeenCalledWith('c1');
  });
});
