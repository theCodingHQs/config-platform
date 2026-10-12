import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDefinition, ErdTable } from '@config-platform/schema';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import { MetadataProvider } from '../src/context/metadata-context';
import { renderNode } from '../src/renderer/render-node';
import { createTemplatePage } from '../src/studio/templates';
import * as apiClient from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual('../src/api/client');
  return {
    ...actual,
    fetchRecords: vi.fn(),
    fetchSchemaEntities: vi.fn(),
  };
});

describe('Table Pagination - CRUD List & Direct Entity Mode', () => {
  const tenantId = 't_pagination_test';
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockEntity: any = {
    id: 'e_products',
    name: 'products',
    label: 'Products',
    physicalTableName: 'tbl_products',
    columns: [
      { id: 'c_id', name: 'id', label: 'ID', type: 'text', primaryKey: true },
      { id: 'c_title', name: 'title', label: 'Title', type: 'text' },
      { id: 'c_price', name: 'price', label: 'Price', type: 'number' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.fetchSchemaEntities as any).mockResolvedValue([mockEntity]);
  });

  it('renders pagination controls on CRUD list template table with large dataset and navigates pages', async () => {
    const user = userEvent.setup();
    const crudPage = createTemplatePage('CRUD list', 'page_crud_products', '/products', mockEntity);

    // Mock first page response (10 records, total 45, nextCursor available)
    const page1Data = Array.from({ length: 10 }, (_, i) => ({
      id: `prod_${i + 1}`,
      title: `Product ${i + 1}`,
      price: (i + 1) * 10,
    }));

    const page2Data = Array.from({ length: 10 }, (_, i) => ({
      id: `prod_${i + 11}`,
      title: `Product ${i + 11}`,
      price: (i + 11) * 10,
    }));

    (apiClient.fetchRecords as any).mockImplementation((_t: string, _e: string, params: any) => {
      if (params?.cursor === 'cursor_page_2') {
        return Promise.resolve({
          data: page2Data,
          total: 45,
          nextCursor: 'cursor_page_3',
        });
      }
      return Promise.resolve({
        data: page1Data,
        total: 45,
        nextCursor: 'cursor_page_2',
      });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId={tenantId} initialEntities={[mockEntity]}>
          <PageRuntimeProvider tenantId={tenantId} page={crudPage}>
            {renderNode(crudPage.root)}
          </PageRuntimeProvider>
        </MetadataProvider>
      </QueryClientProvider>
    );

    // Verify first page records rendered
    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Product 10')).toBeInTheDocument();
    });

    // Verify pagination controls are visible!
    expect(screen.getByText('Showing 1–10 of 45 records')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();

    const prevButton = screen.getByRole('button', { name: /previous page/i });
    const nextButton = screen.getByRole('button', { name: /next page/i });

    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    // Navigate to next page
    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Product 11')).toBeInTheDocument();
      expect(screen.getByText('Product 20')).toBeInTheDocument();
      expect(screen.getByText('Showing 11–20 of 45 records')).toBeInTheDocument();
      expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    });

    expect(prevButton).not.toBeDisabled();

    // Navigate back to previous page
    await user.click(prevButton);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Showing 1–10 of 45 records')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
    });
  });

  it('allows changing page size in DataSource mode and requests the new limit', async () => {
    const user = userEvent.setup();
    const crudPage = createTemplatePage('CRUD list', 'page_crud_products', '/products', mockEntity);

    (apiClient.fetchRecords as any).mockResolvedValue({
      data: [
        { id: 'prod_1', title: 'Product 1', price: 10 },
        { id: 'prod_2', title: 'Product 2', price: 20 },
      ],
      total: 50,
      nextCursor: 'cursor_2',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId={tenantId} initialEntities={[mockEntity]}>
          <PageRuntimeProvider tenantId={tenantId} page={crudPage}>
            {renderNode(crudPage.root)}
          </PageRuntimeProvider>
        </MetadataProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const pageSizeSelect = screen.getByRole('combobox', { name: /records per page/i });
    expect(pageSizeSelect).toBeInTheDocument();

    // Change page size to 20
    await user.selectOptions(pageSizeSelect, '20');

    await waitFor(() => {
      expect(apiClient.fetchRecords).toHaveBeenCalledWith(
        tenantId,
        mockEntity.id,
        expect.objectContaining({ limit: 20 })
      );
    });
  });

  it('renders pagination controls and operates correctly in direct Entity mode', async () => {
    const user = userEvent.setup();
    const entityTablePage: PageDefinition = {
      id: 'page_manual_table',
      schemaVersion: 2,
      version: 1,
      route: '/manual',
      state: {},
      dataSources: [],
      root: {
        id: 'table_node',
        type: 'table',
        props: {
          entityId: mockEntity.id,
          columns: [{ fieldId: 'c_title' }, { fieldId: 'c_price' }],
          pageSize: 5,
        },
      },
    };

    (apiClient.fetchRecords as any).mockImplementation((_t: string, _e: string, params: any) => {
      if (params?.cursor === 'cur_p2') {
        return Promise.resolve({
          data: [{ id: 'prod_6', title: 'Product 6', price: 60 }],
          total: 6,
          nextCursor: null,
        });
      }
      return Promise.resolve({
        data: Array.from({ length: 5 }, (_, i) => ({
          id: `prod_${i + 1}`,
          title: `Product ${i + 1}`,
          price: (i + 1) * 10,
        })),
        total: 6,
        nextCursor: 'cur_p2',
      });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId={tenantId} initialEntities={[mockEntity]}>
          <PageRuntimeProvider tenantId={tenantId} page={entityTablePage}>
            {renderNode(entityTablePage.root)}
          </PageRuntimeProvider>
        </MetadataProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Showing 1–5 of 6 records')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(nextBtn).not.toBeDisabled();

    await user.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Product 6')).toBeInTheDocument();
      expect(screen.getByText('Showing 6–6 of 6 records')).toBeInTheDocument();
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    });

    expect(nextBtn).toBeDisabled();
  });
});
