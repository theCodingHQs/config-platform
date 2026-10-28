import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GridTemplateDesigner } from '../src/studio/GridTemplateDesigner';
import * as apiClient from '../src/api/client';

// The designer uses React Query (its Share button and shared layouts), as it does inside the app
const render = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // A wrapper (not wrapping the element) so rerender keeps the provider
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
};

// Mock API client
vi.mock('../src/api/client', () => ({
  getExportTemplate: vi.fn(),
  updateExportTemplate: vi.fn(),
  publishExportTemplate: vi.fn(),
  downloadExportTemplateRenderPreview: vi.fn(),
  fetchExportTemplatePreviewData: vi.fn(),
}));

const mockEntities: any[] = [
  {
    id: 'ent_emp',
    name: 'Employee',
    label: 'Employee Directory',
    columns: [
      { id: 'f_name', name: 'first_name', label: 'First Name', type: 'text' },
      { id: 'f_salary', name: 'salary', label: 'Salary', type: 'number' },
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
    resolveField: (id: string) => mockEntities[0].columns.find((f: any) => f.id === id),
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

describe('Phase 2B Addendum: Designer Visibility of Bindings & Panels', () => {
  const mockTemplate: apiClient.ExportTemplateItem = {
    id: 'tpl_emp',
    name: 'Employee Export Report',
    entityId: 'ent_emp',
    version: 1,
    draft: {
      kind: 'grid',
      version: 1,
      filenameExpression: '"employees"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_1',
          name: 'Employees',
          order: 0,
          merges: [],
          cells: {
            '0:0': { value: 'Directory Header' },
            '2:0': {
              value: '{{ First Name }}',
              binding: { entityId: 'ent_emp', fieldId: 'f_name', displayLabel: 'First Name' },
            },
            '2:1': {
              value: '{{ Salary }}',
              binding: { entityId: 'ent_emp', fieldId: 'f_salary', displayLabel: 'Salary' },
            },
          },
          regions: [
            {
              id: 'reg_1',
              entityId: 'ent_emp',
              displayLabel: 'Employee Table Band',
              startRow: 2,
              endRow: 7,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: 'f_name', displayLabel: 'First Name' },
                { col: 1, fieldId: 'f_salary', displayLabel: 'Salary' },
              ],
            },
          ],
          conditionalFormats: [],
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getExportTemplate).mockResolvedValue(mockTemplate);
    vi.mocked(apiClient.updateExportTemplate).mockResolvedValue({
      id: 'tpl_emp',
      name: 'Employee Export Report',
      entityId: 'ent_emp',
      version: 1,
      draft: mockTemplate.draft,
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('renders the designer and displays bound cell notice when a bound cell is selected', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_emp/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Employee Export Report')).toBeInTheDocument();
    });

    // Side panel tabs should be present
    expect(screen.getByText('Entity Fields')).toBeInTheDocument();
    expect(screen.getByText('Regions (1)')).toBeInTheDocument();

    // Switch to Regions tab and click region card to select cell 2:0 (which is bound to First Name)
    const regionsTab = screen.getByText('Regions (1)');
    fireEvent.click(regionsTab);

    const regionCard = screen.getByText('Employee Table Band');
    fireEvent.click(regionCard);

    // Bound cell notice should be displayed
    await waitFor(() => {
      expect(screen.getByTestId('bound-cell-notice')).toHaveTextContent('Bound · First Name');
    });

    // Unbind button should be available
    const unbindBtns = screen.getAllByRole('button', { name: /unbind selected cell/i });
    expect(unbindBtns.length).toBeGreaterThan(0);
  });

  it('side panel lists regions with entity, range, and clicking selects the range', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_emp/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Employee Export Report')).toBeInTheDocument();
    });

    // Switch to Regions tab
    const regionsTab = screen.getByText('Regions (1)');
    fireEvent.click(regionsTab);

    // Region label and details should be visible
    expect(screen.getByText('Employee Table Band')).toBeInTheDocument();
    expect(screen.getByText(/Rows 3–8/i)).toBeInTheDocument();
    expect(screen.getByText(/Cols 1–2/i)).toBeInTheDocument();

    // Clicking the region card triggers range selection
    const regionCard = screen.getByText('Employee Table Band');
    fireEvent.click(regionCard);

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast')).toHaveTextContent(
        'Selected region Employee Table Band'
      );
    });
  });

  it('toggles between Design view and Preview with data using real draft preview endpoint', async () => {
    const previewDraft = {
      ...mockTemplate.draft,
      sheets: [
        {
          ...mockTemplate.draft.sheets[0],
          cells: {
            ...mockTemplate.draft.sheets[0].cells,
            '2:0': { value: 'Alice Preview' },
            '3:0': { value: 'Bob Preview' },
          },
        },
      ],
    };

    vi.mocked(apiClient.fetchExportTemplatePreviewData).mockResolvedValue(previewDraft);

    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_emp/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Employee Export Report')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole('button', { name: /preview with data/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click toggle to enter preview mode
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(apiClient.fetchExportTemplatePreviewData).toHaveBeenCalledWith('tpl_emp');
      expect(screen.getByRole('button', { name: /design view/i })).toBeInTheDocument();
    });

    // Click again to return to design view
    const designViewBtn = screen.getByRole('button', { name: /design view/i });
    fireEvent.click(designViewBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /preview with data/i })).toBeInTheDocument();
    });
  });

  it('validates against unknown entity or field on save and shows error', async () => {
    const invalidTemplate: apiClient.ExportTemplateItem = {
      ...mockTemplate,
      draft: {
        ...mockTemplate.draft,
        sheets: [
          {
            ...mockTemplate.draft.sheets[0],
            regions: [],
            cells: {
              '1:0': {
                value: '{{ Unknown Field }}',
                binding: {
                  entityId: 'ent_emp',
                  fieldId: 'f_non_existent',
                  displayLabel: 'Unknown Field',
                },
              },
            },
          },
        ],
      },
    };

    vi.mocked(apiClient.getExportTemplate).mockResolvedValue(invalidTemplate);

    render(
      <MemoryRouter initialEntries={['/studio/export-templates/tpl_emp/designer']}>
        <Routes>
          <Route path="/studio/export-templates/:id/designer" element={<GridTemplateDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Employee Export Report')).toBeInTheDocument();
    });

    // Try saving
    const saveBtn = screen.getByRole('button', { name: /save draft/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast')).toHaveTextContent(
        "unknown field 'f_non_existent'"
      );
    });

    // Save API should NOT have been called due to client-side validation
    expect(apiClient.updateExportTemplate).not.toHaveBeenCalled();
  });
});
