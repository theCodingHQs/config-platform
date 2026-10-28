import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ErdTable } from '@config-platform/schema';
import { PermissionsManager } from '../src/studio/PermissionsManager';
import { MetadataProvider } from '../src/context/metadata-context';
import * as apiClient from '../src/api/client';

const sheets: ErdTable = {
  id: 't_sheet',
  name: 'production_sheet',
  label: 'Production Sheet',
  physicalTableName: 't_sheet',
  version: 1,
  columns: [
    { id: 'c_machine', name: 'machine', label: 'Machine', physicalColumnName: 'c_machine', type: 'reference', required: false, unique: false, isPrimary: false, position: 0, isForeignKey: true, config: {} },
  ] as any,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderScreen() {
  vi.spyOn(apiClient, 'fetchSchemaEntities').mockResolvedValue([sheets]);
  vi.spyOn(apiClient, 'fetchFieldPermissions').mockResolvedValue([]);
  vi.spyOn(apiClient, 'listMembers').mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MetadataProvider tenantId="t" initialEntities={[sheets]}>
        <MemoryRouter><PermissionsManager /></MemoryRouter>
      </MetadataProvider>
    </QueryClientProvider>,
  );
}

describe('Permissions screen', () => {
  it('uses plain-language labels', async () => {
    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('Record access: Production Sheet')).toBeInTheDocument();
    for (const label of ['View', 'Add', 'Edit', 'Delete', 'Export']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText(/CRUD|GET|POST|PATCH/)).toBeNull();
    expect(screen.getByText('Field access: Production Sheet')).toBeInTheDocument();
    // Field types are named as in Data Entities
    expect(screen.getByText('Link')).toBeInTheDocument();
  });

  it('changing one action keeps the others, including Export (it used to switch back on)', async () => {
    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([
      { role: 'editor', canRead: true, canCreate: true, canUpdate: true, canDelete: false, canExport: false },
    ] as any);
    const save = vi.spyOn(apiClient, 'setEntityPermission').mockResolvedValue(undefined as any);
    renderScreen();

    const editorView = await screen.findByRole('checkbox', { name: 'editor: View' });
    await waitFor(() => expect(editorView).toBeChecked());
    fireEvent.click(editorView);

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith('t_sheet', 'editor', {
      canRead: false, canCreate: true, canUpdate: true, canDelete: false, canExport: false,
    });
  });

  it('a role without saved permissions keeps the default Export when another action changes', async () => {
    vi.spyOn(apiClient, 'fetchEntityPermissions').mockResolvedValue([]);
    const save = vi.spyOn(apiClient, 'setEntityPermission').mockResolvedValue(undefined as any);
    renderScreen();

    const builderDelete = await screen.findByRole('checkbox', { name: 'builder: Delete' });
    expect(screen.getByRole('checkbox', { name: 'builder: Export' })).toBeChecked();
    fireEvent.click(builderDelete);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][2]).toMatchObject({ canExport: true });
    // Viewers default to no export
    expect(screen.getByRole('checkbox', { name: 'viewer: Export' })).not.toBeChecked();
  });
});
