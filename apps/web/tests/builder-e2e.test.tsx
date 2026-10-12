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
    id: 't_machine',
    name: 'machine',
    label: 'Machine',
    physicalTableName: 't_machine',
    version: 1,
    columns: [
      {
        id: 'c_name',
        name: 'name',
        label: 'Machine Name',
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
        id: 'c_status',
        name: 'status',
        label: 'Status',
        physicalColumnName: 'c_status',
        type: 'select',
        required: false,
        unique: false,
        isPrimary: false,
        position: 1,
        isForeignKey: false,
        config: {
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Idle', value: 'idle' },
          ],
        },
      },
    ],
  },
];

describe('End-to-End: Master/Detail Page via Builder UI Operations', () => {
  const tenantId = 't_test_e2e';
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it(
    'builds a full master/detail page with state, data source, table with onRowClick, and details with visibleIf using only builder operations',
    async () => {
    const user = userEvent.setup();

    const initialDraft: PageDefinition = {
      schemaVersion: 2,
      id: 'p_master_detail',
      version: 1,
      route: '/machines-monitor',
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
      id: 'p_master_detail',
      name: 'Machines Master Detail',
      route: '/machines-monitor',
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
      data: [{ id: 'm_101', name: 'CNC Lathe', status: 'active' }],
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
          <MemoryRouter initialEntries={['/studio/pages/p_master_detail']}>
            <Routes>
              <Route path="/studio/pages/:id" element={<PageBuilder />} />
            </Routes>
          </MemoryRouter>
        </MetadataProvider>
      </QueryClientProvider>
    );

    // 1. Verify Page Builder loads
    await waitFor(() => {
      expect(screen.getByText('Machines Master Detail')).toBeInTheDocument();
    });

    // 2. Open State Editor modal and add state variable `selectedMachineId`
    const stateBtn = screen.getByRole('button', { name: /State \(/i });
    await user.click(stateBtn);

    expect(screen.getByText('Page State Editor')).toBeInTheDocument();
    const addVarBtn = screen.getByRole('button', { name: /Add Variable/i });
    await user.click(addVarBtn);

    const keyInputs = screen.getAllByPlaceholderText(/Key \(e\.g\. selectedId\)/i);
    await user.type(keyInputs[keyInputs.length - 1], 'selectedMachineId');

    const saveStateBtn = screen.getByRole('button', { name: /Save State/i });
    await user.click(saveStateBtn);

    // 3. Open Data Sources modal and add data source `ds_machines`
    const dsBtn = screen.getByRole('button', { name: /Data Sources \(/i });
    await user.click(dsBtn);

    expect(screen.getByText('Configure named data sources that fetch records and refetch when filter expressions change.')).toBeInTheDocument();
    const addDsBtn = screen.getByRole('button', { name: /Add Data Source/i });
    await user.click(addDsBtn);

    const dsIdInput = screen.getByLabelText(/Data Source 1 ID/i);
    await user.clear(dsIdInput);
    await user.type(dsIdInput, 'ds_machines');

    const dsEntitySelect = screen.getByLabelText(/Data Source 1 Entity/i);
    await user.selectOptions(dsEntitySelect, 't_machine');

    const saveDsBtn = screen.getByRole('button', { name: /Save Data Sources/i });
    await user.click(saveDsBtn);

    // 4. Add Table Component from Palette
    const addTableBtn = screen.getByRole('button', { name: /\+ table/i });
    await user.click(addTableBtn);

    // Verify Table properties panel appears
    await waitFor(() => {
      expect(screen.getByLabelText(/Table Data Source/i)).toBeInTheDocument();
    });

    // Select Data Source ds_machines for Table
    const tableSourceSelect = screen.getByLabelText(/Table Data Source/i);
    await user.selectOptions(tableSourceSelect, 'ds_machines');

    // Pick columns for Table
    const nameColCheckbox = screen.getByRole('checkbox', { name: /Machine Name/i });
    if (!nameColCheckbox.hasAttribute('checked')) {
      await user.click(nameColCheckbox);
    }

    // Configure onRowClick action on Table: Set State selectedMachineId = {{ row.id }}
    const addActionBtn = screen.getByRole('button', { name: /Add Action/i });
    await user.click(addActionBtn);

    const stateKeyInput = screen.getByLabelText(/State Key/i);
    await user.clear(stateKeyInput);
    await user.type(stateKeyInput, 'selectedMachineId');

    const valInput = screen.getByPlaceholderText(/e\.g\. \{\{ row\.id \}\}/i);
    fireEvent.change(valInput, { target: { value: '{{ row.id }}' } });

    // 5. Add Details Component from Palette
    const addDetailsBtn = screen.getByRole('button', { name: /\+ details/i });
    await user.click(addDetailsBtn);

    // Verify Details properties panel appears
    await waitFor(() => {
      expect(screen.getByText('Record Details')).toBeInTheDocument();
    });

    // Configure Record ID and Visible If expression for Details
    const recordIdInput = screen.getByPlaceholderText(/e\.g\. \{\{ state\.selectedId \}\}/i);
    fireEvent.change(recordIdInput, { target: { value: '{{ state.selectedMachineId }}' } });

    const visibleIfInput = screen.getByPlaceholderText(/e\.g\. \{\{ state\.showExtra == true \}\}/i);
    fireEvent.change(visibleIfInput, { target: { value: '{{ state.selectedMachineId != null }}' } });

    // 6. Save Draft
    const saveDraftBtn = screen.getByRole('button', { name: /Save Draft/i });
    await user.click(saveDraftBtn);

    await waitFor(() => {
      expect(apiClient.updatePage).toHaveBeenCalled();
    });

    // 7. Verify the saved draft definition structure
    expect(savedDraft).not.toBeNull();
    const draftDef = savedDraft as unknown as PageDefinition;

    expect(draftDef.schemaVersion).toBe(2);
    expect(draftDef.state).toEqual(expect.objectContaining({ selectedMachineId: '' }));
    expect(draftDef.dataSources).toHaveLength(1);
    expect(draftDef.dataSources[0].id).toBe('ds_machines');
    expect(draftDef.dataSources[0].entityId).toBe('t_machine');

    // Verify table node
    const tableNode = draftDef.root.children?.find((c) => c.type === 'table');
    expect(tableNode).toBeDefined();
    expect(tableNode?.props?.source).toBe('ds_machines');
    expect(tableNode?.props?.onRowClick).toHaveLength(1);
    expect(tableNode?.props?.onRowClick[0].type).toBe('setState');
    expect(tableNode?.props?.onRowClick[0].params.key).toBe('selectedMachineId');
    expect(tableNode?.props?.onRowClick[0].params.value).toBe('{{ row.id }}');

    // Verify details node
    const detailsNode = draftDef.root.children?.find((c) => c.type === 'details');
    expect(detailsNode).toBeDefined();
    expect(detailsNode?.visibleIf).toBe('{{ state.selectedMachineId != null }}');
    expect(detailsNode?.props?.recordId).toBe('{{ state.selectedMachineId }}');

    // 8. Publish Page
    const publishBtn = screen.getByRole('button', { name: /^Publish$/i });
    await user.click(publishBtn);

    await waitFor(() => {
      expect(apiClient.publishPage).toHaveBeenCalledWith(tenantId, 'p_master_detail');
    });
  }, 60000);
});
