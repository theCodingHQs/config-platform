import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { MetadataProvider } from '../src/context/metadata-context';
import { EntityManager } from '../src/studio/EntityManager';
import { PageManager } from '../src/studio/PageManager';
import { PageBuilder } from '../src/studio/PageBuilder';
import { renderNode } from '../src/renderer/render-node';
import * as apiClient from '../src/api/client';
import type { ErdTable, PageDefinition } from '@config-platform/schema';

const mockEntities: ErdTable[] = [
  {
    id: 't_sensor',
    name: 'sensor',
    label: 'Sensor Unit',
    physicalTableName: 't_sensor',
    version: 1,
    columns: [
      {
        id: 'c_model',
        name: 'model',
        label: 'Model Number',
        physicalColumnName: 'c_model',
        type: 'text',
        required: true,
        unique: false,
        isPrimary: false,
        position: 0,
        isForeignKey: false,
        config: {},
      },
      {
        id: 'c_temp',
        name: 'temperature',
        label: 'Temperature (C)',
        physicalColumnName: 'c_temp',
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

function createTestWrapper(initialEntities: ErdTable[] = mockEntities) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MetadataProvider tenantId="test_tenant" initialEntities={initialEntities}>
        {children}
      </MetadataProvider>
    </QueryClientProvider>
  );
}

describe('Studio & Page Builder UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Entity manager create/add field/rename flow
  it('entity manager allows creating an entity, adding a field, and renaming a field', async () => {
    const createEntSpy = vi.spyOn(apiClient, 'createEntity').mockResolvedValue({ id: 't_new', success: true });
    const addFieldSpy = vi.spyOn(apiClient, 'addField').mockResolvedValue({ success: true, field: { id: 'c_pressure' } });
    const updateFieldSpy = vi.spyOn(apiClient, 'updateField').mockResolvedValue({ success: true });

    vi.spyOn(apiClient, 'fetchSchemaEntities').mockResolvedValue(mockEntities);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EntityManager />
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    expect(screen.getByText('Data Entities')).toBeInTheDocument();
    expect(screen.getAllByText('Sensor Unit').length).toBeGreaterThanOrEqual(1);

    // 1. Click Create Entity
    const createBtn = screen.getByRole('button', { name: /\+ Create Entity/i });
    await user.click(createBtn);

    const labelInput = screen.getByLabelText(/Display Label/i);
    await user.type(labelInput, 'Turbine');

    const submitCreateBtn = screen.getByRole('button', { name: /^Create$/i });
    await user.click(submitCreateBtn);

    expect(createEntSpy).toHaveBeenCalledWith('test_tenant', expect.objectContaining({ label: 'Turbine', name: 'turbine' }));

    // 2. Click Add Field
    const addFieldBtn = screen.getByRole('button', { name: /\+ Add Field/i });
    await user.click(addFieldBtn);

    const fieldLabelInput = screen.getByLabelText(/Field Label/i);
    await user.type(fieldLabelInput, 'Pressure');

    const submitAddFieldBtn = screen.getByRole('button', { name: /^Add Field$/i });
    await user.click(submitAddFieldBtn);

    expect(addFieldSpy).toHaveBeenCalledWith('test_tenant', 't_sensor', expect.objectContaining({ label: 'Pressure', name: 'pressure' }));

    // 3. Rename Field
    const renameBtns = screen.getAllByRole('button', { name: /^Rename$/i });
    await user.click(renameBtns[0]);

    const editLabelInput = screen.getByLabelText(/Field Label/i);
    await user.clear(editLabelInput);
    await user.type(editLabelInput, 'Serial Model');

    const saveChangesBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveChangesBtn);

    expect(updateFieldSpy).toHaveBeenCalledWith(
      'test_tenant',
      't_sensor',
      'c_model',
      expect.objectContaining({ label: 'Serial Model' })
    );
  });

  // 2. Page Manager list and create
  it('page manager lists pages and creates a new page', async () => {
    vi.spyOn(apiClient, 'fetchPages').mockResolvedValue([
      {
        id: 'p_1',
        name: 'Telemetry Dashboard',
        route: '/telemetry',
        version: 1,
        hasDraft: true,
        hasPublished: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const createPageSpy = vi.spyOn(apiClient, 'createPage').mockResolvedValue({
      id: 'p_new',
      name: 'Analytics',
      route: '/analytics',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      draft: {} as any,
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      brokenBindings: [],
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PageManager />
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Telemetry Dashboard')).toBeInTheDocument();
    });
    expect(screen.getByText('/telemetry')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();

    // Create page
    const createBtn = screen.getByRole('button', { name: /\+ Create Page/i });
    await user.click(createBtn);

    await user.type(screen.getByPlaceholderText(/Inventory Dashboard/i), 'Analytics');
    await user.click(screen.getByRole('button', { name: /^Create Page$/i }));

    expect(createPageSpy).toHaveBeenCalledWith('test_tenant', { name: 'Analytics', route: '/analytics' });
  });

  // 3. Builder adds a table, binds an entity and columns, saves, publishes
  it('builder adds a table component, binds entity and columns, saves draft, and publishes', async () => {
    const initialPage: apiClient.PageDetail = {
      id: 'p_builder_test',
      name: 'Sensors Page',
      route: '/sensors',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: [],
      draft: {
        schemaVersion: 1,
        id: 'p_builder_test',
        version: 1,
        route: '/sensors',
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical', gap: 16 },
          children: [
            {
              id: 'text_header',
              type: 'text',
              props: { value: 'Sensors Overview', variant: 'h1' },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(initialPage);
    const updatePageSpy = vi.spyOn(apiClient, 'updatePage').mockResolvedValue(initialPage);
    const publishPageSpy = vi.spyOn(apiClient, 'publishPage').mockResolvedValue({
      ...initialPage,
      hasPublished: true,
      published: initialPage.draft,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/studio/pages/p_builder_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    // Verify initial load
    await waitFor(() => {
      expect(screen.getByText('Sensors Overview')).toBeInTheDocument();
    });

    // 1. Add Table component from palette
    const addTableBtn = screen.getByRole('button', { name: /\+ table/i });
    await user.click(addTableBtn);

    // Verify table appears in properties panel
    await waitFor(() => {
      expect(screen.getByLabelText(/Data Entity/i)).toBeInTheDocument();
    });

    // 2. Select entity in table properties
    const entitySelect = screen.getByLabelText(/Data Entity/i);
    await user.selectOptions(entitySelect, 't_sensor');

    // 3. Save draft
    const saveBtn = screen.getByRole('button', { name: /Save Draft/i });
    await user.click(saveBtn);

    expect(updatePageSpy).toHaveBeenCalledWith(
      'test_tenant',
      'p_builder_test',
      expect.objectContaining({ expectedVersion: 1 })
    );

    // 4. Publish
    const publishBtn = screen.getByRole('button', { name: /^Publish$/i });
    await user.click(publishBtn);

    expect(publishPageSpy).toHaveBeenCalledWith('test_tenant', 'p_builder_test');
  });

  // 4. Switching table or form entity resets fields that no longer apply
  it('resets columns when table entity selection is changed', async () => {
    const pageWithTable: apiClient.PageDetail = {
      id: 'p_reset_test',
      name: 'Reset Test',
      route: '/reset',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: [],
      draft: {
        schemaVersion: 1,
        id: 'p_reset_test',
        version: 1,
        route: '/reset',
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'my_table',
              type: 'table',
              props: {
                entityId: 't_sensor',
                columns: [{ fieldId: 'c_model' }],
                pageSize: 10,
              },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(pageWithTable);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/studio/pages/p_reset_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    // Select the table node in the tree
    await waitFor(() => {
      expect(screen.getByText('my_table')).toBeInTheDocument();
    });
    await user.click(screen.getByText('my_table'));

    // Verify c_model is checked
    const modelCheckbox = screen.getByLabelText(/Model Number/i) as HTMLInputElement;
    expect(modelCheckbox.checked).toBe(true);

    // Change entity to empty or different
    const entitySelect = screen.getByLabelText(/Data Entity/i);
    await user.selectOptions(entitySelect, '');

    // Checkboxes should no longer be present
    expect(screen.queryByLabelText(/Model Number/i)).not.toBeInTheDocument();
  });

  // 5. Undo / Redo functionality in Builder
  it('supports undo and redo for draft tree updates', async () => {
    const initialPage: apiClient.PageDetail = {
      id: 'p_undo_test',
      name: 'Undo Test',
      route: '/undo',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: [],
      draft: {
        schemaVersion: 1,
        id: 'p_undo_test',
        version: 1,
        route: '/undo',
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'my_text',
              type: 'text',
              props: { value: 'Original Value', variant: 'body' },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(initialPage);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/studio/pages/p_undo_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Original Value')).toBeInTheDocument();
    });

    // Select text node in tree
    await user.click(screen.getByText('my_text'));

    // Edit text value
    const textInput = screen.getByLabelText(/Text Content/i) as HTMLTextAreaElement;
    fireEvent.change(textInput, { target: { value: 'Modified Value' } });

    await waitFor(() => {
      expect(screen.getAllByText('Modified Value').length).toBeGreaterThanOrEqual(1);
    });

    // Click Undo
    const undoBtn = screen.getByTitle('Undo');
    await user.click(undoBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Original Value').length).toBeGreaterThanOrEqual(1);
    });

    // Click Redo
    const redoBtn = screen.getByTitle('Redo');
    await user.click(redoBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Modified Value').length).toBeGreaterThanOrEqual(1);
    });
  });

  // 6. Validation flags deleted/broken field
  it('flags broken bindings when a deleted field is present in page definition', async () => {
    const brokenPage: apiClient.PageDetail = {
      id: 'p_broken_test',
      name: 'Broken Field Page',
      route: '/broken',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: ["Table [table_1] references missing column 'c_deleted_col'"],
      draft: {
        schemaVersion: 1,
        id: 'p_broken_test',
        version: 1,
        route: '/broken',
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'table_1',
              type: 'table',
              props: {
                entityId: 't_sensor',
                columns: [{ fieldId: 'c_deleted_col' }],
              },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(brokenPage);

    render(
      <MemoryRouter initialEntries={['/studio/pages/p_broken_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    // Validation badge should flag the broken binding
    await waitFor(() => {
      expect(screen.getByText(/1 broken/i)).toBeInTheDocument();
    });
  });

  // 7. Published page renders in the runtime
  it('renders published page in the runtime renderer', () => {
    const publishedPage: PageDefinition = {
      schemaVersion: 2,
      id: 'p_pub_render',
      version: 2,
      route: '/live-page',
      state: {},
      dataSources: [],
      root: {
        id: 'root',
        type: 'stack',
        props: { direction: 'vertical', gap: 20 },
        children: [
          {
            id: 'header',
            type: 'text',
            props: { value: 'Live Published Dashboard', variant: 'h1' },
          },
          {
            id: 'action_btn',
            type: 'button',
            props: { label: 'Refresh Data', variant: 'primary' },
          },
        ],
      },
    };

    render(renderNode(publishedPage.root) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    expect(screen.getByText('Live Published Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh Data/i })).toBeInTheDocument();
  });

  // 8. Component Tree Hover & Active Overlay
  it('highlights hovered and active components on the preview overlay from component tree interactions', async () => {
    const pageWithComponents: apiClient.PageDetail = {
      id: 'p_overlay_test',
      name: 'Overlay Test',
      route: '/overlay-test',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: [],
      draft: {
        schemaVersion: 1,
        id: 'p_overlay_test',
        version: 1,
        route: '/overlay-test',
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'btn_test',
              type: 'button',
              props: { label: 'Click Me', variant: 'primary' },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(pageWithComponents);

    render(
      <MemoryRouter initialEntries={['/studio/pages/p_overlay_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    // Wait for tree node to render
    await waitFor(() => {
      expect(screen.getByText('btn_test')).toBeInTheDocument();
    });

    // Verify component in preview has data-node-id and display: contents
    const nodeWrapper = document.querySelector('[data-node-id="btn_test"]') as HTMLElement;
    expect(nodeWrapper).toBeInTheDocument();
    expect(nodeWrapper.style.display).toBe('contents');

    // Hover over tree item
    const treeItem = screen.getByText('btn_test').closest('div')!;
    fireEvent.mouseEnter(treeItem);

    // Click tree item to make active
    fireEvent.click(treeItem);

    // Verify active overlay is rendered with node ID
    await waitFor(() => {
      const activeOverlay = screen.getByTestId('preview-active-overlay');
      expect(activeOverlay).toBeInTheDocument();
      expect(activeOverlay).toHaveTextContent('btn_test');
    });
  });

  // 9. Publication change detection and highlights
  it('highlights unpublished changes and transitions to Up to Date upon publishing', async () => {
    const pageWithDraftChanges: apiClient.PageDetail = {
      id: 'p_status_test',
      name: 'Status Test',
      route: '/status-test',
      version: 1,
      hasDraft: true,
      hasPublished: false,
      brokenBindings: [],
      draft: {
        schemaVersion: 1,
        id: 'p_status_test',
        version: 1,
        route: '/status-test',
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'status_text',
              type: 'text',
              props: { value: 'Draft version', variant: 'body' },
            },
          ],
        },
      },
      published: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'fetchPage').mockResolvedValue(pageWithDraftChanges);
    vi.spyOn(apiClient, 'publishPage').mockResolvedValue({
      ...pageWithDraftChanges,
      hasPublished: true,
      published: pageWithDraftChanges.draft,
      version: 2,
    });

    render(
      <MemoryRouter initialEntries={['/studio/pages/p_status_test']}>
        <Routes>
          <Route path="/studio/pages/:id" element={<PageBuilder />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createTestWrapper() }
    );

    // Initial state: page has unpublished changes
    await waitFor(() => {
      expect(screen.getByTestId('status-unpublished-badge')).toBeInTheDocument();
    });

    const publishBtn = screen.getByRole('button', { name: /^Publish$/i });
    expect(publishBtn).toBeInTheDocument();
    expect(publishBtn).not.toBeDisabled();

    // Click Publish
    fireEvent.click(publishBtn);

    // After publish, status transitions to Up to Date
    await waitFor(() => {
      expect(screen.getByTestId('status-uptodate-badge')).toBeInTheDocument();
    });

    // The publish button should now reflect Published and be disabled
    const finishedPublishBtn = screen.getByTestId('publish-btn');
    expect(finishedPublishBtn).toBeDisabled();
    expect(finishedPublishBtn).toHaveTextContent(/Published/i);
  });
});
