import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMetadata } from '../context/metadata-context';
import { usePageRuntime } from '../context/page-runtime-context';
import { fetchRecords, type RecordsResponse } from '../api/client';
import { BrokenBinding } from '../renderer/broken-binding';
import { ReferenceDisplay } from './reference-display';
import type { TableProps } from '@config-platform/schema';

export const TableComponent: React.FC<TableProps> = ({
  source,
  entityId,
  columns,
  pageSize = 10,
  onRowClick,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();

  // If source is provided, data comes from PageRuntimeContext dataSources
  const isDataSourceMode = Boolean(source && runtime);
  const dsState = source && runtime ? runtime.dataSources[source] : undefined;

  // Pagination state for direct entityId query mode
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const currentCursor = cursorStack[pageIndex] || null;

  // Determine target entity
  const effectiveEntityId = entityId;
  const entity = effectiveEntityId ? resolveEntity(effectiveEntityId) : undefined;

  const { data, isLoading: queryLoading, isError, error } = useQuery<RecordsResponse, Error>({
    queryKey: ['records', tenantId, effectiveEntityId, currentCursor, pageSize],
    queryFn: () => fetchRecords(tenantId, effectiveEntityId!, { limit: pageSize, cursor: currentCursor }),
    enabled: Boolean(!isDataSourceMode && entity && effectiveEntityId),
  });

  if (!isDataSourceMode && effectiveEntityId && !entity) {
    return <BrokenBinding type="entity" id={effectiveEntityId} />;
  }

  const records = isDataSourceMode ? dsState?.data || [] : data?.data || [];
  const isLoading = isDataSourceMode ? Boolean(dsState?.loading) : queryLoading;
  const nextCursor = isDataSourceMode ? null : data?.nextCursor || null;

  const handleNext = () => {
    if (nextCursor) {
      if (pageIndex + 1 < cursorStack.length) {
        setPageIndex(pageIndex + 1);
      } else {
        setCursorStack([...cursorStack, nextCursor]);
        setPageIndex(pageIndex + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (pageIndex > 0) {
      setPageIndex(pageIndex - 1);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col, idx) => {
                const field = resolveField(col.fieldId);
                return (
                  <th key={col.fieldId || idx}>
                    {field ? (
                      field.label || field.name
                    ) : (
                      <BrokenBinding type="field" id={col.fieldId} />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Loading records...
                </td>
              </tr>
            ) : !isDataSourceMode && isError ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--danger)' }}>
                  Error loading records: {error?.message}
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No records found.
                </td>
              </tr>
            ) : (
              records.map((row, rowIdx) => {
                const isSelected = Boolean(
                  runtime?.state?.selectedId && String(runtime.state.selectedId) === String(row.id)
                );
                return (
                  <tr
                    key={row.id || rowIdx}
                    onClick={() => {
                      if (onRowClick && runtime) {
                        runtime.runActionChain(onRowClick, { row });
                      }
                    }}
                    style={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      transition: 'background-color 0.15s ease',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : undefined,
                    }}
                    className={`${onRowClick ? 'table-row-clickable' : ''} ${isSelected ? 'table-row-selected' : ''}`.trim()}
                  >
                  {columns.map((col, idx) => {
                    const field = resolveField(col.fieldId);
                    if (!field) {
                      return <td key={col.fieldId || idx}></td>;
                    }

                    const val = row[field.name];
                    return (
                      <td key={col.fieldId || idx}>
                        {renderCellValue(field, val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
        </table>
      </div>

      {/* Pagination controls for entityId mode */}
      {!isDataSourceMode && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Page {pageIndex + 1} {records.length > 0 && `(${records.length} items)`}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePrevious}
              disabled={pageIndex === 0 || isLoading}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleNext}
              disabled={!nextCursor || isLoading}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function renderCellValue(field: any, val: any): React.ReactNode {
  if (val === null || val === undefined || val === '') {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }

  const type = field?.type || typeof val;
  const config = field?.config;

  switch (type) {
    case 'boolean':
      return (
        <span className={val ? 'badge badge-success' : 'badge'}>
          {val ? 'Yes' : 'No'}
        </span>
      );

    case 'date': {
      try {
        const d = new Date(val);
        return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString();
      } catch {
        return String(val);
      }
    }

    case 'select': {
      const opts = config?.options as Array<{ label: string; value: string }> | undefined;
      const found = opts?.find((o) => o.value === val);
      return <span className="badge">{found?.label || val}</span>;
    }

    case 'reference': {
      const targetEntityId = field?.references?.entityId || config?.targetEntityId;
      return <ReferenceDisplay targetEntityId={targetEntityId} recordId={val} />;
    }

    default:
      return String(val);
  }
}
