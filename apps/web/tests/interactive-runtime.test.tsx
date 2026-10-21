import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDefinition, ActionDefinition } from '@config-platform/schema';
import { PageRuntimeProvider, usePageRuntime } from '../src/context/page-runtime-context';
import { MetadataProvider } from '../src/context/metadata-context';
import { renderNode } from '../src/renderer/render-node';
import { executeActionChain, type ActionExecutionContext } from '../src/renderer/action-runner';
import * as apiClient from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual('../src/api/client');
  return {
    ...actual,
    fetchRecords: vi.fn(),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
  };
});

describe('Part B: Interactive Pages - Runtime & Actions', () => {
  const tenantId = 't_test_interactive';
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Action Runner', () => {
    it('executes actions in exact sequential order', async () => {
      const callOrder: string[] = [];
      const setKey = vi.fn((key, val) => {
        callOrder.push(`setKey:${key}=${val}`);
      });
      const showToast = vi.fn((msg) => {
        callOrder.push(`showToast:${msg}`);
      });
      const navigate = vi.fn((url) => {
        callOrder.push(`navigate:${url}`);
      });

      const context: ActionExecutionContext = {
        tenantId,
        state: { counter: 1 },
        setState: vi.fn(),
        setKey,
        navigate,
        showToast,
        refetchDataSource: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
      };

      const actions: ActionDefinition[] = [
        { type: 'setState', params: { key: 'step1', value: 'done' } },
        { type: 'showToast', params: { message: 'Step 1 complete', variant: 'info' } },
        { type: 'setState', params: { key: 'step2', value: 'finished' } },
        { type: 'navigate', params: { url: '/dashboard' } },
      ];

      const success = await executeActionChain(actions, context, { state: context.state });

      expect(success).toBe(true);
      expect(callOrder).toEqual([
        'setKey:step1=done',
        'showToast:Step 1 complete',
        'setKey:step2=finished',
        'navigate:/dashboard',
      ]);
    });

    it('skips actions when conditional "if" evaluates to falsy and runs subsequent actions', async () => {
      const executed: string[] = [];
      const context: ActionExecutionContext = {
        tenantId,
        state: { userRole: 'user', isActive: true },
        setState: vi.fn(),
        setKey: vi.fn((key) => executed.push(`setKey:${key}`)),
        navigate: vi.fn(),
        showToast: vi.fn((msg) => executed.push(`toast:${msg}`)),
        refetchDataSource: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
      };

      const actions: ActionDefinition[] = [
        {
          type: 'setState',
          if: "{{ state.userRole === 'admin' }}", // Falsy!
          params: { key: 'adminPanel', value: true },
        },
        {
          type: 'showToast',
          if: '{{ state.isActive == true }}', // Truthy!
          params: { message: 'Welcome active user', variant: 'success' },
        },
        {
          type: 'setState',
          if: '{{ state.nonExistent != null }}', // Falsy!
          params: { key: 'skippedKey', value: 123 },
        },
      ];

      const success = await executeActionChain(actions, context, { state: context.state });
      expect(success).toBe(true);
      expect(executed).toEqual(['toast:Welcome active user']);
    });

    it('stops chain on failure and triggers onError action chain if provided', async () => {
      const executed: string[] = [];
      const failingApi = vi.fn().mockRejectedValue(new Error('Network connection dropped'));

      const context: ActionExecutionContext = {
        tenantId,
        state: { count: 1 },
        setState: vi.fn(),
        setKey: vi.fn((key, val) => executed.push(`setKey:${key}=${val}`)),
        navigate: vi.fn(),
        showToast: vi.fn((msg, variant) => executed.push(`toast:${variant}:${msg}`)),
        refetchDataSource: vi.fn(),
        createRecord: failingApi,
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
      };

      const actions: ActionDefinition[] = [
        { type: 'setState', params: { key: 'status', value: 'submitting' } },
        {
          type: 'createRecord',
          params: { entityId: 't_machine', data: { name: 'Test' } },
          onError: [
            { type: 'setState', params: { key: 'status', value: 'failed' } },
            { type: 'showToast', params: { message: 'Failed to create: {{ error.message }}', variant: 'error' } },
          ],
        },
        // This action should NOT run because previous action failed
        { type: 'setState', params: { key: 'status', value: 'completed' } },
      ];

      const success = await executeActionChain(actions, context, { state: context.state });
      expect(success).toBe(false); // Stopped on failure
      expect(executed).toContain('setKey:status=submitting');
      expect(executed).toContain('setKey:status=failed');
      expect(executed).toContain('toast:error:Failed to create: Network connection dropped');
      expect(executed).not.toContain('setKey:status=completed');
    });

    it('stops chain on failure and shows toast when no onError is defined', async () => {
      const showToast = vi.fn();
      const context: ActionExecutionContext = {
        tenantId,
        state: {},
        setState: vi.fn(),
        setKey: vi.fn(),
        navigate: vi.fn(),
        showToast,
        refetchDataSource: vi.fn(),
        createRecord: vi.fn().mockRejectedValue(new Error('Record validation error')),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
      };

      const actions: ActionDefinition[] = [
        { type: 'createRecord', params: { entityId: 't_fail', data: {} } },
        { type: 'navigate', params: { url: '/never-reached' } },
      ];

      const success = await executeActionChain(actions, context, { state: context.state });
      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Record validation error', 'error');
      expect(context.navigate).not.toHaveBeenCalled();
    });
  });

  describe('Node Visibility (visibleIf)', () => {
    it('evaluates visibleIf expression and hides/shows node based on state', async () => {
      const page: PageDefinition = {
        schemaVersion: 2,
        id: 'p_vis',
        version: 1,
        route: '/vis',
        state: { isExpanded: false, count: 5 },
        dataSources: [],
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'text_always',
              type: 'text',
              props: { value: 'Always Visible', variant: 'body' },
            },
            {
              id: 'text_conditional',
              type: 'text',
              visibleIf: '{{ state.isExpanded == true }}',
              props: { value: 'Conditional Content', variant: 'body' },
            },
            {
              id: 'text_count',
              type: 'text',
              visibleIf: '{{ state.count > 10 }}',
              props: { value: 'High Count Message', variant: 'body' },
            },
          ],
        },
      };

      // Helper component to toggle state
      function TestHost() {
        const runtime = usePageRuntime();
        return (
          <div>
            <button
              onClick={() => runtime?.setKey('isExpanded', true)}
              data-testid="expand-btn"
            >
              Expand
            </button>
            <button
              onClick={() => runtime?.setKey('count', 15)}
              data-testid="increase-btn"
            >
              Increase
            </button>
            {renderNode(page.root)}
          </div>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <PageRuntimeProvider tenantId={tenantId} page={page}>
            <TestHost />
          </PageRuntimeProvider>
        </QueryClientProvider>
      );

      // Initially
      expect(screen.getByText('Always Visible')).toBeInTheDocument();
      expect(screen.queryByText('Conditional Content')).not.toBeInTheDocument();
      expect(screen.queryByText('High Count Message')).not.toBeInTheDocument();

      // Click expand
      const user = userEvent.setup();
      await user.click(screen.getByTestId('expand-btn'));

      // Conditional Content now visible!
      expect(screen.getByText('Conditional Content')).toBeInTheDocument();
      expect(screen.queryByText('High Count Message')).not.toBeInTheDocument();

      // Click increase count
      await user.click(screen.getByTestId('increase-btn'));
      expect(screen.getByText('High Count Message')).toBeInTheDocument();
    });
  });

  describe('Data Source Deduplication and Refetch', () => {
    it('deduplicates concurrent fetches for identical data source queries', async () => {
      (apiClient.fetchRecords as any).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ data: [{ id: 'm_1', name: 'Machine 1' }], nextCursor: null });
          }, 20);
        });
      });

      const page: PageDefinition = {
        schemaVersion: 2,
        id: 'p_ds_test',
        version: 1,
        route: '/ds-test',
        state: { statusFilter: 'active' },
        dataSources: [
          {
            id: 'ds_1',
            entityId: 't_machine',
            filter: { status: '{{ state.statusFilter }}' },
            limit: 10,
          },
          {
            id: 'ds_2',
            entityId: 't_machine',
            filter: { status: '{{ state.statusFilter }}' },
            limit: 10,
          },
        ],
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [],
        },
      };

      function Consumer() {
        const runtime = usePageRuntime();
        return (
          <div>
            <div data-testid="ds1-count">{runtime?.dataSources['ds_1']?.data?.length ?? 'none'}</div>
            <div data-testid="ds2-count">{runtime?.dataSources['ds_2']?.data?.length ?? 'none'}</div>
          </div>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <PageRuntimeProvider tenantId={tenantId} page={page}>
            <Consumer />
          </PageRuntimeProvider>
        </QueryClientProvider>
      );

      // Both ds_1 and ds_2 have identical query parameters -> deduplicated to 1 in-flight API call
      expect(apiClient.fetchRecords).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(screen.getByTestId('ds1-count')).toHaveTextContent('1');
        expect(screen.getByTestId('ds2-count')).toHaveTextContent('1');
      });
    });

    it('refetches data source when filter expression input changes or when refetch action runs', async () => {
      (apiClient.fetchRecords as any).mockResolvedValue({
        data: [{ id: 'm_1', name: 'Drill Machine' }],
        nextCursor: null,
      });

      const page: PageDefinition = {
        schemaVersion: 2,
        id: 'p_refetch_test',
        version: 1,
        route: '/refetch-test',
        state: { category: 'drill' },
        dataSources: [
          {
            id: 'ds_items',
            entityId: 't_items',
            limit: 10,
            filter: { category: '{{ state.category }}' },
          },
        ],
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [],
        },
      };

      function Consumer() {
        const runtime = usePageRuntime();
        return (
          <div>
            <button
              onClick={() => runtime?.setKey('category', 'lathe')}
              data-testid="change-category"
            >
              Change Category
            </button>
            <button
              onClick={() => runtime?.runActionChain([{ type: 'refetch', params: { source: 'ds_items' } }])}
              data-testid="refetch-btn"
            >
              Manual Refetch
            </button>
          </div>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <PageRuntimeProvider tenantId={tenantId} page={page}>
            <Consumer />
          </PageRuntimeProvider>
        </QueryClientProvider>
      );

      // Initial call with category = 'drill'
      expect(apiClient.fetchRecords).toHaveBeenCalledWith(
        tenantId,
        't_items',
        expect.objectContaining({ filter: { category: 'drill' } })
      );

      const user = userEvent.setup();

      // Trigger filter expression input change: category -> 'lathe'
      await user.click(screen.getByTestId('change-category'));

      await waitFor(() => {
        expect(apiClient.fetchRecords).toHaveBeenCalledWith(
          tenantId,
          't_items',
          expect.objectContaining({ filter: { category: 'lathe' } })
        );
      });

      const callCountBeforeManual = (apiClient.fetchRecords as any).mock.calls.length;

      // Trigger manual refetch action
      await user.click(screen.getByTestId('refetch-btn'));

      await waitFor(() => {
        expect((apiClient.fetchRecords as any).mock.calls.length).toBeGreaterThan(callCountBeforeManual);
      });
    });

    it('resolves operator filters ({ contains: "{{ state.x }}" }) and drops dynamic values that are empty', async () => {
      (apiClient.fetchRecords as any).mockResolvedValue({ data: [], nextCursor: null });

      const page: PageDefinition = {
        schemaVersion: 2,
        id: 'p_operator_filter',
        version: 1,
        route: '/operator-filter',
        state: { month: '2026-10-01', search: '' },
        dataSources: [
          {
            id: 'ds_sheets',
            entityId: 't_sheets',
            limit: 10,
            filter: { month: '{{ state.month }}', machine_name: { contains: '{{ state.search }}' }, status: 'open' },
          },
        ],
        root: { id: 'root', type: 'stack', props: { direction: 'vertical' }, children: [] },
      };

      function Consumer() {
        const runtime = usePageRuntime();
        return <button data-testid="search" onClick={() => runtime?.setKey('search', 'lathe')}>Search</button>;
      }

      render(
        <QueryClientProvider client={queryClient}>
          <PageRuntimeProvider tenantId={tenantId} page={page}>
            <Consumer />
          </PageRuntimeProvider>
        </QueryClientProvider>
      );

      // An empty search box doesn't filter (the literal "{{ ... }}" was sent before)
      expect(apiClient.fetchRecords).toHaveBeenCalledWith(
        tenantId,
        't_sheets',
        expect.objectContaining({ filter: { month: '2026-10-01', status: 'open' } })
      );

      await userEvent.setup().click(screen.getByTestId('search'));
      await waitFor(() => {
        expect(apiClient.fetchRecords).toHaveBeenCalledWith(
          tenantId,
          't_sheets',
          expect.objectContaining({ filter: { month: '2026-10-01', machine_name: { contains: 'lathe' }, status: 'open' } })
        );
      });
    });

    it('opens and closes a modal via button click actions on a rendered page', async () => {
      const page: PageDefinition = {
        id: 'p_modal_test',
        schemaVersion: 2,
        version: 1,
        route: '/modal-test',
        state: { createModalOpen: false },
        dataSources: [],
        root: {
          id: 'root',
          type: 'stack',
          props: { direction: 'vertical' },
          children: [
            {
              id: 'open_btn',
              type: 'button',
              props: {
                label: 'Open Modal',
                onClick: [
                  {
                    type: 'openModal',
                    params: { modalKey: 'createModalOpen' },
                  },
                ],
              },
            },
            {
              id: 'my_modal',
              type: 'modal',
              props: {
                title: 'Create Item',
                openStateKey: 'createModalOpen',
              },
              children: [
                {
                  id: 'modal_body_text',
                  type: 'text',
                  props: { value: 'Modal Content Here' },
                },
              ],
            },
          ],
        },
      };

      const user = userEvent.setup();

      render(
        <QueryClientProvider client={queryClient}>
          <PageRuntimeProvider tenantId={tenantId} page={page}>
            <div>{renderNode(page.root)}</div>
          </PageRuntimeProvider>
        </QueryClientProvider>
      );

      // Initially modal is closed
      expect(screen.queryByTestId('modal-container')).not.toBeInTheDocument();

      // Click button to open modal
      await user.click(screen.getByRole('button', { name: 'Open Modal' }));

      // Modal is now open
      await waitFor(() => {
        expect(screen.getByTestId('modal-container')).toBeInTheDocument();
      });
      expect(screen.getByText('Create Item')).toBeInTheDocument();
      expect(screen.getByText('Modal Content Here')).toBeInTheDocument();

      // Click close button
      await user.click(screen.getByRole('button', { name: /close modal/i }));

      // Modal is closed
      await waitFor(() => {
        expect(screen.queryByTestId('modal-container')).not.toBeInTheDocument();
      });
    });

    it('executes exportCsv action and triggers file download and toast', async () => {
      vi.mocked(apiClient.fetchRecords).mockResolvedValueOnce({
        data: [
          { id: '1', name: 'Turbine Alpha', speed: 1200 },
          { id: '2', name: 'Boiler Beta', speed: 850 },
        ],
        nextCursor: null,
      });

      const showToast = vi.fn();
      const context: ActionExecutionContext = {
        tenantId,
        state: {},
        setState: vi.fn(),
        setKey: vi.fn(),
        navigate: vi.fn(),
        showToast,
        refetchDataSource: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
      };

      const action: ActionDefinition = {
        type: 'exportCsv',
        params: {
          entityId: 't_machine',
          filename: 'test_telemetry.csv',
        },
      };

      const result = await executeActionChain([action], context, { state: {}, ds: {} });
      expect(result).toBe(true);
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Exported 2 records to test_telemetry.csv'),
        'success'
      );
    });

    it('handles confirm and toast flow for sensor calibration', async () => {
      const showToast = vi.fn();
      const refetchDataSource = vi.fn();
      const requestConfirm = vi.fn().mockResolvedValue(true);

      const context: ActionExecutionContext = {
        tenantId,
        state: {},
        setState: vi.fn(),
        setKey: vi.fn(),
        navigate: vi.fn(),
        showToast,
        refetchDataSource,
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
        requestConfirm,
      };

      const actions: ActionDefinition[] = [
        {
          type: 'confirm',
          params: {
            title: 'Calibrate All Sensors',
            message: 'Initiate automated calibration sequence?',
          },
        },
        {
          type: 'showToast',
          params: {
            message: 'All sensors calibrated successfully.',
            variant: 'success',
          },
        },
        {
          type: 'refetch',
        },
      ];

      const result = await executeActionChain(actions, context, { state: {}, ds: {} });
      expect(result).toBe(true);
      expect(requestConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Calibrate All Sensors' })
      );
      expect(showToast).toHaveBeenCalledWith(
        'All sensors calibrated successfully.',
        'success'
      );
      expect(refetchDataSource).toHaveBeenCalled();
    });
  });
});
