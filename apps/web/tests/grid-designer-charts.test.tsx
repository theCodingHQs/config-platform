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

  it('draws the hydrated (shifted) charts in preview and the template charts in design', async () => {
    // Regression: preview showed hydrated cells but the design charts, whose ranges point at
    // template rows; once a region expanded, a chart read a data row (e.g. row 23).
    const apiClient = await import('../src/api/client');
    const stored: any = await apiClient.getExportTemplate('tpl_1');
    const previewDraft = structuredClone(stored.draft);
    previewDraft.charts = [{
      ...stored.draft.charts[0],
      id: 'chart_preview_shifted',
      source: { ...stored.draft.charts[0].source, categoryRange: 'A9:A14', series: [{ name: 'Revenue', range: 'B9:B14' }] },
      anchor: { ...stored.draft.charts[0].anchor, startRow: 16, endRow: 30 },
    }];
    vi.mocked(apiClient.fetchExportTemplatePreviewData).mockResolvedValueOnce({ draft: previewDraft } as any);

    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('chart-overlay-chart_existing')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /preview with data/i }));
    expect(await screen.findByTestId('chart-overlay-chart_preview_shifted')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-overlay-chart_existing')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /design view/i }));
    expect(await screen.findByTestId('chart-overlay-chart_existing')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-overlay-chart_preview_shifted')).toBeNull();
  });

  it('never saves hydrated preview data as the template (charts would keep unshifted ranges)', async () => {
    // Regression: an edit while previewing marked the draft dirty, and Download Preview then
    // saved the on-screen live data (expanded rows) as the template with the old chart ranges.
    const apiClient = await import('../src/api/client');
    const stored: any = await apiClient.getExportTemplate('tpl_1');
    const previewDraft = structuredClone(stored.draft);
    previewDraft.sheets[0].cells['1:0'] = { value: 'LIVE PREVIEW ROW' };
    vi.mocked(apiClient.fetchExportTemplatePreviewData).mockResolvedValueOnce({ draft: previewDraft } as any);
    mockUpdateExportTemplate.mockClear();
    const urlApi = window.URL as any;
    urlApi.createObjectURL ??= () => 'blob:preview';
    urlApi.revokeObjectURL ??= () => {};
    // jsdom can't follow the download link the button clicks
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/templates/tpl_1/grid']}>
        <Routes>
          <Route path="/templates/:id/grid" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /preview with data/i }));
    await screen.findByRole('button', { name: /design view/i });

    // A real template edit made while previewing (removing a chart)...
    fireEvent.click(await screen.findByTestId('charts-tab-btn'));
    fireEvent.click(await screen.findByTestId('panel-delete-chart-chart_existing'));
    await waitFor(() => expect(screen.queryByTestId('chart-card-chart_existing')).toBeNull());

    // ...then Download Preview saves the pending change first
    fireEvent.click(screen.getByRole('button', { name: /download preview/i }));
    await waitFor(() => expect(apiClient.downloadExportTemplateRenderPreview).toHaveBeenCalledWith('tpl_1', true));

    // The saved draft is the stored design (plus the chart removal), never the preview data
    for (const call of mockUpdateExportTemplate.mock.calls) {
      const saved = call[1].draft;
      expect(saved.sheets[0].cells['1:0']?.value).toBe('Jan');
      expect(JSON.stringify(saved)).not.toContain('LIVE PREVIEW ROW');
      expect(saved.charts).toEqual([]);
    }
    clickSpy.mockRestore();
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
            groupBy: [],
            having: [],
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

  it('updates chart overlay position reactively when sheet is scrolled', () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    const chartAtR16C16: GridChartDefinition[] = [
      {
        id: 'chart_executive',
        title: 'Metric Overview',
        type: 'area',
        source: {
          kind: 'dataset',
          datasetId: 'ds_exec',
          category: 'month',
          series: [{ fieldId: 'total', name: 'Total' }],
        },
        anchor: {
          sheetId: 'sheet_0',
          startCol: 16,
          startRow: 16,
          endCol: 21,
          endRow: 21,
        },
        options: {},
      },
    ];

    // Initial render with zero scroll
    const { rerender } = render(
      <ChartOverlayCanvas
        charts={chartAtR16C16}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={handleEdit}
        onDeleteChart={handleDelete}
        gridMetrics={{
          scrollX: 0,
          scrollY: 0,
          gridLeft: 48,
          gridTop: 52,
          gridWidth: 1200,
          gridHeight: 800,
        }}
      />
    );

    const overlayCard = screen.getByTestId('chart-overlay-chart_executive');
    expect(overlayCard).toBeInTheDocument();
    // Default 16 * 75 = 1200px, 16 * 24 = 384px
    expect(overlayCard.style.left).toBe('1200px');
    expect(overlayCard.style.top).toBe('384px');

    // Simulate user scrolling horizontally by 300px and vertically by 150px
    rerender(
      <ChartOverlayCanvas
        charts={chartAtR16C16}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={handleEdit}
        onDeleteChart={handleDelete}
        gridMetrics={{
          scrollX: 300,
          scrollY: 150,
          gridLeft: 48,
          gridTop: 52,
          gridWidth: 1200,
          gridHeight: 800,
        }}
      />
    );

    // Left should now be 1200 - 300 = 900px, Top should be 384 - 150 = 234px
    expect(overlayCard.style.left).toBe('900px');
    expect(overlayCard.style.top).toBe('234px');
  });

  it('clips and hides chart overlay when scrolled completely past the visible sheet area', () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    const chartAtR16: GridChartDefinition[] = [
      {
        id: 'chart_executive',
        title: 'Metric Overview',
        type: 'area',
        source: {
          kind: 'dataset',
          datasetId: 'ds_exec',
          category: 'month',
          series: [{ fieldId: 'total', name: 'Total' }],
        },
        anchor: {
          sheetId: 'sheet_0',
          startCol: 16,
          startRow: 16,
          endCol: 21,
          endRow: 21,
        },
        options: {},
      },
    ];

    // Scroll far down (e.g. scrollY: 672px, meaning user scrolled down to row 28+)
    // startY is 384px. topPx becomes 384 - 672 = -288px. Height is 180px.
    // top + height = -108px < 0, completely scrolled above visible grid!
    render(
      <ChartOverlayCanvas
        charts={chartAtR16}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={handleEdit}
        onDeleteChart={handleDelete}
        gridMetrics={{
          scrollX: 0,
          scrollY: 672,
          gridLeft: 48,
          gridTop: 52,
          gridWidth: 1000,
          gridHeight: 600,
        }}
      />
    );

    // Should NOT be rendered (clipped out of viewport)
    expect(screen.queryByTestId('chart-overlay-chart_executive')).toBeNull();
  });

  it('supports custom getCellCoordinates resolver for exact skeleton alignment', () => {
    const chart: GridChartDefinition[] = [
      {
        id: 'c_custom',
        title: 'Custom Sized Sheet Chart',
        type: 'bar',
        source: {
          kind: 'dataset',
          datasetId: 'ds_1',
          category: 'm',
          series: [{ fieldId: 'v', name: 'V' }],
        },
        anchor: {
          sheetId: 'sheet_0',
          startCol: 2,
          startRow: 5,
          endCol: 4,
          endRow: 8,
        },
        options: {},
      },
    ];

    // Provide custom cell resolver (e.g. non-standard column widths & row heights from skeleton)
    const getCellCoordinates = (row: number, col: number) => ({
      x: col * 120, // 120px wide columns
      y: row * 40,  // 40px high rows
    });

    render(
      <ChartOverlayCanvas
        charts={chart}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={vi.fn()}
        onDeleteChart={vi.fn()}
        gridMetrics={{
          scrollX: 50,
          scrollY: 30,
          gridLeft: 48,
          gridTop: 52,
          gridWidth: 1000,
          gridHeight: 600,
          getCellCoordinates,
        }}
      />
    );

    const card = screen.getByTestId('chart-overlay-c_custom');
    expect(card).toBeInTheDocument();
    // startX = 2 * 120 = 240, startY = 5 * 40 = 200
    // left = 240 - 50 = 190px, top = 200 - 30 = 170px
    expect(card.style.left).toBe('190px');
    expect(card.style.top).toBe('170px');
  });

  it('forwards wheel events on chart overlay canvas', () => {
    const onForwardWheel = vi.fn();
    const chart: GridChartDefinition[] = [
      {
        id: 'c_wheel',
        title: 'Wheel Test',
        type: 'bar',
        source: {
          kind: 'dataset',
          datasetId: 'ds_1',
          category: 'm',
          series: [{ fieldId: 'v', name: 'V' }],
        },
        anchor: {
          sheetId: 'sheet_0',
          startCol: 1,
          startRow: 1,
          endCol: 3,
          endRow: 3,
        },
        options: {},
      },
    ];

    render(
      <ChartOverlayCanvas
        charts={chart}
        activeSheetId="sheet_0"
        viewMode="design"
        onEditChart={vi.fn()}
        onDeleteChart={vi.fn()}
        onForwardWheel={onForwardWheel}
      />
    );

    const overlayCanvas = screen.getByTestId('chart-overlay-canvas');
    fireEvent.wheel(overlayCanvas, { deltaY: 120 });
    expect(onForwardWheel).toHaveBeenCalledTimes(1);
  });
});
