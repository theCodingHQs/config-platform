import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatProps } from '@config-platform/schema';
import { useMetadata } from '../context/metadata-context';
import { fetchAggregate } from '../api/client';
import { BrokenBinding } from '../renderer/broken-binding';

export const StatComponent: React.FC<StatProps> = ({
  entityId,
  op = 'count',
  fieldId,
  filter,
  label,
  prefix = '',
  suffix = '',
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const entity = resolveEntity(entityId);
  const fieldDef = fieldId ? resolveField(fieldId) : undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ['aggregate', tenantId, entityId, op, fieldId, filter],
    queryFn: () =>
      fetchAggregate(tenantId, entityId, {
        op,
        field: fieldDef ? fieldDef.name : fieldId,
        filter,
      }),
    enabled: Boolean(tenantId && entityId),
  });

  if (!entity) {
    return <BrokenBinding type="entity" id={entityId} />;
  }

  const displayLabel = label || `${op.toUpperCase()}${fieldDef ? ` (${fieldDef.label})` : ''}`;
  const displayVal =
    data?.value !== null && data?.value !== undefined ? data.value.toLocaleString() : '—';

  return (
    <div
      className="stat-card"
      data-testid="stat-card"
      style={{
        padding: '1.25rem',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius, 8px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        boxShadow: 'var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
      }}
    >
      <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)' }}>
        {displayLabel}
      </div>
      <div
        data-testid="stat-value"
        style={{
          fontSize: '1.875rem',
          fontWeight: 700,
          color: 'var(--text)',
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
        }}
      >
        {isLoading ? '...' : `${prefix}${displayVal}${suffix}`}
      </div>
      {error && (
        <div style={{ fontSize: '0.75rem', color: 'var(--danger, #ef4444)' }}>
          {(error as any)?.message || 'Failed to load stat'}
        </div>
      )}
    </div>
  );
};
