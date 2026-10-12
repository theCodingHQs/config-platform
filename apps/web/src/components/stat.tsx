import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatProps } from '@config-platform/schema';
import { useMetadata } from '../context/metadata-context';
import { fetchAggregate } from '../api/client';
import { BrokenBinding } from '../renderer/broken-binding';
import { DynamicIcon } from './dynamic-icon';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export const StatComponent: React.FC<StatProps> = ({
  entityId,
  op = 'count',
  fieldId,
  filter,
  label,
  prefix = '',
  suffix = '',
  icon,
  trend,
  trendValue,
  color,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
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

  const colorStyle = color && color !== 'default' ? `var(--${color})` : undefined;

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className="stat-card"
      data-testid="stat-card"
      style={{
        padding: 'var(--spacing-5)',
        backgroundColor: 'var(--surface)',
        border: 'var(--border-width-sm) solid var(--border)',
        borderRadius: 'var(--radius-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-2)',
        boxShadow: 'var(--shadow-sm)',
        position: 'relative',
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 500,
            color: 'var(--text-muted)',
          }}
        >
          {displayLabel}
        </span>
        {icon && (
          <div
            style={{
              color: colorStyle || 'var(--primary)',
              display: 'inline-flex',
            }}
          >
            <DynamicIcon name={icon} size={18} />
          </div>
        )}
      </div>

      <div
        data-testid="stat-value"
        style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 700,
          color: colorStyle || 'var(--text)',
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
        }}
      >
        {isLoading ? '...' : `${prefix}${displayVal}${suffix}`}
      </div>

      {trend && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            color:
              trend === 'up'
                ? 'var(--success)'
                : trend === 'down'
                ? 'var(--danger)'
                : 'var(--text-muted)',
          }}
        >
          {trend === 'up' ? (
            <TrendingUp size={14} />
          ) : trend === 'down' ? (
            <TrendingDown size={14} />
          ) : (
            <Minus size={14} />
          )}
          {trendValue && <span>{trendValue}</span>}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)' }}>
          {(error as any)?.message || 'Failed to load stat'}
        </div>
      )}
    </div>
  );
};
