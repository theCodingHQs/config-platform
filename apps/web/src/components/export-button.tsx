import React, { useState, useEffect, useContext } from 'react';
import type { ExportButtonProps } from '@config-platform/schema';
import { AuthContext, useAuth } from '../context/auth-context';
import { DynamicIcon } from './dynamic-icon';
import { useOptionalAppBar } from '../context/app-bar-context';
import { DateInput } from './date-input';
import {
  createExportDownloadToken,
  fetchEntityPermissions,
  getExportTemplate,
  type EntityPermissionRecord,
} from '../api/client';

export const ExportButtonComponent: React.FC<
  Omit<ExportButtonProps, 'variant' | 'size'> & {
    variant?: ExportButtonProps['variant'];
    size?: ExportButtonProps['size'];
    isBuilderPreview?: boolean;
  }
> = ({
  label = 'Export',
  template,
  format = 'xlsx',
  parameters,
  filters,
  variant = 'secondary',
  size = 'md',
  icon = 'Download',
  disabled = false,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  isBuilderPreview = false,
}) => {
  const auth = useContext(AuthContext);
  const user = auth?.user || null;
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [isGridTemplate, setIsGridTemplate] = useState<boolean>(false);
  const [downloading, setDownloading] = useState(false);
  // Configuration problems stay next to the button; a failed download goes to the status bar
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const appBar = useOptionalAppBar();

  const [templateRecord, setTemplateRecord] = useState<any>(null);
  const [showParamDialog, setShowParamDialog] = useState<boolean>(false);
  const [dialogParamValues, setDialogParamValues] = useState<Record<string, any>>({});
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});

  // Check canExport permission for the template's entity
  useEffect(() => {
    let active = true;

    async function checkPermission() {
      if (!template) {
        // If no template is linked yet, permit display in builder
        setCanExport(true);
        setIsGridTemplate(false);
        setTemplateRecord(null);
        return;
      }

      try {
        const tpl = await getExportTemplate(template);
        if (!active) return;
        setTemplateRecord(tpl);
        const isGrid = tpl.draft?.kind === 'grid' || tpl.published?.kind === 'grid';
        setIsGridTemplate(Boolean(isGrid));

        const perms = await fetchEntityPermissions(tpl.entityId);
        if (!active) return;

        const role = user?.role || 'viewer';
        const userPerm = perms.find((p) => p.role === role);
        const allowed = userPerm ? Boolean(userPerm.canExport) : role !== 'viewer';
        setCanExport(allowed);
      } catch {
        if (active) setCanExport(true);
      }
    }

    checkPermission();
    return () => {
      active = false;
    };
  }, [template, user?.role]);

  // Hidden for users without canExport in live runtime
  if (!isBuilderPreview && canExport === false) {
    return null;
  }

  const isInvalidFormatForGrid = isGridTemplate && format !== 'xlsx';

  const triggerDownload = async (finalParams: Record<string, any>) => {
    setDownloading(true);
    setErrorMessage(null);

    try {
      const parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;

      const { downloadUrl } = await createExportDownloadToken({
        templateId: template!,
        format: format as 'xlsx' | 'csv' | 'pdf',
        filters: parsedFilters,
        parameters: finalParams,
      });

      // Normal browser download trigger (no blob in browser memory)
      window.location.href = downloadUrl;
      setShowParamDialog(false);
    } catch (err: any) {
      if (appBar) appBar.notify('error', err.message || 'Export failed');
      else setErrorMessage(err.message || 'Export failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || downloading) return;

    if (isBuilderPreview) {
      // In builder preview mode, download is disabled
      return;
    }

    if (isInvalidFormatForGrid) {
      setErrorMessage(
        'Grid templates only support XLSX format. CSV and PDF are not supported for grid templates.'
      );
      return;
    }

    if (!template) {
      setErrorMessage('No export template configured.');
      return;
    }

    const parsedParams = typeof parameters === 'string' ? JSON.parse(parameters) : parameters || {};
    const tplDef = templateRecord?.published || templateRecord?.draft;
    const tplParams: any[] = tplDef?.parameters || [];

    // Check if any required parameter is unset
    const unsetRequired = tplParams.filter((p) => {
      if (!p.required) return false;
      const v = parsedParams[p.name] ?? parsedParams[p.id];
      return v === undefined || v === null || v === '';
    });

    if (unsetRequired.length > 0) {
      // Populate dialog with defaults
      const initial: Record<string, any> = { ...parsedParams };
      for (const p of tplParams) {
        if (initial[p.name] === undefined && initial[p.id] === undefined && p.defaultValue !== undefined) {
          initial[p.name] = p.defaultValue;
        }
      }
      setDialogParamValues(initial);
      setParamErrors({});
      setShowParamDialog(true);
      return;
    }

    await triggerDownload(parsedParams);
  };

  const handleDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tplDef = templateRecord?.published || templateRecord?.draft;
    const tplParams: any[] = tplDef?.parameters || [];
    const errors: Record<string, string> = {};

    for (const p of tplParams) {
      if (p.required) {
        const val = dialogParamValues[p.name] ?? dialogParamValues[p.id];
        if (val === undefined || val === null || val === '') {
          errors[p.name] = `${p.label || p.name} is required`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setParamErrors(errors);
      return;
    }

    await triggerDownload(dialogParamValues);
  };

  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const iconElement = icon ? (
    <DynamicIcon name={icon} size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
  ) : null;

  const tplDef = templateRecord?.published || templateRecord?.draft;
  const tplParams: any[] = tplDef?.parameters || [];

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem' }}>
      <button
        type="button"
        className={`btn btn-${variant} ${sizeClass}`.trim()}
        disabled={disabled || downloading}
        onClick={handleClick}
        style={{
          width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
          minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
          maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
          flex: flex !== undefined ? flex : undefined,
          alignSelf,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
        }}
        title={isBuilderPreview ? 'Preview mode: click does not download' : undefined}
      >
        {iconElement}
        <span>{downloading ? 'Preparing...' : label}</span>
      </button>
      {errorMessage && (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)' }}>
          {errorMessage}
        </span>
      )}

      {/* Required Parameters Modal Dialog */}
      {showParamDialog && (
        <div
          data-testid="export-param-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--overlay-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-modal)',
              padding: 'var(--space-4)',
              width: '100%',
              maxWidth: '450px',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <h3 style={{ margin: '0 0 var(--space-3) 0', fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              Export Parameters
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Please supply required parameters before exporting.
            </p>

            <form onSubmit={handleDialogSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {tplParams.map((p: any) => {
                const paramKey = p.name;
                const currentVal = dialogParamValues[paramKey] ?? p.defaultValue ?? '';
                const err = paramErrors[paramKey];

                return (
                  <div key={p.id || p.name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500 }}>
                      {p.label || p.name} {p.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                    </label>

                    {p.type === 'boolean' ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
                        <input
                          type="checkbox"
                          data-testid={`param-input-${p.name}`}
                          checked={Boolean(currentVal)}
                          onChange={(e) =>
                            setDialogParamValues((prev) => ({ ...prev, [paramKey]: e.target.checked }))
                          }
                        />
                        <span>{p.label || p.name}</span>
                      </label>
                    ) : p.type === 'date_range' ? (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <DateInput
                          aria-label={`${p.label || p.name} start`}
                          data-testid={`param-input-${p.name}-start`}
                          value={currentVal?.start}
                          onChange={(start) =>
                            setDialogParamValues((prev) => ({
                              ...prev,
                              [paramKey]: { ...(currentVal || {}), start: start ?? '' },
                            }))
                          }
                        />
                        <DateInput
                          aria-label={`${p.label || p.name} end`}
                          data-testid={`param-input-${p.name}-end`}
                          value={currentVal?.end}
                          onChange={(end) =>
                            setDialogParamValues((prev) => ({
                              ...prev,
                              [paramKey]: { ...(currentVal || {}), end: end ?? '' },
                            }))
                          }
                        />
                      </div>
                    ) : p.type === 'date' ? (
                      <DateInput
                        aria-label={p.label || p.name}
                        data-testid={`param-input-${p.name}`}
                        value={currentVal}
                        onChange={(date) => setDialogParamValues((prev) => ({ ...prev, [paramKey]: date ?? '' }))}
                      />
                    ) : (
                      <input
                        type={p.type === 'number' ? 'number' : 'text'}
                        className="input input-sm"
                        data-testid={`param-input-${p.name}`}
                        value={currentVal}
                        onChange={(e) =>
                          setDialogParamValues((prev) => ({
                            ...prev,
                            [paramKey]: p.type === 'number' ? Number(e.target.value) : e.target.value,
                          }))
                        }
                      />
                    )}

                    {err && (
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)' }}>
                        {err}
                      </span>
                    )}
                  </div>
                );
              })}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowParamDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={downloading}
                  data-testid="param-dialog-download-btn"
                >
                  {downloading ? 'Preparing...' : 'Download'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
