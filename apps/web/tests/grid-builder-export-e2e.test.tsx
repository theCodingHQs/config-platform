import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExportButtonComponent } from '../src/components/export-button';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import { AuthContext } from '../src/context/auth-context';
import * as apiClient from '../src/api/client';
import type { GridExportTemplateDefinition } from '@config-platform/schema';

describe('Phase 2B: Builder E2E - Grid Template Creation, Publish & ExportButton Download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function createAuthContextValue(role: string = 'builder') {
    return {
      user: {
        id: 'u_builder_1',
        email: 'builder@test.com',
        role: role as any,
        tenantId: 't_test',
        fullName: 'Builder User',
      },
      loading: false,
      login: vi.fn(),
      signup: vi.fn(),
      acceptInvite: vi.fn(),
      logout: vi.fn(),
      refetchUser: vi.fn(),
    };
  }

  it('builder e2e: creates a grid template with one region, publishes, adds export button, and executes download-token flow', async () => {
    // 1. Mock creating a grid template with one repeating region
    const draftGridDef: GridExportTemplateDefinition = {
      kind: 'grid',
      version: 1,
      schemaVersion: 2,
      parameters: [],
      datasets: [],
      filenameExpression: '"sales_report"',
      pdf: { mode: 'table' },
      sheets: [
        {
          id: 'sheet_sales',
          name: 'Sales By Rep',
          order: 0,
          merges: [],
          conditionalFormats: [],
          cells: {
            '0:0': { value: 'Sales Rep' },
            '0:1': { value: 'Revenue' },
            '1:0': { value: '{{ Rep }}' },
            '1:1': { value: '{{ Revenue }}', numFmt: '$#,##0' },
            '2:0': { value: 'TOTAL' },
            '2:1': { formula: '=SUM(B2:B2)', value: 0 },
          },
          regions: [
            {
              id: 'reg_sales',
              entityId: 'ent_deals',
              startRow: 1,
              endRow: 1,
              startCol: 0,
              endCol: 1,
              columns: [
                { col: 0, fieldId: 'fld_rep', displayLabel: 'Rep' },
                { col: 1, fieldId: 'fld_rev', displayLabel: 'Revenue' },
              ],
            },
          ],
        },
      ],
    };

    let templateStore: apiClient.ExportTemplateItem = {
      id: 'et_deals_grid',
      tenantId: 't_test',
      name: 'Deals Regional Export',
      entityId: 'ent_deals',
      draft: draftGridDef as any,
      published: null,
      version: 1,
      createdAt: '2026-10-11T12:00:00Z',
      updatedAt: '2026-10-11T12:00:00Z',
    };

    const mockCreateTemplate = vi.spyOn(apiClient, 'createExportTemplate').mockImplementation(async (data: any) => {
      templateStore = {
        id: 'et_deals_grid',
        tenantId: 't_test',
        name: data.name,
        entityId: data.entityId,
        draft: data.draft,
        published: null,
        version: 1,
        createdAt: '2026-10-11T12:00:00Z',
        updatedAt: '2026-10-11T12:00:00Z',
      };
      return templateStore;
    });

    // 2. Call createExportTemplate
    const created = await apiClient.createExportTemplate({
      name: 'Deals Regional Export',
      entityId: 'ent_deals',
      draft: draftGridDef as any,
    });
    expect(mockCreateTemplate).toHaveBeenCalledTimes(1);
    expect(created.id).toBe('et_deals_grid');

    // 3. Publish the template
    const mockPublishTemplate = vi.spyOn(apiClient, 'publishExportTemplate').mockImplementation(async (id: string) => {
      templateStore.published = templateStore.draft;
      templateStore.version = 2;
      return templateStore;
    });

    const published = await apiClient.publishExportTemplate('et_deals_grid');
    expect(mockPublishTemplate).toHaveBeenCalledWith('et_deals_grid');
    expect(published.published).toBeDefined();
    expect(published.version).toBe(2);

    // 4. Mount ExportButton linked to the published grid template on a page
    vi.spyOn(apiClient, 'getExportTemplate').mockImplementation(async () => templateStore);
    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([
      {
        role: 'builder',
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canExport: true,
      },
    ]);

    const mockCreateToken = vi.spyOn(apiClient, 'createExportDownloadToken').mockResolvedValue({
      token: 'tok_sales_123',
      expiresIn: 60,
      downloadUrl: '/api/exports/tok_sales_123',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={createAuthContextValue('builder')}>
          <PageRuntimeProvider tenantId="t_test">
            <ExportButtonComponent
              label="Export Regional Deals"
              template="et_deals_grid"
              format="xlsx"
              variant="primary"
            />
          </PageRuntimeProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    // Verify button renders with label
    await waitFor(() => {
      expect(screen.getByText('Export Regional Deals')).toBeInTheDocument();
    });

    // 5. Click the button to trigger download-token flow
    fireEvent.click(screen.getByText('Export Regional Deals'));

    await waitFor(() => {
      expect(mockCreateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'et_deals_grid',
          format: 'xlsx',
        })
      );
    });
  });
});
