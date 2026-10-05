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
        padding: 'var(--spacing-5)',
        backgroundColor: 'var(--surface)',
        border: 'var(--border-width-sm) solid var(--border)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-2)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--text-muted)' }}>
        {displayLabel}
      </div>
      <div
        data-testid="stat-value"
        style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 700,
          color: 'var(--text)',
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
        }}
      >
        {isLoading ? '...' : `${prefix}${displayVal}${suffix}`}
      </div>
      {error && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)' }}>
          {(error as any)?.message || 'Failed to load stat'}
        </div>
      )}
    </div>
  );
};
