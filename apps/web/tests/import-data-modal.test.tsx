import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportDataModal } from '../src/studio/ImportDataModal';
import * as apiClient from '../src/api/client';
import type { ErdTable, ImportPreviewResult, ImportDryRunResult, ImportCommitResult } from '@config-platform/schema';

const mockEntity: ErdTable = {
  id: 'ent_product_1',
  name: 'product',
  label: 'Product',
  physicalTableName: 'tbl_product_1',
  version: 1,
  columns: [
    {
      id: 'f_sku',
      name: 'sku',
      label: 'SKU',
      physicalColumnName: 'c_sku',
      type: 'text',
      required: true,
      unique: true,
      isPrimary: false,
      position: 0,
      isForeignKey: false,
      config: {},
    },
    {
      id: 'f_title',
      name: 'title',
      label: 'Title',
      physicalColumnName: 'c_title',
      type: 'text',
      required: true,
      unique: false,
      isPrimary: false,
      position: 1,
      isForeignKey: false,
      config: {},
    },
    {
      id: 'f_price',
      name: 'price',
      label: 'Price',
      physicalColumnName: 'c_price',
      type: 'number',
      required: false,
      unique: false,
      isPrimary: false,
      position: 2,
      isForeignKey: false,
      config: {},
    },
  ],
};

describe('ImportDataModal', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal with entity header and wizard step indicator', () => {
    render(
      <ImportDataModal
        isOpen={true}
        onClose={onClose}
        entity={mockEntity}
        onSuccess={onSuccess}
      />
    );

    expect(screen.getByText('Import Data into Product')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Mapping & Options')).toBeInTheDocument();
    expect(screen.getByText('Dry Run')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('handles file preview and auto-matches columns', async () => {
    const mockPreview: ImportPreviewResult = {
      sheets: ['ProductsSheet', 'Archive'],
      selectedSheet: 'ProductsSheet',
      detectedColumns: ['SKU', 'Title', 'Price', 'Extra'],
      sampleRows: [
        { SKU: 'SKU-001', Title: 'Widget A', Price: '25.50', Extra: 'test' },
      ],
      totalRowsEstimated: 12,
      suggestedMapping: {
        SKU: 'f_sku',
        Title: 'f_title',
        Price: 'f_price',
        Extra: '__ignore__',
      },
      unmappedRequiredFieldIds: [],
    };

    const previewSpy = vi
      .spyOn(apiClient, 'previewEntityImport')
      .mockResolvedValue(mockPreview);

    render(
      <ImportDataModal
        isOpen={true}
        onClose={onClose}
        entity={mockEntity}
        onSuccess={onSuccess}
      />
    );

    const file = new File(['SKU,Title,Price\nSKU-1,Prod,10\n'], 'products.csv', {
      type: 'text/csv',
    });

    const fileInput = document.getElementById('entity-import-file-input') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledWith('ent_product_1', file);
    });

    // Check preview summary is displayed
    await waitFor(() => {
      expect(screen.getByText('12 rows detected')).toBeInTheDocument();
      expect(screen.getByText('Select Sheet:')).toBeInTheDocument();
    });

    // Advance to Step 2
    const nextBtn = screen.getByRole('button', { name: /Next: Map Columns/i });
    expect(nextBtn).toBeEnabled();
    fireEvent.click(nextBtn);

    // Verify Mapping & Options Step
    expect(screen.getByText('Column Mapping')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Format & Parsing Options')).toBeInTheDocument();
  });

  it('runs dry run validation and displays error counts and table if rows fail', async () => {
    const mockPreview: ImportPreviewResult = {
      sheets: ['Sheet1'],
      selectedSheet: 'Sheet1',
      detectedColumns: ['SKU', 'Title'],
      sampleRows: [{ SKU: 'SKU-ERR', Title: 'Test' }],
      totalRowsEstimated: 2,
      suggestedMapping: { SKU: 'f_sku', Title: 'f_title' },
      unmappedRequiredFieldIds: [],
    };

    const mockDryRun: ImportDryRunResult = {
      success: false,
      totalRows: 2,
      validRows: 1,
      errorRows: 1,
      errors: [
        {
          row: 3,
          column: 'SKU',
          message: "Value 'SKU-ERR' already exists in database for unique field",
        },
      ],
      summary: 'Validation failed: 1 of 2 rows have errors.',
    };

    vi.spyOn(apiClient, 'previewEntityImport').mockResolvedValue(mockPreview);
    const dryRunSpy = vi.spyOn(apiClient, 'dryRunEntityImport').mockResolvedValue(mockDryRun);

    render(
      <ImportDataModal
        isOpen={true}
        onClose={onClose}
        entity={mockEntity}
        onSuccess={onSuccess}
      />
    );

    const file = new File(['SKU,Title\nSKU-ERR,Title\n'], 'products.csv', { type: 'text/csv' });
    const fileInput = document.getElementById('entity-import-file-input') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Next: Map Columns/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Next: Map Columns/i }));

    // Click "Next: Validate (Dry Run)"
    const dryRunBtn = screen.getByRole('button', { name: /Next: Validate \(Dry Run\)/i });
    fireEvent.click(dryRunBtn);

    await waitFor(() => {
      expect(dryRunSpy).toHaveBeenCalled();
    });

    // Check summary metrics rendered
    await waitFor(() => {
      expect(screen.getByText('Total Rows')).toBeInTheDocument();
      expect(screen.getByText('Valid Rows')).toBeInTheDocument();
      expect(screen.getByText('Invalid Rows')).toBeInTheDocument();
      expect(screen.getByText("Value 'SKU-ERR' already exists in database for unique field")).toBeInTheDocument();
    });

    // Commit button should be disabled when invalid rows exist
    const commitBtn = screen.getByRole('button', { name: /Commit Import/i });
    expect(commitBtn).toBeDisabled();
  });

  it('runs commit on valid data and renders success state', async () => {
    const mockPreview: ImportPreviewResult = {
      sheets: ['Sheet1'],
      selectedSheet: 'Sheet1',
      detectedColumns: ['SKU', 'Title'],
      sampleRows: [{ SKU: 'SKU-OK', Title: 'Valid Item' }],
      totalRowsEstimated: 5,
      suggestedMapping: { SKU: 'f_sku', Title: 'f_title' },
      unmappedRequiredFieldIds: [],
    };

    const mockDryRun: ImportDryRunResult = {
      success: true,
      totalRows: 5,
      validRows: 5,
      errorRows: 0,
      errors: [],
      summary: 'Validation successful: all 5 rows are valid and ready to import.',
    };

    const mockCommit: ImportCommitResult = {
      success: true,
      insertedCount: 5,
    };

    vi.spyOn(apiClient, 'previewEntityImport').mockResolvedValue(mockPreview);
    vi.spyOn(apiClient, 'dryRunEntityImport').mockResolvedValue(mockDryRun);
    const commitSpy = vi.spyOn(apiClient, 'commitEntityImport').mockResolvedValue(mockCommit);

    render(
      <ImportDataModal
        isOpen={true}
        onClose={onClose}
        entity={mockEntity}
        onSuccess={onSuccess}
      />
    );

    const file = new File(['SKU,Title\nSKU-OK,Valid Item\n'], 'products.csv', { type: 'text/csv' });
    const fileInput = document.getElementById('entity-import-file-input') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Next: Map Columns/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Next: Map Columns/i }));

    fireEvent.click(screen.getByRole('button', { name: /Next: Validate \(Dry Run\)/i }));

    await waitFor(() => {
      expect(screen.getByText('Ready to Import!')).toBeInTheDocument();
    });

    const commitBtn = screen.getByRole('button', { name: /Commit Import \(5 rows\)/i });
    expect(commitBtn).toBeEnabled();
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(commitSpy).toHaveBeenCalled();
      expect(screen.getByText('Import Successful!')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    expect(onSuccess).toHaveBeenCalledWith(5);

    // Clicking "Done" closes the modal
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
