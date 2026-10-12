import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Loader2,
  RefreshCw,
  Layers,
  HelpCircle,
} from 'lucide-react';
import type {
  ErdTable,
  ImportPreviewResult,
  ImportDryRunResult,
  ImportCommitResult,
  ImportOptions,
} from '@config-platform/schema';
import {
  previewEntityImport,
  dryRunEntityImport,
  commitEntityImport,
} from '../api/client';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: ErdTable;
  onSuccess?: (insertedCount: number) => void;
}

export const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  onClose,
  entity,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState<'ISO' | 'DD/MM/YYYY' | 'MM/DD/YYYY'>('ISO');
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');
  const [trueWords, setTrueWords] = useState<string>('true, yes, y, 1, on');
  const [falseWords, setFalseWords] = useState<string>('false, no, n, 0, off');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [dryRunResult, setDryRunResult] = useState<ImportDryRunResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep(1);
    setFile(null);
    setSheetName(undefined);
    setPreview(null);
    setMapping({});
    setDateFormat('ISO');
    setDecimalSeparator('.');
    setDryRunResult(null);
    setCommitResult(null);
    setIsLoading(false);
    setErrorMessage(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Filter out system columns from mappable fields
  const mappableFields = (entity.columns || []).filter(
    (c) => !['id', 'created_at', 'updated_at'].includes(c.name)
  );

  // Auto-match columns by name or label (case-insensitive)
  const autoMatchColumns = (fileColumns: string[]) => {
    const newMapping: Record<string, string> = {};
    for (const col of fileColumns) {
      const cleanCol = col.trim().toLowerCase();
      const matched = mappableFields.find(
        (f) =>
          f.name.toLowerCase() === cleanCol ||
          (f.label && f.label.toLowerCase() === cleanCol)
      );
      if (matched) {
        newMapping[col] = matched.id;
      } else {
        newMapping[col] = '__ignore__';
      }
    }
    return newMapping;
  };

  // ── Step 1: File Selection & Preview ──────────────────────────────────────
  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile) return;

    // Validate size (< 10 MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('File exceeds the 10 MB upload limit. Please select a smaller file.');
      return;
    }

    setFile(selectedFile);
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const previewData = await previewEntityImport(entity.id, selectedFile);
      setPreview(previewData);
      if (previewData.sheets && previewData.sheets.length > 0) {
        setSheetName(previewData.selectedSheet || previewData.sheets[0]);
      }
      const initialMapping = (previewData.suggestedMapping as Record<string, string>) || autoMatchColumns(previewData.detectedColumns);
      setMapping(initialMapping);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to preview file.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSheetChange = async (newSheet: string) => {
    if (!file) return;
    setSheetName(newSheet);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const previewData = await previewEntityImport(entity.id, file, newSheet);
      setPreview(previewData);
      const initialMapping = (previewData.suggestedMapping as Record<string, string>) || autoMatchColumns(previewData.detectedColumns);
      setMapping(initialMapping);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to preview selected sheet.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 2 -> Step 3: Run Dry Run ─────────────────────────────────────────
  const handleRunDryRun = async () => {
    if (!file) return;
    setIsLoading(true);
    setErrorMessage(null);
    setStep(3);

    const options: ImportOptions = {
      dateFormat,
      decimalSeparator,
      trueWords: trueWords.split(',').map((w) => w.trim()).filter(Boolean),
      falseWords: falseWords.split(',').map((w) => w.trim()).filter(Boolean),
    };

    try {
      const res = await dryRunEntityImport(entity.id, file, mapping, options, sheetName);
      setDryRunResult(res);
    } catch (err: any) {
      setErrorMessage(err.message || 'Dry run validation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 3 -> Step 4: Commit Import ───────────────────────────────────────
  const handleCommit = async () => {
    if (!file) return;
    setIsLoading(true);
    setErrorMessage(null);
    setStep(4);

    const options: ImportOptions = {
      dateFormat,
      decimalSeparator,
      trueWords: trueWords.split(',').map((w) => w.trim()).filter(Boolean),
      falseWords: falseWords.split(',').map((w) => w.trim()).filter(Boolean),
    };

    try {
      const res = await commitEntityImport(entity.id, file, mapping, options, sheetName);
      setCommitResult(res);
      if (onSuccess) {
        onSuccess(res.insertedCount);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to commit import. Transaction rolled back.');
    } finally {
      setIsLoading(false);
    }
  };

  // Check unmapped required fields
  const unmappedRequiredFields = mappableFields.filter(
    (f) => f.required && !Object.values(mapping).includes(f.id)
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-surface)',
          width: '780px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-xl)',
          border: 'var(--border-width) solid var(--border)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Upload size={18} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text)' }}>
              Import Data into {entity.label}
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleClose}
            style={{ padding: 'var(--space-1)', display: 'flex', alignItems: 'center' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Wizard Steps Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: 'var(--border-width) solid var(--border)',
            backgroundColor: 'var(--surface-subtle)',
            padding: 'var(--space-2) var(--space-5)',
            gap: 'var(--space-4)',
          }}
        >
          {[
            { num: 1, label: 'Upload' },
            { num: 2, label: 'Mapping & Options' },
            { num: 3, label: 'Dry Run' },
            { num: 4, label: 'Complete' },
          ].map((st) => {
            const isActive = step === st.num;
            const isCompleted = step > st.num;
            return (
              <div
                key={st.num}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--primary)' : isCompleted ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: 'var(--radius-pill)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isActive
                      ? 'var(--accent)'
                      : isCompleted
                      ? 'var(--accent-subtle)'
                      : 'var(--border)',
                    color: isActive ? 'var(--accent-contrast)' : isCompleted ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  {st.num}
                </span>
                <span>{st.label}</span>
                {st.num < 4 && <ChevronRight size={12} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />}
              </div>
            );
          })}
        </div>

        {/* Modal Body */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {errorMessage && (
            <div
              className="props-error"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-2)',
                backgroundColor: 'var(--danger-subtle)',
                color: 'var(--danger)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-control)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 'var(--spacing-1)' }} />
              <div style={{ flex: 1 }}>{errorMessage}</div>
            </div>
          )}

          {/* STEP 1: UPLOAD */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div
                style={{
                  border: '2px dashed var(--border)',
                  borderRadius: 'var(--radius-surface)',
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  backgroundColor: 'var(--surface-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
                onClick={() => document.getElementById('entity-import-file-input')?.click()}
              >
                <input
                  id="entity-import-file-input"
                  type="file"
                  accept=".csv,.xlsx"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileChange(f);
                  }}
                />
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-pill)',
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Upload size={24} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text)' }}>
                  {file ? file.name : 'Choose a CSV or Excel (.xlsx) file to upload'}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  Supports CSV (UTF-8, with or without BOM) and Excel (.xlsx) up to 10 MB
                </div>
              </div>

              {isLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Inspecting file and detecting columns...</span>
                </div>
              )}

              {preview && !isLoading && (
                <div
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-control)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {file?.name.endsWith('.xlsx') ? (
                        <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} />
                      ) : (
                        <FileText size={16} style={{ color: 'var(--accent)' }} />
                      )}
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{file?.name}</span>
                    </div>
                    <span className="badge" style={{ fontSize: 'var(--font-size-xs)' }}>
                      {preview.totalRowsEstimated} rows detected
                    </span>
                  </div>

                  {/* Sheet Selector if multiple sheets in XLSX */}
                  {preview.sheets && preview.sheets.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Layers size={14} style={{ color: 'var(--text-muted)' }} />
                      <label htmlFor="import-sheet-picker" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--text-muted)' }}>
                        Select Sheet:
                      </label>
                      <select
                        id="import-sheet-picker"
                        className="form-select"
                        value={sheetName}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        style={{ fontSize: 'var(--font-size-xs)', padding: '0.2rem 0.5rem', width: 'auto' }}
                      >
                        {preview.sheets.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    Columns found ({preview.detectedColumns.length}):{' '}
                    <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>
                      {preview.detectedColumns.join(', ')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: MAPPING & OPTIONS */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {unmappedRequiredFields.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'var(--warning-subtle)',
                    color: 'var(--warning)',
                    border: 'var(--border-width-sm) solid var(--warning)',
                    borderRadius: 'var(--radius-control)',
                    padding: 'var(--space-3)',
                    fontSize: 'var(--font-size-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Unmapped required fields:</strong>{' '}
                    {unmappedRequiredFields.map((f) => f.label || f.name).join(', ')}. All required fields must be mapped to valid data.
                  </div>
                </div>
              )}

              {/* Mapping Table */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)', display: 'block' }}>
                  Column Mapping
                </label>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-control)',
                    overflow: 'hidden',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-xs)' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>File Column</th>
                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Sample Value</th>
                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Maps To Entity Field</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview?.detectedColumns || []).map((col: string) => {
                        const sampleVal = preview?.sampleRows?.[0]?.[col];
                        const mappedFieldId = mapping[col] || '__ignore__';
                        const matchedField = mappableFields.find((f) => f.id === mappedFieldId);

                        return (
                          <tr key={col} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>
                              {col}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sampleVal !== undefined && sampleVal !== null ? String(sampleVal) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>empty</span>}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <select
                                className="form-select"
                                value={mappedFieldId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setMapping((prev) => ({ ...prev, [col]: val }));
                                }}
                                style={{ fontSize: 'var(--font-size-xs)', padding: '0.25rem 0.5rem', width: '100%' }}
                              >
                                <option value="__ignore__">-- Ignore Column --</option>
                                {mappableFields.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.label || f.name} ({f.type}){f.required ? ' *' : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Format Options */}
              <div
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-control)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-xs)', color: 'var(--text)' }}>
                  Format & Parsing Options
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>
                      Date Format
                    </label>
                    <select
                      className="form-select"
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value as any)}
                      style={{ fontSize: 'var(--font-size-xs)', width: '100%' }}
                    >
                      <option value="ISO">ISO (YYYY-MM-DD)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>
                      Decimal Separator
                    </label>
                    <select
                      className="form-select"
                      value={decimalSeparator}
                      onChange={(e) => setDecimalSeparator(e.target.value as any)}
                      style={{ fontSize: 'var(--font-size-xs)', width: '100%' }}
                    >
                      <option value=".">Dot ( . ) - e.g. 1250.50</option>
                      <option value=",">Comma ( , ) - e.g. 1.250,50</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>
                      True Words (comma-separated)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={trueWords}
                      onChange={(e) => setTrueWords(e.target.value)}
                      style={{ fontSize: 'var(--font-size-xs)' }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>
                      False Words (comma-separated)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={falseWords}
                      onChange={(e) => setFalseWords(e.target.value)}
                      style={{ fontSize: 'var(--font-size-xs)' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: DRY RUN */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {isLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', gap: 'var(--space-2)' }}>
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
                  <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', color: 'var(--text)' }}>
                    Validating rows without writing to database...
                  </div>
                </div>
              )}

              {dryRunResult && !isLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {/* Summary metric cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                    <div
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3)',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Total Rows</div>
                      <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--text)' }}>
                        {dryRunResult.totalRows}
                      </div>
                    </div>
                    <div
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3)',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Valid Rows</div>
                      <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--success)' }}>
                        {dryRunResult.validRows}
                      </div>
                    </div>
                    <div
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3)',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Invalid Rows</div>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xl)',
                          fontWeight: 700,
                          color: dryRunResult.errorRows > 0 ? 'var(--danger)' : 'var(--text-muted)',
                        }}
                      >
                        {dryRunResult.errorRows}
                      </div>
                    </div>
                  </div>

                  {/* Validation status banner */}
                  {dryRunResult.errorRows === 0 ? (
                    <div
                      style={{
                        backgroundColor: 'var(--success-subtle)',
                        color: 'var(--success)',
                        border: 'var(--border-width-sm) solid var(--success)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3) var(--space-4)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                      }}
                    >
                      <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Ready to Import!</strong> All {dryRunResult.validRows} rows passed validation with no errors.
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--danger-subtle)',
                        color: 'var(--danger)',
                        border: 'var(--border-width-sm) solid var(--danger)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3) var(--space-4)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                      }}
                    >
                      <AlertTriangle size={20} style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Validation Errors Found.</strong> {dryRunResult.errorRows} row(s) contain errors. All-or-nothing: commit will roll back unless all rows pass.
                      </div>
                    </div>
                  )}

                  {/* Errors table if any */}
                  {dryRunResult.errors.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-2)' }}>
                        Validation Errors (First {dryRunResult.errors.length})
                      </div>
                      <div
                        style={{
                          maxHeight: '220px',
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-control)',
                        }}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-xs)' }}>
                          <thead>
                            <tr style={{ backgroundColor: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                              <th style={{ padding: '0.4rem 0.6rem', width: '60px' }}>Row</th>
                              <th style={{ padding: '0.4rem 0.6rem', width: '120px' }}>Column</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>Error Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dryRunResult.errors.map((err, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{err.row}</td>
                                <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-muted)' }}>{err.column || '—'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', color: 'var(--danger)' }}>{err.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: COMMIT RESULT */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
              {isLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--text)' }}>
                    Writing records in a single transaction...
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    Statement timeout set to 30 seconds. All-or-nothing guarantee.
                  </div>
                </div>
              )}

              {commitResult && !isLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
                  <div
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: 'var(--success-subtle)',
                      color: 'var(--success)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckCircle2 size={32} />
                  </div>
                  <h4 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--text)' }}>
                    Import Successful!
                  </h4>
                  <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    Successfully inserted <strong>{commitResult.insertedCount}</strong> records into{' '}
                    <strong>{entity.label}</strong>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          {step === 1 && (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!preview || isLoading}
                onClick={() => setStep(2)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                Next: Map Columns <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                Back to File
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRunDryRun}
                disabled={isLoading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                Next: Validate (Dry Run) <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(2)}
                disabled={isLoading}
              >
                Back to Mapping
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCommit}
                disabled={isLoading || !dryRunResult || dryRunResult.errorRows > 0 || dryRunResult.validRows === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                Commit Import ({dryRunResult?.validRows || 0} rows)
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <div />
              {commitResult ? (
                <button type="button" className="btn btn-primary" onClick={handleClose}>
                  Done
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>
                  Back to Mapping
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
