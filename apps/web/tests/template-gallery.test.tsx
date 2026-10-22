import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TemplateGallery } from '../src/studio/TemplateGallery';
import { AppBarProvider } from '../src/context/app-bar-context';
import * as apiClient from '../src/api/client';

const cards: apiClient.SolutionTemplateCard[] = [
  { id: 'maintenance-log', name: 'Maintenance & Breakdown Log', summary: 'Breakdowns per machine.', description: 'Log every breakdown.', icon: 'Wrench', folder: 'Maintenance', entities: ['Machine', 'Maintenance Job'], pages: ['Maintenance Jobs'], reports: ['Maintenance report'], hasSampleData: true },
  { id: 'shift-handover', name: 'Shift Handover', summary: 'One record per shift.', description: 'Output vs target.', icon: 'ArrowRightLeft', folder: 'Shifts', entities: ['Shift Handover'], pages: ['Shift Handovers'], reports: ['Shift report'], hasSampleData: true },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGallery(onInstalled = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppBarProvider>
        <TemplateGallery tenantId="t" onClose={() => {}} onInstalled={onInstalled} />
      </AppBarProvider>
    </QueryClientProvider>,
  );
  return onInstalled;
}

describe('Template gallery', () => {
  it('shows what a template adds and installs it with or without sample data', async () => {
    vi.spyOn(apiClient, 'listSolutionTemplates').mockResolvedValue(cards);
    const install = vi.spyOn(apiClient, 'installSolutionTemplate').mockResolvedValue({
      templateId: 'maintenance-log',
      entities: [{ id: 'e1', label: 'Machine', reused: true }, { id: 'e2', label: 'Maintenance Job', reused: false }],
      pages: [{ id: 'p1', name: 'Maintenance Jobs', route: '/maintenance/jobs' }],
      reports: [{ id: 'r1', name: 'Maintenance report' }],
      sampleRecords: 5,
      warnings: [],
    });
    const onInstalled = renderGallery();

    expect(screen.getByRole('button', { name: 'Choose a template' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('radio', { name: /Maintenance & Breakdown Log/ }));
    expect(screen.getByText(/Data: Machine, Maintenance Job/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Add sample data/));
    fireEvent.click(screen.getByRole('button', { name: 'Install Maintenance & Breakdown Log' }));

    await waitFor(() => expect(install).toHaveBeenCalledWith('maintenance-log', false));
    expect(await screen.findByText(/Machine \(your existing one\)/)).toBeInTheDocument();
    expect(screen.getByText(/in the sidebar under Maintenance/)).toBeInTheDocument();
    expect(onInstalled).toHaveBeenCalled();
  });

  it('shows why a template could not be installed', async () => {
    vi.spyOn(apiClient, 'listSolutionTemplates').mockResolvedValue(cards);
    vi.spyOn(apiClient, 'installSolutionTemplate').mockRejectedValue(new Error('Shift Handover is already installed'));
    renderGallery();
    fireEvent.click(await screen.findByRole('radio', { name: /Shift Handover/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Install Shift Handover' }));
    await waitFor(() => expect(screen.getByTestId('app-status-notification')).toHaveTextContent('already installed'));
  });
});
