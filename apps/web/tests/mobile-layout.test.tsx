import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import type { ErdTable } from '@config-platform/schema';
import { TableComponent } from '../src/components/table';
import { MetadataProvider } from '../src/context/metadata-context';
import * as apiClient from '../src/api/client';
import { HeaderMobileMenu } from '../src/components/header-mobile-menu';
import { ThemeProvider } from '../src/context/theme-context';
import { AppBarProvider } from '../src/context/app-bar-context';
import { fireEvent } from '@testing-library/react';

const machine: ErdTable = {
  id: 't_machine', name: 'machine', label: 'Machine', physicalTableName: 't', version: 1,
  columns: [
    { id: 'c_name', name: 'name', label: 'Machine Name', physicalColumnName: 'c_name', type: 'text', required: false, unique: false, isPrimary: false, position: 0, isForeignKey: false, config: {} },
    { id: 'c_days', name: 'days', label: 'Days on Target', physicalColumnName: 'c_days', type: 'number', required: false, unique: false, isPrimary: false, position: 1, isForeignKey: false, config: {} },
  ] as any,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Phones and tablets', () => {
  it('table cells carry their column name, so phones can show each row as a labelled card', async () => {
    vi.spyOn(apiClient, 'fetchRecords').mockResolvedValue({ data: [{ id: 'r1', name: 'CNC Mill 01', days: 14 }], nextCursor: null } as any);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MetadataProvider tenantId="t" initialEntities={[machine]}>
          <TableComponent entityId="t_machine" pageSize={10} columns={[{ fieldId: 'c_name' }, { fieldId: 'c_days' }]} />
        </MetadataProvider>
      </QueryClientProvider>,
    );
    const cell = await screen.findByText('CNC Mill 01');
    expect(cell.closest('table')).toHaveClass('responsive-cards');
    const row = cell.closest('tr')!;
    expect(within(row).getAllByRole('cell').map((td) => td.getAttribute('data-label'))).toEqual(['Machine Name', 'Days on Target']);
  });

  it('the stylesheet turns tables into cards and dialogs full-screen on phones, and enlarges touch targets', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 640px) {', css.indexOf('Phones and tablets')));
    expect(phone).toContain('.data-table.responsive-cards td[data-label]::before');
    expect(phone).toContain('content: attr(data-label)');
    expect(phone).toContain('.runtime-modal {');
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 1024px\) \{\s*\.header-studio/);
  });

  it('the phone "⋯" menu holds account details, date preferences, theme and log out', async () => {
    const logout = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider initialTheme="light" initialWorkspaceTheme={{ presetId: 'neutral', overrides: {} }}>
          <AppBarProvider>
            <HeaderMobileMenu email="op@factory.com" role="editor" onLogout={logout} />
          </AppBarProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(menu).toHaveTextContent('op@factory.com · editor');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Dark/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Log out/ }));
    expect(logout).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Date & time preferences/ }));
    expect(screen.getByRole('dialog', { name: 'Date & time preferences' })).toBeInTheDocument();
  });

  it('the stylesheet parses, and the phone rules sit inside the phone media query', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    const root = postcss.parse(css); // throws on syntax errors (an unbalanced brace broke the build once)
    const phoneSelectors: string[] = [];
    root.walkAtRules('media', (rule) => {
      if (rule.params === '(max-width: 640px)') rule.walkRules((r) => { phoneSelectors.push(r.selector); });
    });
    for (const selector of ['.data-table.responsive-cards td[data-label]::before', '.table-container:has(> .data-table.responsive-cards)', '.runtime-modal', '.runtime-modal-body', '.header-desktop-controls', '.layout-stack[data-direction="horizontal"]']) {
      expect(phoneSelectors).toContain(selector);
    }
  });

  it('layouts shrink with the window (no sideways scroll after making it narrower)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    const root = postcss.parse(css);
    let collapsed = '';
    root.walkRules('.layout-grid.responsive-collapse', (rule) => {
      rule.walkDecls('grid-template-columns', (d) => { collapsed = d.value; });
    });
    // A plain 1fr column can't be narrower than its content (e.g. a chart drawn at the old width)
    expect(collapsed).toMatch(/^minmax\(0, 1fr\)/);
  });
});
