import React from "react";
import { formatDateFieldValue, type DetailsProps } from "@config-platform/schema";
import { useDateDisplayPrefs } from "../context/date-display-context";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
import { BrokenBinding } from "../renderer/broken-binding";
import { ReferenceDisplay } from "./reference-display";

export const DetailsComponent: React.FC<DetailsProps> = ({
  source,
  entityId,
  recordId,
  fields = [],
  columns = 2,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const { resolveEntity, resolveField } = useMetadata();
  const datePrefs = useDateDisplayPrefs();
  const runtime = usePageRuntime();

  // If source is provided, look up record in data source
  let record: Record<string, any> | undefined = undefined;
  let targetEntityId = entityId;

  if (source && runtime) {
    const ds = runtime.dataSources[source];
    if (ds && ds.data) {
      if (recordId !== undefined && recordId !== null && recordId !== "") {
        record = ds.data.find((r) => String(r.id) === String(recordId));
      } else {
        record = ds.data[0];
      }
    }
  }

  // If recordId is provided in state or props but no record yet and source is present
  if (!record && runtime && recordId !== undefined) {
    // If state has an active record object directly
    if (typeof recordId === "object" && recordId !== null) {
      record = recordId as Record<string, any>;
    }
  }

  if (targetEntityId) {
    const entity = resolveEntity(targetEntityId);
    if (!entity && !source) {
      return <BrokenBinding type="entity" id={targetEntityId} />;
    }
  }

  if (!record) {
    return (
      <div
        className="details-empty"
        data-testid="details-empty"
        style={{
          padding: "var(--spacing-6)",
          textAlign: "center",
          color: "var(--text-muted)",
          background: "var(--surface)",
          borderRadius: "var(--radius-surface)",
          border: "var(--border-width-sm) dashed var(--border)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        Select a record to view details
      </div>
    );
  }

  // Determine which fields to display
  const fieldList =
    fields.length > 0
      ? fields
      : Object.keys(record).map((k) => ({ fieldId: k }));

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className="details-card"
      data-testid="details-card"
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-surface)",
        border: "var(--border-width-sm) solid var(--border)",
        overflow: "hidden",
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
      }}
    >
      <div
        style={{
          padding: "var(--spacing-3) var(--spacing-5)",
          borderBottom: "var(--border-width-sm) solid var(--border)",
          fontWeight: 600,
          fontSize: "var(--font-size-md)",
          background: "var(--surface-2)",
          color: "var(--text)",
        }}
      >
        Record Details
      </div>
      <div
        style={{
          padding: "var(--spacing-3) var(--spacing-5)",
          display: columns > 1 ? "grid" : "block",
          gridTemplateColumns:
            columns > 1 ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
          gap: columns > 1 ? "var(--spacing-4)" : undefined,
        }}
      >
        {fieldList.map((f, idx) => {
          const fieldDef = resolveField(f.fieldId);
          const label = fieldDef?.label || f.fieldId;
          const val = fieldDef
            ? (record[fieldDef.name] ?? record[f.fieldId])
            : record[f.fieldId];

          if (!fieldDef && f.fieldId.startsWith("f_")) {
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  padding: "var(--spacing-2) 0",
                  borderBottom:
                    idx < fieldList.length - 1
                      ? "var(--border-width-sm) solid var(--border-subtle)"
                      : "none",
                }}
              >
                <BrokenBinding type="field" id={f.fieldId} />
              </div>
            );
          }

          return (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "var(--spacing-2) 0",
                borderBottom:
                  idx < fieldList.length - 1
                    ? "var(--border-width-sm) solid var(--border-subtle)"
                    : "none",
                fontSize: "var(--font-size-sm)",
              }}
            >
              <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                {label}
              </span>
              <span style={{ fontWeight: 500, color: "var(--text)" }}>
                {val === null || val === undefined ? (
                  "—"
                ) : fieldDef?.type === "reference" ? (
                  <ReferenceDisplay
                    targetEntityId={
                      fieldDef.references?.entityId ||
                      fieldDef.config?.targetEntityId
                    }
                    recordId={val}
                  />
                ) : fieldDef?.type === "date" ? (
                  formatDateFieldValue(val, fieldDef.config, datePrefs)
                ) : fieldDef?.type === "select" ? (
                  // The option's label, as tables show it ("OPC UA", not "opcua")
                  (fieldDef.config?.options as Array<{ label: string; value: string }> | undefined)?.find((o) => o.value === val)?.label ?? String(val)
                ) : fieldDef?.type === "boolean" ? (
                  val ? "Yes" : "No"
                ) : (
                  String(val)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
