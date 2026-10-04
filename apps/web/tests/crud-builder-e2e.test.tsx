import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { PageBuilder } from '../src/studio/PageBuilder';
import { MetadataProvider } from '../src/context/metadata-context';
import * as apiClient from '../src/api/client';
import type { PageDetail } from '../src/api/client';
import type { ErdTable, PageDefinition } from '@config-platform/schema';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual('../src/api/client');
  return {
    ...actual,
    fetchPage: vi.fn(),
    updatePage: vi.fn(),
    publishPage: vi.fn(),
    fetchRecords: vi.fn(),
  };
});

const mockEntities: ErdTable[] = [
  {
    id: 't_product',
    name: 'product',
    label: 'Product',
    displayFieldId: 'c_name',
    physicalTableName: 't_product',
    version: 1,
    columns: [
      {
        id: 'c_name',
        name: 'name',
        label: 'Product Name',
        physicalColumnName: 'c_name',
        type: 'text',
        required: true,
        unique: false,
        isPrimary: false,
        position: 0,
        isForeignKey: false,
        config: {},
      },
      {
        id: 'c_price',
        name: 'price',
        label: 'Price',
        physicalColumnName: 'c_price',
        type: 'number',
        required: false,
        unique: false,
        isPrimary: false,
        position: 1,
        isForeignKey: false,
        config: {},
      },
    ],
  },
];

describe('End-to-End: CRUD Page via Builder UI Operations', () => {
  let queryClient: QueryClient;
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  });

  it('builds a full CRUD page (list, create modal, edit modal, delete with confirm) using builder operations and templates', async () => {
    const user = userEvent.setup();

    const initialDraft: PageDefinition = {
      schemaVersion: 2,
      id: 'p_crud_test',
      version: 1,
      route: '/products-crud',
      state: {},
      dataSources: [],
      root: {
        id: 'root_stack',
        type: 'stack',
        props: { direction: 'vertical', gap: 16 },
        children: [],
      },
    };

    const initialPageDetail: PageDetail = {
      id: 'p_crud_test',
      name: 'Products CRUD Management',
      route: '/products-crud',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      draft: initialDraft,
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      brokenBindings: [],
    };

    (apiClient.fetchPage as any).mockResolvedValue(initialPageDetail);
    (apiClient.fetchRecords as any).mockResolvedValue({
      data: [{ id: 'p_101', name: 'Widget Pro', price: 99 }],
      nextCursor: null,
    });

    let savedDraft: PageDefinition | null = null;
    (apiClient.updatePage as any).mockImplementation((_tid: string, _pid: string, input: any) => {
      savedDraft = input.draft;
      return Promise.resolve({
        ...initialPageDetail,
        draft: input.draft,
        version: 2,
      });
    });

    (apiClient.publishPage as any).mockImplementation((_tid: string, _pid: string) => {
      return Promise.resolve({
        ...initialPageDetail,
        draft: savedDraft || initialDraft,
        published: savedDraft || initialDraft,
        hasPublished: true,
        version: 3,
      });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId={tenantId} initialEntities={mockEntities}>
          <MemoryRouter initialEntries={['/studio/pages/p_crud_test']}>
            <Routes>
              <Route path="/studio/pages/:id" element={<PageBuilder />} />
            </Routes>
          </MemoryRouter>
        </MetadataProvider>
      </QueryClientProvider>
    );

    // 1. Wait for builder to load
    await waitFor(() => {
      expect(screen.getByText('Products CRUD Management')).toBeInTheDocument();
    });

    // 2. Open Templates modal
    const templatesBtn = screen.getByRole('button', { name: /Templates/i });
    await user.click(templatesBtn);

    expect(screen.getByText('Create From Template')).toBeInTheDocument();
    expect(screen.getByText('CRUD List')).toBeInTheDocument();

    // 3. Choose CRUD List template and apply
    const crudTemplateOption = screen.getByText('CRUD List');
    await user.click(crudTemplateOption);

    const applyTemplateBtn = screen.getByRole('button', { name: /Apply Template/i });
    await user.click(applyTemplateBtn);

    // 4. Verify the pre-wired CRUD template components are populated in tree and state
    await waitFor(() => {
      expect(screen.getByText('Applied CRUD list template')).toBeInTheDocument();
    });

    // State should have editRecordId, createModalOpen, editModalOpen
    expect(screen.getByRole('button', { name: /State \(3\)/i })).toBeInTheDocument();
    // Data Sources should have ds_product
    expect(screen.getByRole('button', { name: /Data Sources \(1\)/i })).toBeInTheDocument();

    // 5. Test Keyboard Shortcuts: Duplicate & Delete
    // Tree item should show crud_table
    const tableTreeItem = screen.getByText('crud_table');
    await user.click(tableTreeItem);

    // Cmd/Ctrl+D duplicates the selected node
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });

    // Undo with Ctrl+Z
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    // 6. Save Draft and inspect the generated CRUD structure
    const saveDraftBtn = screen.getByRole('button', { name: /Save Draft/i });
    await user.click(saveDraftBtn);

    await waitFor(() => {
      expect(apiClient.updatePage).toHaveBeenCalled();
    });

    expect(savedDraft).not.toBeNull();
    const finalDraft = savedDraft!;

    // Verify Data Source
    expect(finalDraft.dataSources).toHaveLength(1);
    expect(finalDraft.dataSources[0].id).toBe('ds_product');
    expect(finalDraft.dataSources[0].entityId).toBe('t_product');

    // Verify Root Children
    const rootChildren = finalDraft.root.children || [];
    expect(rootChildren.length).toBeGreaterThanOrEqual(4);

    // 1. Header Stack with Title & "+ New Product" button
    const headerStack = rootChildren.find((c) => c.id === 'header_stack');
    expect(headerStack).toBeDefined();
    const createBtn = headerStack?.children?.find((c) => c.type === 'button');
    expect(createBtn?.props?.label).toContain('+ New Product');
    expect(createBtn?.props?.onClick?.[0].type).toBe('openModal');
    expect(createBtn?.props?.onClick?.[0].params.modalKey).toBe('createModalOpen');

    // 2. Table with onRowClick (sets editRecordId and opens edit modal)
    const tableNode = rootChildren.find((c) => c.id === 'crud_table');
    expect(tableNode).toBeDefined();
    expect(tableNode?.props?.source).toBe('ds_product');
    expect(tableNode?.props?.onRowClick?.[0].type).toBe('setState');
    expect(tableNode?.props?.onRowClick?.[0].params.key).toBe('editRecordId');
    expect(tableNode?.props?.onRowClick?.[1].type).toBe('openModal');
    expect(tableNode?.props?.onRowClick?.[1].params.modalKey).toBe('editModalOpen');

    // 3. Create Modal with create form (mode: "create")
    const createModal = rootChildren.find((c) => c.id === 'create_modal');
    expect(createModal).toBeDefined();
    expect(createModal?.props?.openStateKey).toBe('createModalOpen');
    const createForm = createModal?.children?.find((c) => c.type === 'form');
    expect(createForm?.props?.mode).toBe('create');
    expect(createForm?.props?.entityId).toBe('t_product');

    // 4. Edit Modal with edit form (mode: "edit", recordId: "{{ state.editRecordId }}") and Delete button with confirm
    const editModal = rootChildren.find((c) => c.id === 'edit_modal');
    expect(editModal).toBeDefined();
    expect(editModal?.props?.openStateKey).toBe('editModalOpen');
    const editForm = editModal?.children?.find((c) => c.type === 'form');
    expect(editForm?.props?.mode).toBe('edit');
    expect(editForm?.props?.recordId).toBe('{{ state.editRecordId }}');

    // Delete Button with Confirm Action
    const deleteBtn = editModal?.children?.find((c) => c.type === 'button');
    expect(deleteBtn?.props?.label).toContain('Delete Product');
    expect(deleteBtn?.props?.variant).toBe('danger');
    const deleteActions = deleteBtn?.props?.onClick || [];
    expect(deleteActions[0].type).toBe('confirm');
    expect(deleteActions[0].params.title).toBe('Delete Confirmation');
    expect(deleteActions[0].params.message).toContain('Are you sure you want to delete this Product?');
    expect(deleteActions[1].type).toBe('deleteRecord');

    // 7. Publish Page
    const publishBtn = screen.getByRole('button', { name: /^Publish$/i });
    await user.click(publishBtn);

    await waitFor(() => {
      expect(apiClient.publishPage).toHaveBeenCalledWith(tenantId, 'p_crud_test');
    });
  }, 20000);
});
