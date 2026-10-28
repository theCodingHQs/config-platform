import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AppBarProvider } from '../src/context/app-bar-context';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PageBuilder } from '../src/studio/PageBuilder';
import { MetadataProvider } from '../src/context/metadata-context';
import * as apiClient from '../src/api/client';

/** A server that refuses a save made against an outdated version, like the real one */
function fakeServer() {
  const page: any = {
    id: 'p_v',
    name: 'Versions',
    route: '/versions',
    version: 1,
    hasDraft: true,
    hasPublished: false,
    brokenBindings: [],
    draft: { schemaVersion: 2, id: 'p_v', version: 1, route: '/versions', root: { id: 'root', type: 'stack', props: { direction: 'vertical' }, children: [] } },
    published: null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
  };
  const saves: number[] = [];
  vi.spyOn(apiClient, 'fetchPage').mockImplementation(async () => structuredClone(page));
  vi.spyOn(apiClient, 'updatePage').mockImplementation(async (_t: string, _id: string, input: any) => {
    saves.push(input.expectedVersion);
    if (input.expectedVersion !== page.version) throw new apiClient.ApiError(409, `Version conflict: expected ${input.expectedVersion}, found ${page.version}`);
    page.version += 1;
    page.draft = input.draft;
    return structuredClone(page);
  });
  return { page, saves };
}

describe('page builder versions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'listExportTemplates').mockResolvedValue([]);
  });

  it('opening a page again starts from its current version, not a copy kept from before', async () => {
    const server = fakeServer();
    // One query cache for the whole session, as in the app
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const open = () =>
      render(
        <QueryClientProvider client={queryClient}>
        <AppBarProvider>
          <MetadataProvider tenantId="t" initialEntities={[]}>
            <MemoryRouter initialEntries={['/studio/pages/p_v']}>
              <Routes>
                <Route path="/studio/pages/:id" element={<PageBuilder />} />
              </Routes>
            </MemoryRouter>
          </MetadataProvider>
        </AppBarProvider>
      </QueryClientProvider>,
      );
    const user = userEvent.setup();
    const editAndSave = async () => {
      await user.click(await screen.findByRole('button', { name: /\+ Text/i }));
      await user.click(screen.getByRole('button', { name: /Save Draft/i }));
      await waitFor(() => expect(screen.queryByText(/Draft saved|Not saved|Save error/)).toBeInTheDocument());
    };

    open();
    await editAndSave();
    expect(server.saves).toEqual([1]);
    cleanup();

    // Saved elsewhere while the builder was closed
    server.page.version = 3;
    open();
    await editAndSave();
    expect(server.saves.at(-1)).toBe(3);
    expect(screen.queryByText(/Not saved|Save error/)).not.toBeInTheDocument();
  });
});
