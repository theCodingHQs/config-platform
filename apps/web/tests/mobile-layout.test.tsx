import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import type { ErdTable } from '@config-platform/schema';
import { TableComponent } from '../src/components/table';
import { MetadataProvider } from '../src/context/metadata-context';
import * as apiClient from '../src/api/client';

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
});
