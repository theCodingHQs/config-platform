import React, { useState, useEffect, useMemo, useRef } from "react";
import { Check, Trash2, Save } from "lucide-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
import {
  createRecord,
  updateRecord,
  fetchRecord,
  fetchMyEntityPermissions,
  ApiError,
} from "../api/client";
import { BrokenBinding } from "../renderer/broken-binding";
import { SearchableSelect } from "./searchable-select";
import { DynamicIcon } from "./dynamic-icon";
import { resolveTemplate, isAllowedIcon } from "@config-platform/schema";
import { DateInput } from "./date-input";
import { useOptionalAppBar } from "../context/app-bar-context";
import type { FormProps } from "@config-platform/schema";

const SYSTEM_KEYS = new Set(["id", "created_at", "updated_at"]);

export const FormComponent: React.FC<FormProps> = ({
  entityId,
  fields = [],
  mode = "create",
  recordId,
  showHeader = true,
  title,
  subtitle,
  showFooter = true,
  submitLabel,
  showCancel = false,
  cancelLabel = "Cancel",
  onCancel,
  showDelete = false,
  deleteLabel,
  onDelete,
  onSubmit,
  onSuccess,
  onError,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();
  const queryClient = useQueryClient();
  const entity = resolveEntity(entityId);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In the app, save results go to the status bar; validation errors stay on the form.
  // Outside the app shell (e.g. isolated renders) they are shown inline as before.
  const appBar = useOptionalAppBar();

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  // Fetch effective role permissions for this entity
  const { data: entityPermissions } = useQuery({
    queryKey: ["entity-permissions", tenantId, entityId],
    queryFn: () => fetchMyEntityPermissions(entityId),
    enabled: Boolean(tenantId && entityId),
    staleTime: 60000,
  });

  // Resolve recordId expression if in edit mode
  const resolvedRecordId = useMemo(() => {
    if (!recordId) return undefined;
    if (typeof recordId === "string" && recordId.includes("{{")) {
      const val = resolveTemplate(recordId, runtime?.scope || { state: {} });
      return val ? String(val) : undefined;
    }
    return String(recordId);
  }, [recordId, runtime?.scope]);

  // Fetch record for prefill if mode is edit
  const { data: existingRecord, isLoading: isFetchingRecord } = useQuery({
    queryKey: ["record", tenantId, entityId, resolvedRecordId],
    queryFn: () => fetchRecord(tenantId, entityId, resolvedRecordId!),
    enabled: Boolean(
      mode === "edit" && tenantId && entityId && resolvedRecordId,
    ),
  });

  // Prefill formData when existing record loads (only configured fields, never whole record)
  useEffect(() => {
    if (mode === "edit" && existingRecord) {
      const initial: Record<string, any> = {};
      for (const f of fields) {
        const fieldDef = resolveField(f.fieldId);
        const name = fieldDef?.name || f.fieldId;
        if (SYSTEM_KEYS.has(name) || SYSTEM_KEYS.has(f.fieldId)) continue;
        if (existingRecord[name] !== undefined) {
          initial[name] = existingRecord[name];
        } else if (existingRecord[f.fieldId] !== undefined) {
          initial[name] = existingRecord[f.fieldId];
        }
      }
      setFormData(initial);
    } else if (mode === "create") {
      setFormData({});
    }
  }, [mode, existingRecord, fields, resolveField]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      if (mode === "edit") {
        if (!resolvedRecordId) {
          throw new Error("Record ID is required for editing a record");
        }
        return updateRecord(tenantId, entityId, resolvedRecordId, data);
      }
      return createRecord(tenantId, entityId, data);
    },
    onSuccess: (savedRecord) => {
      if (mode === "create") {
        setFormData({});
      }
      setFieldErrors({});
      setGeneralError(null);
      const savedMessage = mode === "edit" ? "Record updated successfully." : "Record created successfully.";
      if (appBar) {
        appBar.notify("success", savedMessage);
      } else {
        setSuccessMessage(savedMessage);
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
      }

      // Invalidate records query so table refreshes
      queryClient.invalidateQueries({
        queryKey: ["records", tenantId, entityId],
      });

      // Run onSuccess action chain if defined, or onSubmit fallback
      const actionsToRun = onSuccess || onSubmit;
      if (actionsToRun && runtime) {
        runtime.runActionChain(actionsToRun, { row: savedRecord });
      }
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.errors) {
        setFieldErrors(err.errors);
        setGeneralError(err.message || "Validation failed");
      } else if (appBar) {
        setGeneralError(null);
        appBar.notify("error", err.message || `Failed to ${mode} record`);
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

    // Build payload only from configured, writable fields. Never send loaded record wholesale.
    // Exclude id, created_at, updated_at, and any field the current role cannot write (read-only or hidden).
    const payload: Record<string, any> = {};
    for (const f of fields) {
      if (f.readOnly || f.hidden) continue;

      const fieldDef = resolveField(f.fieldId);
      const name = fieldDef?.name || f.fieldId;

      if (
        SYSTEM_KEYS.has(name) ||
        SYSTEM_KEYS.has(f.fieldId) ||
        (fieldDef && SYSTEM_KEYS.has(fieldDef.id))
      ) {
        continue;
      }

      // Check role permissions (read-only or hidden)
      const rolePerm =
        entityPermissions?.fields?.[f.fieldId] ||
        (fieldDef ? entityPermissions?.fields?.[fieldDef.id] : undefined) ||
        (fieldDef ? entityPermissions?.fields?.[fieldDef.name] : undefined);
      if (rolePerm?.readOnly || rolePerm?.hidden) {
        continue;
      }

      if (formData[name] !== undefined) {
        payload[name] = formData[name];
      }
    }

    mutation.mutate(payload);
  };

  const handleCancel = () => {
    if (onCancel && runtime) {
      runtime.runActionChain(onCancel);
    }
  };

  const handleDelete = () => {
    if (onDelete && runtime) {
      runtime.runActionChain(onDelete);
    }
  };

  const isSaving = mutation.isPending || isFetchingRecord;
  const displayTitle = title || (mode === "edit" ? `Edit ${entity.label || entity.name}` : `Create ${entity.label || entity.name}`);

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: showHeader ? "var(--space-5)" : "var(--spacing-0)",
        backgroundColor: showHeader ? "var(--surface)" : "transparent",
        flex: flex !== undefined ? flex : undefined,
        width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : (flex !== undefined ? undefined : '100%'),
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
      }}
    >
      {showHeader && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
            marginBottom: "var(--space-1)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text)" }}>
            {displayTitle}
          </h3>
          {subtitle && (
            <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {generalError && (
        <div
          className="props-error"
          style={{
            padding: "var(--space-2) var(--space-3)",
            fontSize: "var(--font-size-xs)",
            borderRadius: "var(--radius-control)",
          }}
        >
          {generalError}
        </div>
      )}

      {successMessage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            padding: "var(--space-2) var(--space-3)",
            backgroundColor: "var(--success-subtle)",
            color: "var(--success)",
            borderRadius: "var(--radius-control)",
            fontSize: "var(--font-size-xs)",
          }}
        >
          <Check size={14} />
          <span>{successMessage}</span>
        </div>
      )}

      {fields.map((f, idx) => {
        const fieldDef = resolveField(f.fieldId);
        const rolePerm =
          entityPermissions?.fields?.[f.fieldId] ||
          (fieldDef ? entityPermissions?.fields?.[fieldDef.id] : undefined) ||
          (fieldDef ? entityPermissions?.fields?.[fieldDef.name] : undefined);

        if (f.hidden || rolePerm?.hidden) return null;

        if (!fieldDef) {
          return (
            <div key={f.fieldId || idx}>
              <BrokenBinding type="field" id={f.fieldId} />
            </div>
          );
        }

        const fieldName = fieldDef.name;
        if (
          SYSTEM_KEYS.has(fieldName) ||
          SYSTEM_KEYS.has(fieldDef.id) ||
          SYSTEM_KEYS.has(f.fieldId)
        ) {
          return null;
        }

        const isReadOnly = Boolean(f.readOnly || rolePerm?.readOnly);
        const error = fieldErrors[fieldName];
        const val = formData[fieldName] ?? "";
        const displayLabel = f.label || fieldDef.label || fieldDef.name;

        return (
          <div
            key={f.fieldId}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            <label
              className="form-label"
              htmlFor={`field-${fieldName}`}
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 0,
              }}
            >
              {displayLabel}
              {fieldDef.required && !isReadOnly && (
                <span
                  style={{
                    color: "var(--danger)",
                    marginLeft: "var(--space-1)",
                  }}
                >
                  *
                </span>
              )}
            </label>

            {renderFieldInput(
              fieldDef,
              val,
              (newVal) => handleInputChange(fieldName, newVal),
              isReadOnly,
              error,
              f.icon,
            )}

            {f.helpText && (
              <small
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-xs)",
                  marginTop: "var(--space-1)",
                  lineHeight: 1.4,
                }}
              >
                {f.helpText}
              </small>
            )}

            {error && <span className="form-error">{error}</span>}
          </div>
        );
      })}

      {/* Explicit Action Footer */}
      {showFooter !== false && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "var(--space-5)",
            marginTop: "var(--space-2)",
            borderTop: "var(--border-width-sm) solid var(--border)",
            gap: "var(--space-3)",
          }}
        >
          <div>
            {(showDelete || onDelete) &&
              (entityPermissions ? Boolean(entityPermissions.canDelete) : true) && (
                <button
                  type="button"
                  onClick={handleDelete}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-4)",
                    backgroundColor: "var(--danger-subtle)",
                    color: "var(--danger)",
                    border: "var(--border-width-sm) solid var(--danger-border)",
                    borderRadius: "var(--radius-button)",
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Trash2 size={16} />
                  <span>
                    {deleteLabel || `Delete ${entity.label || entity.name}`}
                  </span>
                </button>
              )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
            }}
          >
            {(showCancel || onCancel) && (
              <button
                type="button"
                onClick={handleCancel}
                className="btn btn-secondary"
                style={{
                  padding: "var(--space-2) var(--space-5)",
                  borderRadius: "var(--radius-button)",
                  border: "var(--border-width-sm) solid var(--border)",
                  backgroundColor: "var(--surface)",
                  color: "var(--text)",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {cancelLabel}
              </button>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-2) var(--space-5)",
                borderRadius: "var(--radius-button)",
                backgroundColor: "var(--primary)",
                color: "var(--accent-contrast)",
                border: "none",
                fontSize: "var(--font-size-sm)",
                fontWeight: 500,
                cursor: isSaving ? "not-allowed" : "pointer",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <Save size={16} />
              <span>
                {mutation.isPending
                  ? "Saving..."
                  : submitLabel || (mode === "edit" ? "Update" : "Submit")}
              </span>
            </button>
          </div>
        </div>
      )}
    </form>
  );
};

function getFieldIconName(fieldDef: any, customIcon?: string): string | null {
  // If explicitly chosen and valid/known icon name, use it
  if (customIcon && isAllowedIcon(customIcon)) {
    return customIcon;
  }

  // If unknown icon name or absent, fall back strictly to field type icon (no guessing)
  const type = fieldDef?.type;
  switch (type) {
    case "number":
      return "Hash";
    case "date":
      return "Calendar";
    case "select":
      return "List";
    case "reference":
      return "Link";
    case "text":
      return customIcon ? "Type" : null;
    default:
      return customIcon ? "Type" : null;
  }
}

function renderFieldInput(
  fieldDef: any,
  value: any,
  onChange: (val: any) => void,
  readOnly: boolean,
  hasError?: string,
  customIcon?: string,
): React.ReactNode {
  const type = fieldDef.type;
  const config = fieldDef.config || {};
  const isInvalidClass = hasError ? " is-invalid" : "";
  const iconName = getFieldIconName(fieldDef, customIcon);

  const wrapWithIcon = (inputEl: React.ReactNode) => {
    if (!iconName) return inputEl;
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "var(--space-3)",
            color: "var(--text-muted)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <DynamicIcon name={iconName} size={16} />
        </div>
        {inputEl}
      </div>
    );
  };

  switch (type) {
    case "number":
      return wrapWithIcon(
        <input
          id={`field-${fieldDef.name}`}
          type="number"
          className={`form-input${isInvalidClass}`}
          value={value ?? ""}
          min={config.min}
          max={config.max}
          step="any"
          disabled={readOnly}
          style={
            iconName
              ? {
                  paddingLeft: "calc(var(--space-6) + var(--space-3))",
                  borderRadius: "var(--radius-control)",
                }
              : { borderRadius: "var(--radius-control)" }
          }
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />,
      );

    case "boolean":
      return (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-2)",
            cursor: readOnly ? "default" : "pointer",
            fontSize: "var(--font-size-sm)",
          }}
        >
          <input
            id={`field-${fieldDef.name}`}
            type="checkbox"
            checked={Boolean(value)}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              cursor: readOnly ? "default" : "pointer",
            }}
          />
          <span>{fieldDef.label}</span>
        </label>
      );

    case "date": {
      // Calendar date, month (saved as the 1st) or a moment in time, typed or picked in the
      // viewer's own date format and time zone; the value is always ISO
      const dateKind = fieldDef.config?.includeTime ? "datetime" : fieldDef.config?.granularity === "month" ? "month" : "day";
      return wrapWithIcon(
        <DateInput
          id={`field-${fieldDef.name}`}
          kind={dateKind}
          value={value ?? undefined}
          invalid={Boolean(hasError)}
          disabled={readOnly}
          inputStyle={iconName ? { paddingLeft: "calc(var(--space-6) + var(--space-3))" } : undefined}
          onChange={(next) => onChange(next)}
        />,
      );
    }

    case "select": {
      const options = (config.options || []) as Array<{
        label: string;
        value: string;
      }>;
      return (
        <select
          id={`field-${fieldDef.name}`}
          className={`form-select${isInvalidClass}`}
          value={value ?? ""}
          disabled={readOnly}
          style={{ borderRadius: "var(--radius-control)" }}
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

    case "reference": {
      const targetEntityId =
        fieldDef.references?.entityId || config?.targetEntityId;
      return wrapWithIcon(
        <SearchableSelect
          id={`field-${fieldDef.name}`}
          targetEntityId={targetEntityId}
          value={value}
          onChange={onChange}
          disabled={readOnly}
          hasError={Boolean(hasError)}
        />,
      );
    }

    case "text":
    default:
      return wrapWithIcon(
        <input
          id={`field-${fieldDef.name}`}
          type="text"
          className={`form-input${isInvalidClass}`}
          value={value ?? ""}
          maxLength={config.maxLength}
          readOnly={readOnly}
          disabled={readOnly}
          style={
            iconName
              ? {
                  paddingLeft: "calc(var(--space-6) + var(--space-3))",
                  borderRadius: "var(--radius-control)",
                }
              : { borderRadius: "var(--radius-control)" }
          }
          onChange={(e) => onChange(e.target.value || undefined)}
        />,
      );
  }
}

