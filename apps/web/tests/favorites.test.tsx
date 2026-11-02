import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppBarProvider } from '../src/context/app-bar-context';
import { SidebarFavorites } from '../src/favorites/SidebarFavorites';
import { favoritesApi, sameFavorite, type Favorite } from '../src/favorites/favorites-api';

vi.mock('../src/favorites/favorites-api', async () => {
  const actual = await vi.importActual<typeof import('../src/favorites/favorites-api')>('../src/favorites/favorites-api');
  return { ...actual, favoritesApi: { list: vi.fn(), add: vi.fn(), rename: vi.fn(), remove: vi.fn() } };
});

vi.mock('../src/context/auth-context', async () => {
  const actual = await vi.importActual<typeof import('../src/context/auth-context')>('../src/context/auth-context');
  return { ...actual, useOptionalAuth: () => ({ tenantId: 't1', role: 'viewer' }) };
});

const saved: Favorite[] = [
  { id: 'fav_1', pageId: 'p_detail', params: { machine: 'M12' }, label: null },
  { id: 'fav_2', pageId: 'p_gone', params: {}, label: null },
];
const resolve = (pageId: string) => (pageId === 'p_detail' ? { route: '/machine-detail', name: 'Machine Detail', icon: null } : undefined);

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppBarProvider>
          <SidebarFavorites resolve={resolve} onNavigate={() => {}} />
        </AppBarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Favorites', () => {
  beforeEach(() => {
    vi.mocked(favoritesApi.list).mockResolvedValue(saved);
    vi.mocked(favoritesApi.remove).mockResolvedValue();
    vi.mocked(favoritesApi.rename).mockResolvedValue({ ...saved[0], label: 'Press 12' });
  });

  it('lists a favorite as the page name and its values, opening the page with those values; hides one whose page is gone', async () => {
    renderSidebar();
    const link = await screen.findByRole('link', { name: /Machine Detail · M12/ });
    expect(link).toHaveAttribute('href', '/machine-detail?machine=M12');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('removes one, and renames one by double-click', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.dblClick(await screen.findByRole('link', { name: /Machine Detail · M12/ }));
    const input = await screen.findByLabelText('Favorite name');
    await user.clear(input);
    await user.type(input, 'Press 12{Enter}');
    await waitFor(() => expect(favoritesApi.rename).toHaveBeenCalledWith('fav_1', 'Press 12'));

    await user.click(await screen.findByRole('button', { name: /Remove .* from favorites/ }));
    await waitFor(() => expect(favoritesApi.remove).toHaveBeenCalled());
    expect(vi.mocked(favoritesApi.remove).mock.calls[0][0]).toBe('fav_1');
  });

  it('treats the same page with other values as a different favorite', () => {
    expect(sameFavorite({ pageId: 'p', params: { a: '1' } }, { pageId: 'p', params: { a: '1' } })).toBe(true);
    expect(sameFavorite({ pageId: 'p', params: { a: '1' } }, { pageId: 'p', params: { a: '2' } })).toBe(false);
    expect(sameFavorite({ pageId: 'p', params: {} }, { pageId: 'p', params: { a: '1' } })).toBe(false);
  });
});
