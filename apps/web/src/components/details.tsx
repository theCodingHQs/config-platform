import React from "react";
import type { DetailsProps } from "@config-platform/schema";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
import { BrokenBinding } from "../renderer/broken-binding";
import { ReferenceDisplay } from "./reference-display";

export const DetailsComponent: React.FC<DetailsProps> = ({
  source,
  entityId,
  recordId,
  fields = [],
}) => {
  const { resolveEntity, resolveField } = useMetadata();
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
          padding: "24px",
          textAlign: "center",
          color: "var(--text-muted)",
          background: "var(--surface)",
          borderRadius: "var(--radius, 8px)",
          border: "1px dashed var(--border)",
          fontSize: 14,
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

  return (
    <div
      className="details-card"
      data-testid="details-card"
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius, 8px)",
        border: "1px solid var(--border)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          fontWeight: 600,
          fontSize: 15,
          background: "var(--surface-subtle)",
          color: "var(--text)",
        }}
      >
        Record Details
      </div>
      <div style={{ padding: "8px 20px" }}>
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
                  padding: "10px 0",
                  borderBottom:
                    idx < fieldList.length - 1
                      ? "1px solid var(--border-subtle)"
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
                padding: "10px 0",
                borderBottom:
                  idx < fieldList.length - 1
                    ? "1px solid var(--border-subtle)"
                    : "none",
                fontSize: 14,
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
