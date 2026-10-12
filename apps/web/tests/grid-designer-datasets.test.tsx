import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GridTemplateDesigner } from '../src/studio/GridTemplateDesigner';
import { ExportButtonComponent } from '../src/components/export-button';
import { AuthContext } from '../src/context/auth-context';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import * as apiClient from '../src/api/client';

// Mock API client
vi.mock('../src/api/client', () => ({
  getExportTemplate: vi.fn(),
  updateExportTemplate: vi.fn(),
  publishExportTemplate: vi.fn(),
  downloadExportTemplateRenderPreview: vi.fn(),
  fetchExportTemplatePreviewData: vi.fn(),
  createExportDownloadToken: vi.fn(),
  fetchEntityPermissions: vi.fn(),
  fetchDatasetPreview: vi.fn(),
}));

const mockEntities: any[] = [
  {
    id: 'ent_machine',
    name: 'Machine',
    label: 'Production Machine',
    columns: [
      { id: 'f_mac_name', name: 'name', label: 'Machine Name', type: 'text' },
    ],
    fields: [
      { id: 'f_mac_name', name: 'name', label: 'Machine Name', type: 'text' },
    ],
  },
  {
    id: 'ent_log',
    name: 'MachineLog',
    label: 'Machine Log',
    columns: [
      { id: 'f_log_units', name: 'units', label: 'Units Produced', type: 'number' },
      { id: 'f_log_price', name: 'price', label: 'Unit Price', type: 'number' },
      {
        id: 'f_log_machine',
        name: 'machine_id',
        label: 'Machine',
        type: 'reference',
        config: { targetEntityId: 'ent_machine' },
      },
    ],
    fields: [
      { id: 'f_log_units', name: 'units', label: 'Units Produced', type: 'number' },
      { id: 'f_log_price', name: 'price', label: 'Unit Price', type: 'number' },
      {
        id: 'f_log_machine',
        name: 'machine_id',
        label: 'Machine',
        type: 'reference',
        config: { targetEntityId: 'ent_machine' },
      },
    ],
  },
];

// Mock metadata context
vi.mock('../src/context/metadata-context', () => ({
  useOptionalMetadata: () => ({
    tenantId: 'test_tenant',
    entities: mockEntities,
    isLoading: false,
    error: null,
    resolveEntity: (id: string) => mockEntities.find((e) => e.id === id || e.name === id),
    resolveField: (id: string) => {
      for (const ent of mockEntities) {
        const f = ent.columns.find((c: any) => c.id === id);
        if (f) return f;
      }
      return undefined;
    },
  }),
}));

// Mock theme context
vi.mock('../src/context/theme-context', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: vi.fn(),
    workspaceTheme: {},
    setWorkspaceTheme: vi.fn(),
    themeEditing: 'locked',
    refetchWorkspaceTheme: vi.fn(),
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

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
  (window as any).requestIdleCallback = (cb: any) => setTimeout(cb, 0);
  (window as any).cancelIdleCallback = (id: any) => clearTimeout(id);
});

describe('Phase 2C Designer E2E: Datasets, Joins, Aggregates, Bindings & Export', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const mockTemplate: apiClient.ExportTemplateItem = {
    id: 'tpl_dataset_test',
    name: 'Production Dataset Template',
    entityId: 'ent_log',
    version: 2,
    draft: {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      filenameExpression: '"production_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Summary',
          order: 0,
          merges: [],
          cells: {},
          regions: [
            {
              id: 'reg_logs',
              entityId: 'ent_log',
              datasetId: 'ds_production',
              startRow: 5,
              endRow: 5,
              startCol: 0,
              endCol: 2,
              columns: [],
            },
          ],
        },
      ],
      parameters: [],
      datasets: [
        {
          id: 'ds_production',
          name: 'Production Logs',
          source: {
            baseEntityId: 'ent_log',
            joins: [],
          },
          fields: [],
          filters: [],
          sort: [],
          groupBy: [],
          aggregates: [],
          having: [],
        },
      ],
    },
    published: null,
    createdAt: '2026-10-10',
    updatedAt: '2026-10-10',
  };

  it('1. builds a dataset with one join, one aggregate, and 50-row preview in designer', async () => {
    vi.mocked(apiClient.getExportTemplate).mockResolvedValue(mockTemplate);
    vi.mocked(apiClient.fetchDatasetPreview).mockResolvedValue({
      rows: [
        { units: 100, price: 5, 'machine.name': 'Mill M1' },
        { units: 200, price: 5, 'machine.name': 'Lathe M2' },
      ],
      totalCount: 2,
      isGrouped: false,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/studio/export-grid/tpl_dataset_test']}>
          <Routes>
            <Route path="/studio/export-grid/:id" element={<GridTemplateDesigner />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify template loads
    await waitFor(() => {
      expect(screen.getByText('Production Dataset Template')).toBeInTheDocument();
    });

    // 1. Add Join: select reference field f_log_machine and click Join
    await waitFor(() => {
      expect(screen.getByTestId('join-ref-field-select')).toBeInTheDocument();
    });
    const joinSelect = screen.getByTestId('join-ref-field-select');
    fireEvent.change(joinSelect, { target: { value: 'f_log_machine' } });

    const addJoinBtn = screen.getByTestId('add-join-btn');
    expect(addJoinBtn).not.toBeDisabled();
    fireEvent.click(addJoinBtn);

    // Join appears in list
    await waitFor(() => {
      expect(screen.getByText(/Join 1: machine_id/i)).toBeInTheDocument();
    });

    // 2. Add Aggregate (e.g. SUM of units named total_units)
    const aggNameInput = screen.getByTestId('aggregate-name');
    const aggFieldInput = screen.getByTestId('aggregate-field');
    const addAggBtn = screen.getByTestId('add-aggregate-btn');

    fireEvent.change(aggNameInput, { target: { value: 'total_units' } });
    fireEvent.change(aggFieldInput, { target: { value: 'units' } });
    fireEvent.click(addAggBtn);

    // Aggregate appears in list
    await waitFor(() => {
      expect(screen.getByText(/SUM\(units\) AS/i)).toBeInTheDocument();
    });

    // 3. Preview 50 Rows
    const previewBtn = screen.getByTestId('preview-dataset-btn');
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByTestId('dataset-preview-table')).toBeInTheDocument();
      expect(screen.getByText('Mill M1')).toBeInTheDocument();
      expect(screen.getByText('Lathe M2')).toBeInTheDocument();
    });
  });

  it('2. binds a KPI aggregate cell and saves template without errors', async () => {
    // Template with aggregate ready
    const templateWithAgg: apiClient.ExportTemplateItem = {
      ...mockTemplate,
      draft: {
        ...mockTemplate.draft,
        datasets: [
          {
            id: 'ds_production',
            name: 'Production Logs',
            source: { baseEntityId: 'ent_log', joins: [] },
            fields: [],
            filters: [],
            sort: [],
            groupBy: [],
            aggregates: [
              { id: 'agg_total_units', name: 'total_units', fn: 'sum', fieldPath: 'units' },
            ],
            having: [],
          },
        ],
      },
    };

    vi.mocked(apiClient.getExportTemplate).mockResolvedValue(templateWithAgg);
    const mockUpdate = vi.mocked(apiClient.updateExportTemplate).mockResolvedValue(templateWithAgg);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/studio/export-grid/tpl_dataset_test']}>
          <Routes>
            <Route path="/studio/export-grid/:id" element={<GridTemplateDesigner />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Production Dataset Template')).toBeInTheDocument();
    });

    // Switch to Dataset Fields panel
    const fieldsTabBtn = screen.getByText('Dataset Fields');
    fireEvent.click(fieldsTabBtn);

    // Look for the KPI aggregate bind button
    await waitFor(() => {
      expect(screen.getByTestId('bind-kpi-agg_total_units')).toBeInTheDocument();
    });

    const bindKpiBtn = screen.getByTestId('bind-kpi-agg_total_units');
    fireEvent.click(bindKpiBtn);

    // Save template
    const saveBtn = screen.getByText('Save Draft');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'tpl_dataset_test',
        expect.objectContaining({
          draft: expect.objectContaining({
            schemaVersion: 2,
            sheets: expect.arrayContaining([
              expect.objectContaining({
                cells: expect.objectContaining({
                  '0:0': expect.objectContaining({
                    binding: expect.objectContaining({
                      datasetId: 'ds_production',
                      aggregateId: 'agg_total_units',
                    }),
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });
  });

  it('3. prompts parameter dialog when required parameter is unset and downloads upon entry', async () => {
    // Template with required parameter
    const templateWithRequiredParam: apiClient.ExportTemplateItem = {
      ...mockTemplate,
      published: {
        kind: 'grid',
        version: 1,
        schemaVersion: 2,
        filenameExpression: '"production_report"',
        pdf: { mode: 'table' },
        sheets: [],
        parameters: [
          {
            id: 'param_dept',
            name: 'dept',
            label: 'Department',
            type: 'text',
            required: true,
            defaultValue: '',
          },
        ],
        datasets: [],
      },
    };

    vi.mocked(apiClient.getExportTemplate).mockResolvedValue(templateWithRequiredParam);
    vi.mocked(apiClient.fetchEntityPermissions).mockResolvedValue([
      { role: 'editor', canExport: true, canRead: true, canCreate: true, canUpdate: true, canDelete: true },
    ]);
    const mockCreateToken = vi.mocked(apiClient.createExportDownloadToken).mockResolvedValue({
      token: 'tok_success',
      expiresIn: 60,
      downloadUrl: '/api/exports/tok_success',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            user: { id: 'u1', email: 'editor@test.com', role: 'editor' as any, tenantId: 'test_tenant' },
            loading: false,
            login: vi.fn(),
            signup: vi.fn(),
            acceptInvite: vi.fn(),
            logout: vi.fn(),
            refetchUser: vi.fn(),
          }}
        >
          <PageRuntimeProvider tenantId="test_tenant">
            <ExportButtonComponent
              label="Download Production Report"
              template="tpl_dataset_test"
              format="xlsx"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Download Production Report')).toBeInTheDocument();
    });

    // Click Export Button without providing the required parameter
    fireEvent.click(screen.getByText('Download Production Report'));

    // Modal dialog pops up asking for required parameter
    await waitFor(() => {
      expect(screen.getByText('Export Parameters')).toBeInTheDocument();
      expect(screen.getByText(/Department/)).toBeInTheDocument();
    });

    // Find input for Department, type 'Assembly', and submit
    const deptInput = screen.getByTestId('param-input-dept');
    fireEvent.change(deptInput, { target: { value: 'Assembly' } });

    const submitBtn = screen.getByTestId('param-dialog-download-btn');
    fireEvent.click(submitBtn);

    // Verify download token called with final parameter
    await waitFor(() => {
      expect(mockCreateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'tpl_dataset_test',
          format: 'xlsx',
          parameters: expect.objectContaining({
            dept: 'Assembly',
          }),
        })
      );
    });
  });
});
