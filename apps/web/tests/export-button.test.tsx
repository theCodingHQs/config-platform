import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExportButtonComponent } from '../src/components/export-button';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import { AuthContext } from '../src/context/auth-context';
import * as apiClient from '../src/api/client';

describe('ExportButton Component & Builder Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function createAuthContextValue(role: string = 'editor') {
    return {
      user: {
        id: 'u123',
        email: `${role}@test.com`,
        role: role as any,
        tenantId: 't_test',
        fullName: 'Test User',
      },
      loading: false,
      login: vi.fn(),
      signup: vi.fn(),
      acceptInvite: vi.fn(),
      logout: vi.fn(),
      refetchUser: vi.fn(),
    };
  }

  it('renders button with label and downloads when clicked with permission', async () => {
    const mockCreateToken = vi.spyOn(apiClient, 'createExportDownloadToken').mockResolvedValue({
      token: 'tok_abc123',
      expiresIn: 60,
      downloadUrl: '/api/exports/tok_abc123',
    });

    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([
      {
        role: 'editor',
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canExport: true,
      },
    ]);

    const mockTemplate: apiClient.ExportTemplateItem = {
      id: 'et_orders',
      name: 'Order Export',
      entityId: 'e_orders',
      draft: {
        kind: 'simple',
        columns: [],
        defaultSort: [],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '',
        pdf: { mode: 'table' },
      },
      published: null,
      version: 1,
      createdAt: '2026-10-10',
      updatedAt: '2026-10-10',
    };
    vi.spyOn(apiClient, 'getExportTemplate').mockResolvedValue(mockTemplate);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('editor')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Download Orders"
              template="et_orders"
              format="xlsx"
              variant="secondary"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Download Orders')).toBeInTheDocument();
    });

    const button = screen.getByText('Download Orders');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'et_orders',
          format: 'xlsx',
        })
      );
    });
  });

  it('hides button when user role lacks canExport permission', async () => {
    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([
      {
        role: 'viewer',
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        canExport: false,
      },
    ]);

    const mockTemplate: apiClient.ExportTemplateItem = {
      id: 'et_orders',
      name: 'Order Export',
      entityId: 'e_orders',
      draft: {
        kind: 'simple',
        columns: [],
        defaultSort: [],
        defaultFilters: [],
        includeHeader: true,
        csv: { delimiter: ',', bom: false },
        filenameExpression: '',
        pdf: { mode: 'table' },
      },
      published: null,
      version: 1,
      createdAt: '2026-10-10',
      updatedAt: '2026-10-10',
    };
    vi.spyOn(apiClient, 'getExportTemplate').mockResolvedValue(mockTemplate);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('viewer')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Secret Export"
              template="et_orders"
              format="csv"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Secret Export')).not.toBeInTheDocument();
    });
  });

  it('shows button in builder preview mode without triggering download', async () => {
    const mockCreateToken = vi.spyOn(apiClient, 'createExportDownloadToken');

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('editor')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Preview Export"
              format="xlsx"
              isBuilderPreview={true}
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    const button = screen.getByText('Preview Export');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);

    // Verify token was not requested in preview mode
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  it('allows grid template with xlsx format, but disables csv/pdf with an explanation', async () => {
    const mockCreateToken = vi.spyOn(apiClient, 'createExportDownloadToken').mockResolvedValue({
      token: 'tok_grid_123',
      expiresIn: 60,
      downloadUrl: '/api/exports/tok_grid_123',
    });

    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([
      {
        role: 'editor',
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canExport: true,
      },
    ]);

    const mockGridTemplate: apiClient.ExportTemplateItem = {
      id: 'et_grid_report',
      name: 'Grid Financial Report',
      entityId: 'e_finance',
      draft: {
        kind: 'grid',
        version: 1,
        sheets: [{ id: 's1', name: 'Sheet1', cells: {}, order: 0, merges: [], regions: [], conditionalFormats: [] }],
      } as any,
      published: null,
      version: 1,
      createdAt: '2026-10-10',
      updatedAt: '2026-10-10',
    };
    vi.spyOn(apiClient, 'getExportTemplate').mockResolvedValue(mockGridTemplate);

    // 1. Grid template with xlsx succeeds
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('editor')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Export Grid Report"
              template="et_grid_report"
              format="xlsx"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Export Grid Report')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Export Grid Report'));
    await waitFor(() => {
      expect(mockCreateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'et_grid_report',
          format: 'xlsx',
        })
      );
    });

    unmount();
    mockCreateToken.mockClear();

    // 2. Grid template with CSV is blocked with explanation
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('editor')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Export Grid Report as CSV"
              template="et_grid_report"
              format="csv"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Export Grid Report as CSV')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Export Grid Report as CSV'));

    await waitFor(() => {
      expect(screen.getByText(/Grid templates only support XLSX format/i)).toBeInTheDocument();
    });
    expect(mockCreateToken).not.toHaveBeenCalled();
  });
});
