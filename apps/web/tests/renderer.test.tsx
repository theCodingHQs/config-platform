import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';

import { renderNode } from '../src/renderer/render-node';
import { defaultRegistry, ComponentRegistry } from '../src/renderer/registry';
import { MetadataProvider } from '../src/context/metadata-context';
import { ApiError } from '../src/api/client';
import * as apiClient from '../src/api/client';
import type { NodeDefinition, ErdTable } from '@config-platform/schema';

// Mock metadata for tests
const mockEntities: ErdTable[] = [
  {
    id: 't_machine',
    name: 'machine',
    label: 'Machine',
    physicalTableName: 't_machine',
    version: 2,
    columns: [
      {
        id: 'c_name',
        name: 'new_machine_name', // renamed in catalog!
        label: 'Renamed Machine Name',
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
        id: 'c_speed',
        name: 'speed',
        label: 'Speed (RPM)',
        physicalColumnName: 'c_speed',
        type: 'number',
        required: false,
        unique: false,
        isPrimary: false,
        position: 1,
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
        position: 2,
        isForeignKey: false,
        config: {
          options: [
            { label: 'Operational', value: 'operational' },
            { label: 'Idle', value: 'idle' },
          ],
        },
      },
      {
        id: 'c_active',
        name: 'is_active',
        label: 'Is Active',
        physicalColumnName: 'c_active',
        type: 'boolean',
        required: false,
        unique: false,
        isPrimary: false,
        position: 3,
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

describe('Renderer & Component System', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Registry resolves types
  it('registry resolves types and supports dynamic component registration', () => {
    expect(defaultRegistry.has('stack')).toBe(true);
    expect(defaultRegistry.has('text')).toBe(true);
    expect(defaultRegistry.has('button')).toBe(true);
    expect(defaultRegistry.has('table')).toBe(true);
    expect(defaultRegistry.has('form')).toBe(true);

    // Register a custom component on an isolated registry
    const customRegistry = new ComponentRegistry();
    customRegistry.register('custom_alert', {
      component: ({ message }: { message: string }) => <div data-testid="alert">{message}</div>,
      propsSchema: z.object({ message: z.string() }),
    });

    const node: NodeDefinition = {
      id: 'alert_1',
      type: 'custom_alert' as any,
      props: { message: 'System Update Available' },
    };

    render(renderNode(node, { registry: customRegistry }) as React.ReactElement);
    expect(screen.getByTestId('alert')).toHaveTextContent('System Update Available');
  });

  // 2. Invalid props show placeholder
  it('renders an error placeholder when node props violate propsSchema', () => {
    // text component with invalid variant
    const node: NodeDefinition = {
      id: 'bad_text',
      type: 'text',
      props: {
        value: 'Hello',
        variant: 'non_existent_variant',
      },
    };

    render(renderNode(node) as React.ReactElement);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid props for <text>');
  });

  // 3. Deleted/unknown fieldId shows broken-binding, not a crash
  it('renders inline broken binding placeholder for unknown fieldId or entityId without crashing', () => {
    const tableWithBrokenBindings: NodeDefinition = {
      id: 'table_broken',
      type: 'table',
      props: {
        entityId: 't_machine',
        columns: [
          { fieldId: 'c_speed' },
          { fieldId: 'c_deleted_field_404' },
        ],
      },
    };

    vi.spyOn(apiClient, 'fetchRecords').mockResolvedValue({
      data: [{ id: '1', speed: 100 }],
      nextCursor: null,
    });

    render(renderNode(tableWithBrokenBindings) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    // Valid field header rendered
    expect(screen.getByText('Speed (RPM)')).toBeInTheDocument();
    // Missing field rendered inline placeholder
    expect(screen.getByText('[Broken field: c_deleted_field_404]')).toBeInTheDocument();
  });

  it('renders inline broken binding placeholder for unknown entityId without crashing', () => {
    const tableWithMissingEntity: NodeDefinition = {
      id: 'table_missing_entity',
      type: 'table',
      props: {
        entityId: 't_missing_entity_999',
        columns: [{ fieldId: 'c_speed' }],
      },
    };

    render(renderNode(tableWithMissingEntity) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    expect(screen.getByText('[Broken entity: t_missing_entity_999]')).toBeInTheDocument();
  });

  // 4. Field rename in catalog does not break a page
  it('adapts seamlessly to field renames in catalog because pages bind via stable fieldId', async () => {
    // Page binds to stable ID 'c_name', but the catalog field was renamed to 'new_machine_name'
    const tableNode: NodeDefinition = {
      id: 'table_rename',
      type: 'table',
      props: {
        entityId: 't_machine',
        columns: [{ fieldId: 'c_name' }],
      },
    };

    vi.spyOn(apiClient, 'fetchRecords').mockResolvedValue({
      data: [{ id: '1', new_machine_name: 'Laser Cutter 9000' }],
      nextCursor: null,
    });

    render(renderNode(tableNode) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    // Header reflects the new renamed label
    expect(screen.getByText('Renamed Machine Name')).toBeInTheDocument();

    // Row value displays correctly using the renamed slug under the hood
    await waitFor(() => {
      expect(screen.getByText('Laser Cutter 9000')).toBeInTheDocument();
    });
  });

  // 5. Table renders and paginates
  it('renders records with type-specific badges and handles cursor pagination', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'fetchRecords');

    // Page 1 response
    fetchSpy.mockResolvedValueOnce({
      data: [
        { id: 'm1', new_machine_name: 'Press A', speed: 200, status: 'operational', is_active: true },
      ],
      nextCursor: 'cursor_page_2',
    });

    // Page 2 response
    fetchSpy.mockResolvedValueOnce({
      data: [
        { id: 'm2', new_machine_name: 'Press B', speed: 0, status: 'idle', is_active: false },
      ],
      nextCursor: null,
    });

    const tableNode: NodeDefinition = {
      id: 'table_paginated',
      type: 'table',
      props: {
        entityId: 't_machine',
        columns: [
          { fieldId: 'c_name' },
          { fieldId: 'c_speed' },
          { fieldId: 'c_status' },
          { fieldId: 'c_active' },
        ],
        pageSize: 1,
      },
    };

    const user = userEvent.setup();
    render(renderNode(tableNode) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    // Verify Page 1
    await waitFor(() => {
      expect(screen.getByText('Press A')).toBeInTheDocument();
      expect(screen.getByText('Operational')).toBeInTheDocument();
      expect(screen.getByText('Yes')).toBeInTheDocument(); // boolean badge
    });

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeEnabled();

    // Click Next to fetch Page 2
    await user.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Press B')).toBeInTheDocument();
      expect(screen.getByText('Idle')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });
  });

  // 6. Form shows API 422 errors per field
  it('generates inputs by field type and renders per-field 422 errors returned by API', async () => {
    const createSpy = vi.spyOn(apiClient, 'createRecord');
    createSpy.mockRejectedValueOnce(
      new ApiError(422, 'Record validation failed', {
        new_machine_name: 'Machine name is required',
        speed: 'Speed must be at least 0',
      })
    );

    const formNode: NodeDefinition = {
      id: 'machine_form',
      type: 'form',
      props: {
        entityId: 't_machine',
        fields: [
          { fieldId: 'c_name' },
          { fieldId: 'c_speed' },
          { fieldId: 'c_status' },
        ],
        mode: 'create',
      },
    };

    const user = userEvent.setup();
    render(renderNode(formNode) as React.ReactElement, {
      wrapper: createTestWrapper(),
    });

    // Inputs rendered according to field type
    expect(screen.getByLabelText(/Renamed Machine Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Speed \(RPM\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();

    // Submit form empty to trigger 422 error
    const submitBtn = screen.getByRole('button', { name: /Submit/i });
    await user.click(submitBtn);

    // Per-field errors should appear below the inputs
    await waitFor(() => {
      expect(screen.getByText('Machine name is required')).toBeInTheDocument();
      expect(screen.getByText('Speed must be at least 0')).toBeInTheDocument();
    });
  });

  // 7. Error boundary isolates a throwing component
  it('isolates a throwing component with NodeErrorBoundary so sibling components render normally', () => {
    const errorRegistry = new ComponentRegistry();

    // Register a deliberately throwing component
    const ThrowingComponent: React.FC = () => {
      throw new Error('Explosive component error!');
    };

    errorRegistry.register('broken_comp', {
      component: ThrowingComponent,
      propsSchema: z.record(z.any()),
    });

    errorRegistry.register('safe_text', {
      component: ({ value }: { value: string }) => <div data-testid="safe">{value}</div>,
      propsSchema: z.object({ value: z.string() }),
    });

    errorRegistry.register('stack', {
      component: ({ children }: any) => <div>{children}</div>,
      propsSchema: z.record(z.any()),
    });

    const rootNode: NodeDefinition = {
      id: 'root',
      type: 'stack' as any,
      props: {},
      children: [
        {
          id: 'safe_node',
          type: 'safe_text' as any,
          props: { value: 'Safe Header Unaffected' },
        },
        {
          id: 'boom_node',
          type: 'broken_comp' as any,
          props: {},
        },
      ],
    };

    // Suppress console.error in test output for caught error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(renderNode(rootNode, { registry: errorRegistry }) as React.ReactElement);

    // Sibling safe component rendered normally!
    expect(screen.getByTestId('safe')).toHaveTextContent('Safe Header Unaffected');

    // Throwing component isolated inside error boundary!
    expect(screen.getByRole('alert')).toHaveTextContent('Component Error: <broken_comp> (id: boom_node)');
    expect(screen.getByRole('alert')).toHaveTextContent('Explosive component error!');

    consoleSpy.mockRestore();
  });

  it('renders stack component with wrap support', () => {
    const stackNode: NodeDefinition = {
      id: 'stack-wrap-test',
      type: 'stack',
      props: {
        direction: 'horizontal',
        gap: 20,
        wrap: true,
      },
      children: [
        {
          id: 'child-1',
          type: 'text',
          props: { value: 'Item 1' },
        },
        {
          id: 'child-2',
          type: 'text',
          props: { value: 'Item 2' },
        },
      ],
    };

    render(renderNode(stackNode) as React.ReactElement);

    const stackEl = screen.getByTestId('layout-stack');
    expect(stackEl).toBeInTheDocument();
    expect(stackEl).toHaveClass('layout-stack');
    expect(stackEl.style.flexDirection).toBe('row');
    expect(stackEl.style.flexWrap).toBe('wrap');
    expect(stackEl.style.gap).toBe('20px');
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });
});
