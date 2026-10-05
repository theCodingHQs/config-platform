import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchRecords } from '../api/client';
import { useMetadata } from '../context/metadata-context';

export interface SearchableSelectProps {
  id?: string;
  targetEntityId: string;
  value: any;
  onChange: (val: any) => void;
  disabled?: boolean;
  hasError?: boolean;
  placeholder?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  targetEntityId,
  value,
  onChange,
  disabled = false,
  hasError = false,
  placeholder = 'Select reference...',
}) => {
  const { tenantId, resolveEntity } = useMetadata();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const targetEntity = resolveEntity(targetEntityId);

  // Fetch records for target entity
  const { data: recordsData, isLoading } = useQuery({
    queryKey: ['records', tenantId, targetEntityId, 'options'],
    queryFn: () => fetchRecords(tenantId, targetEntityId, { limit: 100 }),
    enabled: Boolean(tenantId && targetEntityId),
  });

  const records = recordsData?.data || [];

  // Determine display label for a record
  const getRecordLabel = (rec: Record<string, any>): string => {
    if (targetEntity?.displayFieldId) {
      const displayCol = targetEntity.columns.find((c) => c.id === targetEntity.displayFieldId);
      if (displayCol && rec[displayCol.name] !== undefined) {
        return String(rec[displayCol.name]);
      }
    }
    return String(rec.name ?? rec.label ?? rec.title ?? rec.full_name ?? rec.id);
  };

  const selectedRecord = useMemo(() => {
    if (!value) return null;
    return records.find((r) => String(r.id) === String(value)) || null;
  }, [value, records]);

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records;
    const lower = search.toLowerCase();
    return records.filter((r) => {
      const label = getRecordLabel(r).toLowerCase();
      const idStr = String(r.id).toLowerCase();
      return label.includes(lower) || idStr.includes(lower);
    });
  }, [records, search, targetEntity]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const displaySelectedText = selectedRecord
    ? getRecordLabel(selectedRecord)
    : value
    ? String(value)
    : '';

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      data-testid="searchable-select"
    >
      <div
        id={id}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className={`form-input${hasError ? ' is-invalid' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          backgroundColor: disabled ? 'var(--surface-2)' : 'var(--surface)',
          opacity: disabled ? 0.6 : 1,
          padding: 'var(--spacing-1) var(--spacing-2)',
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span
          style={{
            color: displaySelectedText ? 'var(--text)' : 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displaySelectedText || placeholder}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)', color: 'var(--text-muted)' }}>
          {value && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 'var(--spacing-1)',
                display: 'inline-flex',
                color: 'var(--text-muted)',
              }}
              aria-label="Clear selection"
            >
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} />
        </div>
      </div>

      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            backgroundColor: 'var(--surface)',
            border: 'var(--border-width-sm) solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: '220px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Search box inside dropdown */}
          <div
            style={{
              padding: 'var(--spacing-1) var(--spacing-2)',
              borderBottom: 'var(--border-width-sm) solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)',
            }}
          >
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              aria-label="Search options"
              style={{
                border: 'none',
                outline: 'none',
                width: '100%',
                fontSize: 'var(--font-size-xs)',
                backgroundColor: 'transparent',
                color: 'var(--text)',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Options list */}
          <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--spacing-1) 0' }}>
            {isLoading ? (
              <div style={{ padding: 'var(--spacing-2)', textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                Loading options...
              </div>
            ) : filteredRecords.length === 0 ? (
              <div style={{ padding: 'var(--spacing-2)', textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                No records found
              </div>
            ) : (
              filteredRecords.map((rec) => {
                const isSelected = String(rec.id) === String(value);
                return (
                  <div
                    key={rec.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(rec.id);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    style={{
                      padding: 'var(--spacing-1) var(--spacing-3)',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-xs)',
                      backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                      color: isSelected ? 'var(--accent)' : 'var(--text)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {getRecordLabel(rec)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
