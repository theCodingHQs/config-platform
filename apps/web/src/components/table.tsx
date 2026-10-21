import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMetadata } from '../context/metadata-context';
import { usePageRuntime } from '../context/page-runtime-context';
import { fetchRecords, type RecordsResponse } from '../api/client';
import { BrokenBinding } from '../renderer/broken-binding';
import { ReferenceDisplay } from './reference-display';
import { formatDateFieldValue, type DateDisplayPrefs, type TableProps } from '@config-platform/schema';
import { useDateDisplayPrefs } from '../context/date-display-context';

export const TableComponent: React.FC<TableProps> = ({
  source,
  entityId,
  columns,
  pageSize = 10,
  striped = false,
  compact = false,
  bordered = false,
  emptyMessage,
  onRowClick,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const datePrefs = useDateDisplayPrefs();
  const runtime = usePageRuntime();

  // If source is provided, data comes from PageRuntimeContext dataSources
  const isDataSourceMode = Boolean(source && runtime);
  const dsState = source && runtime ? runtime.dataSources[source] : undefined;

  // Pagination state for direct entityId query mode
  const [localPageSize, setLocalPageSize] = useState(pageSize);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const currentCursor = cursorStack[pageIndex] || null;

  // Determine target entity
  const effectiveEntityId = entityId;
  const entity = effectiveEntityId ? resolveEntity(effectiveEntityId) : undefined;

  const { data, isLoading: queryLoading, isError, error } = useQuery<RecordsResponse, Error>({
    queryKey: ['records', tenantId, effectiveEntityId, currentCursor, localPageSize],
    queryFn: () => fetchRecords(tenantId, effectiveEntityId!, { limit: localPageSize, cursor: currentCursor, count: true }),
    enabled: Boolean(!isDataSourceMode && entity && effectiveEntityId),
  });

  if (!isDataSourceMode && effectiveEntityId && !entity) {
    return <BrokenBinding type="entity" id={effectiveEntityId} />;
  }

  const records = isDataSourceMode ? dsState?.data || [] : data?.data || [];
  const isLoading = isDataSourceMode ? Boolean(dsState?.loading) : queryLoading;
  const total = isDataSourceMode ? dsState?.total : data?.total;
  const effectivePageIndex = isDataSourceMode ? (dsState?.pageIndex ?? 0) : pageIndex;
  const effectivePageSize = isDataSourceMode ? (dsState?.pageSize ?? pageSize) : localPageSize;
  const hasNext = isDataSourceMode ? Boolean(dsState?.hasMore) : Boolean(data?.nextCursor);
  const hasPrev = effectivePageIndex > 0;

  const handleNext = () => {
    if (isDataSourceMode) {
      dsState?.goToNextPage();
    } else if (data?.nextCursor) {
      if (pageIndex + 1 < cursorStack.length) {
        setPageIndex(pageIndex + 1);
      } else {
        setCursorStack([...cursorStack, data.nextCursor]);
        setPageIndex(pageIndex + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (isDataSourceMode) {
      dsState?.goToPrevPage();
    } else if (pageIndex > 0) {
      setPageIndex(pageIndex - 1);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    if (isDataSourceMode) {
      dsState?.setPageSize(newSize);
    } else {
      setLocalPageSize(newSize);
      setCursorStack([null]);
      setPageIndex(0);
    }
  };

  const totalPages = total !== undefined && total > 0 ? Math.max(1, Math.ceil(total / effectivePageSize)) : undefined;
  const startItem = records.length > 0 ? effectivePageIndex * effectivePageSize + 1 : 0;
  const endItem = records.length > 0 ? (total !== undefined ? Math.min(startItem + records.length - 1, total) : startItem + records.length - 1) : 0;

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-3)',
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
      }}
    >
      <div className="table-container">
        <table
          className={`data-table ${striped ? 'table-striped' : ''} ${compact ? 'table-compact' : ''} ${bordered ? 'table-bordered' : ''}`.trim()}
        >
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
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: 'var(--spacing-8)', color: 'var(--text-muted)' }}>
                  Loading records...
                </td>
              </tr>
            ) : !isDataSourceMode && isError ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: 'var(--spacing-6)', color: 'var(--danger)' }}>
                  Error loading records: {error?.message}
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: 'var(--spacing-8)', color: 'var(--text-muted)' }}>
                  {emptyMessage || 'No records found.'}
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
                      backgroundColor: isSelected ? 'var(--accent-subtle)' : undefined,
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
                        {renderCellValue(field, val, datePrefs)}
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

      {/* Pagination controls - unified across both DataSource and direct Entity modes */}
      <div
        className="table-pagination"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--spacing-2)',
          padding: '0 var(--spacing-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {total !== undefined
              ? records.length === 0
                ? 'Showing 0 of 0 records'
                : `Showing ${startItem}–${endItem} of ${total.toLocaleString()} records`
              : records.length === 0
                ? '0 records'
                : `Showing ${records.length} records`}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Per page:
            </span>
            <select
              aria-label="Records per page"
              className="form-select"
              value={effectivePageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              style={{
                width: 'auto',
                padding: 'var(--spacing-1) var(--spacing-2)',
                fontSize: 'var(--font-size-xs)',
                minHeight: 'unset',
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {totalPages !== undefined
              ? `Page ${effectivePageIndex + 1} of ${totalPages}`
              : `Page ${effectivePageIndex + 1}`}
          </span>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Previous page"
              onClick={handlePrevious}
              disabled={!hasPrev || isLoading}
              style={{
                padding: 'var(--spacing-1) var(--spacing-3)',
                fontSize: 'var(--font-size-xs)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--spacing-1)',
              }}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Next page"
              onClick={handleNext}
              disabled={!hasNext || isLoading}
              style={{
                padding: 'var(--spacing-1) var(--spacing-3)',
                fontSize: 'var(--font-size-xs)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--spacing-1)',
              }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function renderCellValue(field: any, val: any, datePrefs: DateDisplayPrefs): React.ReactNode {
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

    case 'date':
      // Calendar dates as written, months as "Oct 2026", moments in the viewer's time zone
      return formatDateFieldValue(val, config, datePrefs);

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
