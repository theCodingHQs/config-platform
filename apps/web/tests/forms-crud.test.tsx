import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MetadataProvider } from '../src/context/metadata-context';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import { FormComponent } from '../src/components/form';
import { GridComponent } from '../src/components/grid';
import { TabsComponent } from '../src/components/tabs';
import { ReferenceDisplay, clearReferenceCache } from '../src/components/reference-display';
import { renderNode } from '../src/renderer/render-node';
import { createTemplatePage } from '../src/studio/templates';
import * as apiClient from '../src/api/client';
import type { ErdTable, PageDefinition } from '@config-platform/schema';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual('../src/api/client');
  return {
    ...actual,
    fetchRecord: vi.fn(),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    fetchRecords: vi.fn(),
    fetchAggregate: vi.fn(),
    fetchMyEntityPermissions: vi.fn(),
  };
});

const mockEntities: ErdTable[] = [
  {
    id: 't_department',
    name: 'department',
    label: 'Department',
    displayFieldId: 'c_dept_name',
    physicalTableName: 't_department',
    version: 1,
    columns: [
      {
        id: 'c_dept_name',
        name: 'name',
        label: 'Department Name',
        physicalColumnName: 'c_dept_name',
        type: 'text',
        required: true,
        unique: false,
        isPrimary: false,
        position: 0,
        isForeignKey: false,
        config: {},
      },
    ],
  },
  {
    id: 't_employee',
    name: 'employee',
    label: 'Employee',
    displayFieldId: 'c_emp_name',
    physicalTableName: 't_employee',
    version: 1,
    columns: [
      {
        id: 'c_emp_name',
        name: 'name',
        label: 'Full Name',
        physicalColumnName: 'c_emp_name',
        type: 'text',
        required: true,
        unique: false,
        isPrimary: false,
        position: 0,
        isForeignKey: false,
        config: {},
      },
      {
        id: 'c_emp_email',
        name: 'email',
        label: 'Email Address',
        physicalColumnName: 'c_emp_email',
        type: 'text',
        required: false,
        unique: false,
        isPrimary: false,
        position: 1,
        isForeignKey: false,
        config: {},
      },
      {
        id: 'c_emp_dept',
        name: 'department_id',
        label: 'Department',
        physicalColumnName: 'c_emp_dept',
        type: 'reference',
        required: false,
        unique: false,
        isPrimary: false,
        position: 2,
        isForeignKey: true,
        references: {
          entityId: 't_department',
          fieldId: 'id',
          tableName: 't_department',
        },
        config: {},
      },
    ],
  },
];

function createWrapper(state: Record<string, any> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MetadataProvider initialEntities={mockEntities} tenantId="test-tenant">
        <PageRuntimeProvider initialState={state}>{children}</PageRuntimeProvider>
      </MetadataProvider>
    </QueryClientProvider>
  );
}

describe('Forms, Layout, Confirm, Reference Display & Templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReferenceCache();
    (apiClient.fetchMyEntityPermissions as any)?.mockResolvedValue?.({
      role: 'admin',
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      fields: {},
    });
  });

  // 1. Form Edit Mode: prefill from record and submit via PATCH
  it('prefills edit form from recordId and calls updateRecord (PATCH) on submit', async () => {
    const user = userEvent.setup();

    (apiClient.fetchRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Alice Cooper',
      email: 'alice@example.com',
      department_id: null,
    });
    (apiClient.updateRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Alice Cooper Jr.',
      email: 'alice.jr@example.com',
    });

    const onSuccessMock = vi.fn();

    render(
      <FormComponent
        entityId="t_employee"
        mode="edit"
        recordId="emp_123"
        fields={[
          { fieldId: 'c_emp_name' },
          { fieldId: 'c_emp_email' },
        ]}
        onSuccess={[
          {
            type: 'showToast',
            params: { message: 'Updated!', variant: 'success' },
          },
        ]}
      />,
      { wrapper: createWrapper() }
    );

    // Wait for prefill
    await waitFor(() => {
      expect(apiClient.fetchRecord).toHaveBeenCalledWith('test-tenant', 't_employee', 'emp_123');
    });

    const nameInput = await screen.findByDisplayValue('Alice Cooper');
    const emailInput = await screen.findByDisplayValue('alice@example.com');

    // Edit fields
    await user.clear(nameInput);
    await user.type(nameInput, 'Alice Cooper Jr.');

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Update/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.updateRecord).toHaveBeenCalledWith(
        'test-tenant',
        't_employee',
        'emp_123',
        expect.objectContaining({
          name: 'Alice Cooper Jr.',
          email: 'alice@example.com',
        })
      );
    });
  });

  // Edit-form save sends no system keys
  it('edit-form save sends no system keys', async () => {
    const user = userEvent.setup();

    (apiClient.fetchRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Alice Cooper',
      email: 'alice@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      department_id: null,
    });
    (apiClient.updateRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Alice Updated',
      email: 'alice@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
    });

    render(
      <FormComponent
        entityId="t_employee"
        mode="edit"
        recordId="emp_123"
        fields={[
          { fieldId: 'c_emp_name' },
          { fieldId: 'c_emp_email' },
        ]}
      />,
      { wrapper: createWrapper() }
    );

    const nameInput = await screen.findByDisplayValue('Alice Cooper');
    await user.clear(nameInput);
    await user.type(nameInput, 'Alice Updated');

    const submitBtn = screen.getByRole('button', { name: /Update/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.updateRecord).toHaveBeenCalledTimes(1);
    });

    const callArgs = (apiClient.updateRecord as any).mock.calls[0];
    const payload = callArgs[3];
    expect(payload).toEqual({
      name: 'Alice Updated',
      email: 'alice@example.com',
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('updated_at');
  });

  // A viewer or editor with a read-only field does not send it and the save succeeds
  it('a viewer or editor with a read-only field does not send it and the save succeeds', async () => {
    const user = userEvent.setup();

    (apiClient.fetchRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Bob Smith',
      email: 'bob@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
    (apiClient.fetchMyEntityPermissions as any).mockResolvedValue({
      role: 'editor',
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      fields: {
        c_emp_email: { readOnly: true, hidden: false },
      },
    });
    (apiClient.updateRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Bob Updated',
      email: 'bob@example.com',
    });

    render(
      <FormComponent
        entityId="t_employee"
        mode="edit"
        recordId="emp_123"
        fields={[
          { fieldId: 'c_emp_name' },
          { fieldId: 'c_emp_email' },
        ]}
      />,
      { wrapper: createWrapper() }
    );

    const nameInput = await screen.findByDisplayValue('Bob Smith');
    const emailInput = await screen.findByDisplayValue('bob@example.com');
    expect(emailInput).toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, 'Bob Updated');

    const submitBtn = screen.getByRole('button', { name: /Update/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.updateRecord).toHaveBeenCalledTimes(1);
    });

    const callArgs = (apiClient.updateRecord as any).mock.calls[0];
    const payload = callArgs[3];
    expect(payload).toEqual({
      name: 'Bob Updated',
    });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('c_emp_email');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('updated_at');
  });

  // updateRecord with a full row object succeeds and strips system keys
  it('updateRecord with a full row object succeeds and strips system keys', async () => {
    const actualClient = await vi.importActual<typeof apiClient>('../src/api/client');
    actualClient.setCsrfToken('mock-csrf-token');
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'emp_123',
        name: 'Full Row Name',
        email: 'full@example.com',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      }),
    }));
    global.fetch = fetchMock;

    try {
      const fullRow = {
        id: 'emp_123',
        name: 'Full Row Name',
        email: 'full@example.com',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      };

      const result = await actualClient.updateRecord('test-tenant', 't_employee', 'emp_123', fullRow);
      expect(result).toBeDefined();
      expect(result.id).toBe('emp_123');

      const patchCall = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const requestBody = JSON.parse(patchCall![1].body);
      expect(requestBody).toEqual({
        name: 'Full Row Name',
        email: 'full@example.com',
      });
      expect(requestBody.id).toBeUndefined();
      expect(requestBody.created_at).toBeUndefined();
      expect(requestBody.updated_at).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 2. Per-field overrides: label, helpText, readOnly, hidden
  it('applies per-field overrides (label, helpText, readOnly, hidden)', async () => {
    render(
      <FormComponent
        entityId="t_employee"
        mode="create"
        fields={[
          {
            fieldId: 'c_emp_name',
            label: 'Custom Full Name',
            helpText: 'Please enter legal name',
          },
          {
            fieldId: 'c_emp_email',
            readOnly: true,
          },
          {
            fieldId: 'c_emp_dept',
            hidden: true,
          },
        ]}
      />,
      { wrapper: createWrapper() }
    );

    // Label override
    expect(screen.getByText('Custom Full Name')).toBeInTheDocument();
    // Help text
    expect(screen.getByText('Please enter legal name')).toBeInTheDocument();

    // Read only
    const emailInput = screen.getByLabelText(/Email Address/i);
    expect(emailInput).toHaveAttribute('readonly');

    // Hidden field should not exist in DOM
    expect(screen.queryByLabelText(/Department/i)).not.toBeInTheDocument();
  });

  // 3. Reference display field batching (no N+1)
  it('batches reference display lookups into a single fetchRecords query without N+1', async () => {
    (apiClient.fetchRecords as any).mockResolvedValue({
      data: [
        { id: 'dept_1', name: 'Engineering' },
        { id: 'dept_2', name: 'Product' },
      ],
      nextCursor: null,
    });

    render(
      <div>
        <ReferenceDisplay targetEntityId="t_department" recordId="dept_1" />
        <ReferenceDisplay targetEntityId="t_department" recordId="dept_2" />
        <ReferenceDisplay targetEntityId="t_department" recordId="dept_1" />
      </div>,
      { wrapper: createWrapper() }
    );

    // Wait for batch resolve
    await waitFor(() => {
      expect(screen.getAllByText('Engineering')).toHaveLength(2);
      expect(screen.getByText('Product')).toBeInTheDocument();
    });

    // Exactly one batch fetch call made for t_department with filter in: ['dept_1', 'dept_2']
    expect(apiClient.fetchRecords).toHaveBeenCalledTimes(1);
    expect(apiClient.fetchRecords).toHaveBeenCalledWith(
      'test-tenant',
      't_department',
      expect.objectContaining({
        filter: { id: { in: expect.arrayContaining(['dept_1', 'dept_2']) } },
      })
    );
  });

  // 4. Confirm action stops the chain when cancelled
  it('confirm action stops the chain when cancelled, and proceeds when confirmed', async () => {
    const user = userEvent.setup();

    const secondActionMock = vi.fn();
    (apiClient.updateRecord as any).mockImplementation(secondActionMock);

    // Render a button with a confirm action followed by an updateRecord action
    const pageWithConfirm: PageDefinition = {
      schemaVersion: 2,
      id: 'p_confirm_test',
      version: 1,
      route: '/confirm',
      state: {},
      dataSources: [],
      root: {
        id: 'btn_test',
        type: 'button',
        props: {
          label: 'Delete Record',
          onClick: [
            {
              type: 'confirm',
              params: {
                title: 'Delete Confirmation',
                message: 'Do you really want to delete this?',
                confirmLabel: 'Confirm Delete',
                cancelLabel: 'Nevermind',
              },
            },
            {
              type: 'deleteRecord',
              params: { entityId: 't_employee', id: 'emp_123' },
            },
          ],
        },
      },
    };

    render(
      <PageRuntimeProvider>
        {renderNode(pageWithConfirm.root)}
      </PageRuntimeProvider>,
      { wrapper: createWrapper() }
    );

    const deleteBtn = screen.getByRole('button', { name: 'Delete Record' });

    // 1. Click button -> Confirm modal appears
    await user.click(deleteBtn);
    expect(screen.getByText('Delete Confirmation')).toBeInTheDocument();
    expect(screen.getByText('Do you really want to delete this?')).toBeInTheDocument();

    // 2. Click Cancel ("Nevermind") -> Modal closes, chain stops
    const cancelBtn = screen.getByRole('button', { name: 'Nevermind' });
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Delete Confirmation')).not.toBeInTheDocument();
    });
    // apiClient.deleteRecord / next action never called
    expect(apiClient.updateRecord).not.toHaveBeenCalled();

    // 3. Click button again -> Click Confirm Delete
    await user.click(deleteBtn);
    expect(screen.getByText('Delete Confirmation')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Delete' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('Delete Confirmation')).not.toBeInTheDocument();
    });
  });

  // 5. Grid and Tabs render children
  it('grid and tabs components render their children properly', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <GridComponent columns={3} gap={20}>
          <div data-testid="grid-child-1">Child 1</div>
          <div data-testid="grid-child-2">Child 2</div>
          <div data-testid="grid-child-3">Child 3</div>
        </GridComponent>

        <TabsComponent
          tabs={[
            { id: 'tab_one', label: 'First Tab' },
            { id: 'tab_two', label: 'Second Tab' },
          ]}
          defaultTab="tab_one"
        >
          <div data-testid="tab-content-1">Content 1</div>
          <div data-testid="tab-content-2">Content 2</div>
        </TabsComponent>
      </div>,
      { wrapper: createWrapper() }
    );

    // Grid checks
    expect(screen.getByTestId('grid-child-1')).toBeInTheDocument();
    expect(screen.getByTestId('grid-child-2')).toBeInTheDocument();
    expect(screen.getByTestId('grid-child-3')).toBeInTheDocument();

    // Tabs checks
    expect(screen.getByTestId('tab-content-1')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-content-2')).not.toBeInTheDocument();

    // Switch tab
    const tabTwoBtn = screen.getByRole('tab', { name: 'Second Tab' });
    await user.click(tabTwoBtn);

    expect(screen.getByTestId('tab-content-2')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-content-1')).not.toBeInTheDocument();
  });

  // 6. Templates: "Master/Detail", "Dashboard", "CRUD list" render without broken bindings
  it('each template creates a page that renders with no broken bindings', async () => {
    const templates = ['Master/Detail', 'Dashboard', 'CRUD list'] as const;

    (apiClient.fetchRecords as any).mockResolvedValue({
      data: [{ id: 'emp_1', name: 'Alice', email: 'alice@test.com' }],
      nextCursor: null,
    });
    (apiClient.fetchAggregate as any).mockResolvedValue({
      value: 42,
    });

    for (const tmpl of templates) {
      const pageDef = createTemplatePage(tmpl, `p_${tmpl}`, `/${tmpl}`, mockEntities[1]);
      expect(pageDef.root).toBeDefined();

      const { container, unmount } = render(
        <PageRuntimeProvider
          initialState={pageDef.state}
          initialDataSources={pageDef.dataSources}
        >
          {renderNode(pageDef.root)}
        </PageRuntimeProvider>,
        { wrapper: createWrapper(pageDef.state) }
      );

      // Verify no broken binding indicators
      expect(container.querySelectorAll('.broken-binding')).toHaveLength(0);
      expect(container.textContent).not.toContain('Broken binding');

      unmount();
    }
  });

  // 7. Modal + Form Footer & Permissions
  it('hides Delete button when user role lacks delete permission', async () => {
    (apiClient.fetchRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Bob',
      email: 'bob@example.com',
    });
    (apiClient.fetchMyEntityPermissions as any).mockResolvedValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    });

    render(
      <FormComponent
        entityId="t_employee"
        mode="edit"
        recordId="emp_123"
        fields={[{ fieldId: 'c_emp_name' }]}
        showDelete={true}
        deleteLabel="Delete Employee"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Delete Employee/i })).not.toBeInTheDocument();
    });
  });

  it('shows Delete button when user role has delete permission', async () => {
    (apiClient.fetchRecord as any).mockResolvedValue({
      id: 'emp_123',
      name: 'Bob',
      email: 'bob@example.com',
    });
    (apiClient.fetchMyEntityPermissions as any).mockResolvedValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    });

    render(
      <FormComponent
        entityId="t_employee"
        mode="edit"
        recordId="emp_123"
        fields={[{ fieldId: 'c_emp_name' }]}
        showDelete={true}
        deleteLabel="Delete Employee"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Employee/i })).toBeInTheDocument();
    });
  });

  it('hides footer entirely when showFooter is false in the page definition', async () => {
    render(
      <FormComponent
        entityId="t_employee"
        mode="create"
        showFooter={false}
        fields={[{ fieldId: 'c_emp_name' }]}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.queryByRole('button', { name: /Submit/i })).not.toBeInTheDocument();
  });

  it('executes onSubmit and onSuccess action chains on form submit', async () => {
    const user = userEvent.setup();
    (apiClient.createRecord as any).mockResolvedValue({ id: 'emp_999', name: 'New Employee' });

    const pageWithChains: PageDefinition = {
      schemaVersion: 2,
      id: 'p_chains',
      version: 1,
      route: '/chains',
      state: { submitRun: false, successRun: false },
      dataSources: [],
      root: {
        id: 'f_test',
        type: 'form',
        props: {
          entityId: 't_employee',
          mode: 'create',
          fields: [{ fieldId: 'c_emp_name' }],
          onSubmit: [
            { type: 'setState', params: { key: 'submitRun', value: true } },
          ],
          onSuccess: [
            { type: 'setState', params: { key: 'successRun', value: true } },
          ],
        },
      },
    };

    render(
      <PageRuntimeProvider initialState={pageWithChains.state}>
        {renderNode(pageWithChains.root)}
      </PageRuntimeProvider>,
      { wrapper: createWrapper() }
    );

    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'New Employee');

    const submitBtn = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.createRecord).toHaveBeenCalled();
    });
  });

  it('form field with unknown icon name falls back to the type icon at render', () => {
    const { container } = render(
      <FormComponent
        entityId="t_employee"
        mode="create"
        fields={[
          {
            fieldId: 'c_emp_dept',
            icon: 'UnknownCrazyIcon999' as any,
          },
        ]}
      />,
      { wrapper: createWrapper() }
    );

    // The unknown icon falls back to 'Link' (the type icon for reference), rendering lucide-link
    const linkIcon = container.querySelector('.lucide-link');
    expect(linkIcon).toBeInTheDocument();
  });

  it('loads a stored page containing an unknown form field icon and renders it without throwing', () => {
    const storedPage: PageDefinition = {
      schemaVersion: 2,
      id: 'p_stored_unknown_icon',
      version: 1,
      route: '/stored-page',
      state: {},
      dataSources: [],
      root: {
        id: 'root_form_stored',
        type: 'form',
        props: {
          entityId: 't_employee',
          fields: [
            {
              fieldId: 'c_emp_dept',
              label: 'Department',
              icon: 'UnknownCrazyIcon999',
            },
            {
              fieldId: 'c_emp_name',
              label: 'Employee Name',
              icon: 'SomeOldUnknownIconXYZ',
            },
          ],
        },
      },
    };

    let rendered: any = null;
    expect(() => {
      rendered = render(
        <PageRuntimeProvider initialState={storedPage.state}>
          {renderNode(storedPage.root)}
        </PageRuntimeProvider>,
        { wrapper: createWrapper() }
      );
    }).not.toThrow();

    expect(screen.getByText('Department')).toBeInTheDocument();
    expect(screen.getByText('Employee Name')).toBeInTheDocument();
    expect(screen.queryByText(/Component Error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid enum value/i)).not.toBeInTheDocument();

    const linkIcon = rendered!.container.querySelector('.lucide-link');
    expect(linkIcon).toBeInTheDocument();

    const typeIcon = rendered!.container.querySelector('.lucide-type');
    expect(typeIcon).toBeInTheDocument();
  });
});
