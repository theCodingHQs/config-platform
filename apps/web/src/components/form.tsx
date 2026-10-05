import React, { useState, useEffect, useMemo } from 'react';
import { Check } from 'lucide-react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useMetadata } from '../context/metadata-context';
import { usePageRuntime } from '../context/page-runtime-context';
import { createRecord, updateRecord, fetchRecord, ApiError } from '../api/client';
import { BrokenBinding } from '../renderer/broken-binding';
import { SearchableSelect } from './searchable-select';
import { resolveTemplate } from '@config-platform/schema';
import type { FormProps } from '@config-platform/schema';

export const FormComponent: React.FC<FormProps> = ({
  entityId,
  fields = [],
  mode = 'create',
  recordId,
  onSubmit,
  onSuccess,
  onError,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();
  const queryClient = useQueryClient();
  const entity = resolveEntity(entityId);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Resolve recordId expression if in edit mode
  const resolvedRecordId = useMemo(() => {
    if (!recordId) return undefined;
    if (typeof recordId === 'string' && recordId.includes('{{')) {
      const val = resolveTemplate(recordId, runtime?.scope || { state: {} });
      return val ? String(val) : undefined;
    }
    return String(recordId);
  }, [recordId, runtime?.scope]);

  // Fetch record for prefill if mode is edit
  const { data: existingRecord, isLoading: isFetchingRecord } = useQuery({
    queryKey: ['record', tenantId, entityId, resolvedRecordId],
    queryFn: () => fetchRecord(tenantId, entityId, resolvedRecordId!),
    enabled: Boolean(mode === 'edit' && tenantId && entityId && resolvedRecordId),
  });

  // Prefill formData when existing record loads
  useEffect(() => {
    if (mode === 'edit' && existingRecord) {
      setFormData(existingRecord);
    } else if (mode === 'create') {
      setFormData({});
    }
  }, [mode, existingRecord]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      if (mode === 'edit') {
        if (!resolvedRecordId) {
          throw new Error('Record ID is required for editing a record');
        }
        return updateRecord(tenantId, entityId, resolvedRecordId, data);
      }
      return createRecord(tenantId, entityId, data);
    },
    onSuccess: (savedRecord) => {
      if (mode === 'create') {
        setFormData({});
      }
      setFieldErrors({});
      setGeneralError(null);
      setSuccessMessage(
        mode === 'edit' ? 'Record updated successfully.' : 'Record created successfully.'
      );
      setTimeout(() => setSuccessMessage(null), 4000);

      // Invalidate records query so table refreshes
      queryClient.invalidateQueries({ queryKey: ['records', tenantId, entityId] });

      // Run onSuccess action chain if defined, or onSubmit fallback
      const actionsToRun = onSuccess || onSubmit;
      if (actionsToRun && runtime) {
        runtime.runActionChain(actionsToRun, { row: savedRecord });
      }
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.errors) {
        setFieldErrors(err.errors);
        setGeneralError(err.message || 'Validation failed');
      } else {
        setGeneralError(err.message || `Failed to ${mode} record`);
      }

      if (onError && runtime) {
        runtime.runActionChain(onError, { error: err });
      }
    },
  });

  if (!entity) {
    return <BrokenBinding type="entity" id={entityId} />;
  }

  const handleInputChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    if (fieldErrors[fieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    mutation.mutate(formData);
  };

  const isSaving = mutation.isPending || isFetchingRecord;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-4)',
        padding: 'var(--spacing-5)',
        backgroundColor: 'var(--surface)',
        border: 'var(--border-width-sm) solid var(--border)',
        borderRadius: 'var(--radius)',
        maxWidth: '560px',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
          {mode === 'edit' ? `Edit ${entity.label || entity.name}` : `Create ${entity.label || entity.name}`}
        </h3>
      </div>

      {generalError && (
        <div className="props-error" style={{ padding: 'var(--spacing-2) var(--spacing-3)', fontSize: 'var(--font-size-xs)' }}>
          {generalError}
        </div>
      )}

      {successMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-1)',
            padding: 'var(--spacing-2) var(--spacing-3)',
            backgroundColor: 'var(--success-subtle)',
            color: 'var(--success)',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          <Check size={14} />
          <span>{successMessage}</span>
        </div>
      )}

      {fields.map((f, idx) => {
        if (f.hidden) return null;

        const fieldDef = resolveField(f.fieldId);
        if (!fieldDef) {
          return (
            <div key={f.fieldId || idx}>
              <BrokenBinding type="field" id={f.fieldId} />
            </div>
          );
        }

        const fieldName = fieldDef.name;
        const error = fieldErrors[fieldName];
        const val = formData[fieldName] ?? '';
        const displayLabel = f.label || fieldDef.label || fieldDef.name;

        return (
          <div key={f.fieldId} style={{ display: 'flex', flexDirection: 'column' }}>
            <label className="form-label" htmlFor={`field-${fieldName}`}>
              {displayLabel}
              {fieldDef.required && !f.readOnly && (
                <span style={{ color: 'var(--danger)', marginLeft: 'var(--spacing-1)' }}>*</span>
              )}
            </label>

            {renderFieldInput(
              fieldDef,
              val,
              (newVal) => handleInputChange(fieldName, newVal),
              Boolean(f.readOnly),
              error
            )}

            {f.helpText && (
              <small style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--spacing-1)' }}>
                {f.helpText}
              </small>
            )}

            {error && <span className="form-error">{error}</span>}
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-2)' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSaving}
        >
          {mutation.isPending ? 'Saving...' : mode === 'edit' ? 'Update' : 'Submit'}
        </button>
      </div>
    </form>
  );
};

function renderFieldInput(
  fieldDef: any,
  value: any,
  onChange: (val: any) => void,
  readOnly: boolean,
  hasError?: string
): React.ReactNode {
  const type = fieldDef.type;
  const config = fieldDef.config || {};
  const isInvalidClass = hasError ? ' is-invalid' : '';

  switch (type) {
    case 'number':
      return (
        <input
          id={`field-${fieldDef.name}`}
          type="number"
          className={`form-input${isInvalidClass}`}
          value={value ?? ''}
          min={config.min}
          max={config.max}
          step="any"
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );

    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: readOnly ? 'default' : 'pointer', fontSize: 'var(--font-size-sm)' }}>
          <input
            id={`field-${fieldDef.name}`}
            type="checkbox"
            checked={Boolean(value)}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: readOnly ? 'default' : 'pointer' }}
          />
          <span>{fieldDef.label}</span>
        </label>
      );

    case 'date':
      return (
        <input
          id={`field-${fieldDef.name}`}
          type="date"
          className={`form-input${isInvalidClass}`}
          value={value ? String(value).split('T')[0] : ''}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );

    case 'select': {
      const options = (config.options || []) as Array<{ label: string; value: string }>;
      return (
        <select
          id={`field-${fieldDef.name}`}
          className={`form-select${isInvalidClass}`}
          value={value ?? ''}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Select option</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
      );
    }

    case 'reference': {
      const targetEntityId = fieldDef.references?.entityId || config?.targetEntityId;
      return (
        <SearchableSelect
          id={`field-${fieldDef.name}`}
          targetEntityId={targetEntityId}
          value={value}
          onChange={onChange}
          disabled={readOnly}
          hasError={Boolean(hasError)}
        />
      );
    }

    case 'text':
    default:
      return (
        <input
          id={`field-${fieldDef.name}`}
          type="text"
          className={`form-input${isInvalidClass}`}
          value={value ?? ''}
          maxLength={config.maxLength}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}
