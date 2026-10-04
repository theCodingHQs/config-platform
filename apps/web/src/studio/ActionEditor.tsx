import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { ActionDefinition, ActionType } from '@config-platform/schema';
import { ExpressionInput } from './ExpressionInput';

export interface ActionEditorProps {
  label: string;
  actions: ActionDefinition[];
  onChange: (actions: ActionDefinition[]) => void;
  availableModalKeys?: string[];
  availableDataSources?: string[];
}

const ACTION_TYPES: { type: ActionType; label: string }[] = [
  { type: 'setState', label: 'Set State' },
  { type: 'openModal', label: 'Open Modal' },
  { type: 'closeModal', label: 'Close Modal' },
  { type: 'navigate', label: 'Navigate' },
  { type: 'refetch', label: 'Refetch Data' },
  { type: 'showToast', label: 'Show Toast' },
  { type: 'createRecord', label: 'Create Record' },
  { type: 'updateRecord', label: 'Update Record' },
  { type: 'deleteRecord', label: 'Delete Record' },
  { type: 'confirm', label: 'Confirm Dialog' },
  { type: 'exportCsv', label: 'Export CSV' },
];

export const ActionEditor: React.FC<ActionEditorProps> = ({
  label,
  actions = [],
  onChange,
  availableModalKeys = [],
  availableDataSources = [],
}) => {
  const handleAddAction = () => {
    const newAction: ActionDefinition = {
      type: 'setState',
      params: { key: '', value: '' },
    };
    onChange([...actions, newAction]);
  };

  const handleUpdateAction = (index: number, updated: ActionDefinition) => {
    const next = [...actions];
    next[index] = updated;
    onChange(next);
  };

  const handleDeleteAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  const handleMoveAction = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= actions.length) return;
    const next = [...actions];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>{label}</label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddAction}
          style={{ fontSize: '0.6875rem', padding: '0.25rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
        >
          <Plus size={12} /> Add Action
        </button>
      </div>

      {actions.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.25rem 0' }}>
          No actions configured
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {actions.map((action, idx) => (
            <div
              key={idx}
              data-testid={`action-card-${idx}`}
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius, 6px)',
                padding: '0.625rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.375rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>#{idx + 1}</span>
                <select
                  aria-label={`Action ${idx + 1} Type`}
                  className="form-select"
                  value={action.type}
                  onChange={(e) => {
                    const newType = e.target.value as ActionType;
                    handleUpdateAction(idx, {
                      ...action,
                      type: newType,
                      params: getDefaultParams(newType),
                    });
                  }}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', flex: 1 }}
                >
                  {ACTION_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.125rem' }}>
                  <button
                    type="button"
                    onClick={() => handleMoveAction(idx, 'up')}
                    disabled={idx === 0}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, opacity: idx === 0 ? 0.3 : 1 }}
                    aria-label="Move Up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveAction(idx, 'down')}
                    disabled={idx === actions.length - 1}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, opacity: idx === actions.length - 1 ? 0.3 : 1 }}
                    aria-label="Move Down"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteAction(idx)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--danger, #ef4444)' }}
                    aria-label="Delete Action"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Condition (if) */}
              <ExpressionInput
                label="Condition (if)"
                value={action.if || ''}
                placeholder="e.g. {{ row.status === 'active' }}"
                onChange={(cond) => handleUpdateAction(idx, { ...action, if: cond || undefined })}
              />

              {/* Action Parameters */}
              <ActionParamsFields
                action={action}
                onChange={(params) => handleUpdateAction(idx, { ...action, params })}
                availableModalKeys={availableModalKeys}
                availableDataSources={availableDataSources}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function getDefaultParams(type: ActionType): Record<string, any> {
  switch (type) {
    case 'setState':
      return { key: '', value: '' };
    case 'openModal':
    case 'closeModal':
      return { modalKey: 'modal_open' };
    case 'navigate':
      return { url: '/' };
    case 'refetch':
      return { source: '' };
    case 'showToast':
      return { message: 'Operation completed successfully', variant: 'success' };
    case 'createRecord':
      return { entityId: '', data: {} };
    case 'updateRecord':
      return { entityId: '', id: '', data: {} };
    case 'deleteRecord':
      return { entityId: '', id: '' };
    case 'confirm':
      return { title: 'Confirmation', message: 'Are you sure you want to proceed?', confirmLabel: 'Confirm', cancelLabel: 'Cancel' };
    case 'exportCsv':
      return { filename: 'export.csv' };
    default:
      return {};
  }
}

function ActionParamsFields({
  action,
  onChange,
  availableModalKeys,
  availableDataSources,
}: {
  action: ActionDefinition;
  onChange: (params: Record<string, any>) => void;
  availableModalKeys: string[];
  availableDataSources: string[];
}) {
  const params = action.params || {};

  switch (action.type) {
    case 'setState':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>State Key</label>
            <input
              type="text"
              aria-label="State Key"
              className="form-input"
              value={params.key || ''}
              placeholder="e.g. selectedId"
              onChange={(e) => onChange({ ...params, key: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <div>
            <ExpressionInput
              label="Value"
              value={typeof params.value === 'string' ? params.value : JSON.stringify(params.value || '')}
              placeholder="e.g. {{ row.id }}"
              onChange={(val) => onChange({ ...params, value: val })}
            />
          </div>
        </div>
      );

    case 'openModal':
    case 'closeModal':
      return (
        <div>
          <label className="form-label" style={{ fontSize: '0.6875rem' }}>Modal State Key</label>
          <input
            type="text"
            aria-label="Modal State Key"
            className="form-input"
            value={params.modalKey || ''}
            placeholder="e.g. modal_details_open"
            onChange={(e) => onChange({ ...params, modalKey: e.target.value })}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
          />
        </div>
      );

    case 'navigate':
      return (
        <div>
          <ExpressionInput
            label="URL / Path"
            value={params.url || ''}
            placeholder="e.g. /items/{{ row.id }}"
            onChange={(url) => onChange({ ...params, url })}
          />
        </div>
      );

    case 'refetch':
      return (
        <div>
          <label className="form-label" style={{ fontSize: '0.6875rem' }}>Data Source to Refetch</label>
          <input
            type="text"
            aria-label="Data Source to Refetch"
            className="form-input"
            value={params.source || ''}
            placeholder="Leave empty to refetch all"
            onChange={(e) => onChange({ ...params, source: e.target.value })}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
          />
        </div>
      );

    case 'showToast':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.375rem' }}>
          <div>
            <ExpressionInput
              label="Toast Message"
              value={params.message || ''}
              placeholder="e.g. Record {{ row.id }} updated!"
              onChange={(message) => onChange({ ...params, message })}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Variant</label>
            <select
              aria-label="Toast Variant"
              className="form-select"
              value={params.variant || 'success'}
              onChange={(e) => onChange({ ...params, variant: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            >
              <option value="success">Success</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
      );

    case 'createRecord':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Target Entity ID</label>
            <input
              type="text"
              aria-label="Target Entity ID"
              className="form-input"
              value={params.entityId || ''}
              placeholder="e.g. entity_id"
              onChange={(e) => onChange({ ...params, entityId: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <ExpressionInput
            label="Record Data (JSON or Expression)"
            value={typeof params.data === 'string' ? params.data : JSON.stringify(params.data || {})}
            placeholder='e.g. {"name": "{{ state.name }}"}'
            onChange={(data) => {
              try {
                onChange({ ...params, data: JSON.parse(data) });
              } catch {
                onChange({ ...params, data });
              }
            }}
          />
        </div>
      );

    case 'updateRecord':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.6875rem' }}>Target Entity ID</label>
              <input
                type="text"
                aria-label="Target Entity ID"
                className="form-input"
                value={params.entityId || ''}
                placeholder="e.g. entity_id"
                onChange={(e) => onChange({ ...params, entityId: e.target.value })}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              />
            </div>
            <div>
              <ExpressionInput
                label="Record ID"
                value={params.id || ''}
                placeholder="e.g. {{ row.id }}"
                onChange={(id) => onChange({ ...params, id })}
              />
            </div>
          </div>
          <ExpressionInput
            label="Update Data (JSON or Expression)"
            value={typeof params.data === 'string' ? params.data : JSON.stringify(params.data || {})}
            placeholder='e.g. {"status": "inactive"}'
            onChange={(data) => {
              try {
                onChange({ ...params, data: JSON.parse(data) });
              } catch {
                onChange({ ...params, data });
              }
            }}
          />
        </div>
      );

    case 'deleteRecord':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Entity ID</label>
            <input
              type="text"
              aria-label="Target Entity ID"
              className="form-input"
              value={params.entityId || ''}
              placeholder="e.g. entity_id"
              onChange={(e) => onChange({ ...params, entityId: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <div>
            <ExpressionInput
              label="Record ID"
              value={params.id || ''}
              placeholder="e.g. {{ row.id }}"
              onChange={(id) => onChange({ ...params, id })}
            />
          </div>
        </div>
      );

    case 'confirm':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Title</label>
            <input
              type="text"
              aria-label="Confirm Title"
              className="form-input"
              value={params.title || ''}
              placeholder="e.g. Confirm Delete"
              onChange={(e) => onChange({ ...params, title: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Message</label>
            <input
              type="text"
              aria-label="Confirm Message"
              className="form-input"
              value={params.message || ''}
              placeholder="e.g. Are you sure you want to delete this record?"
              onChange={(e) => onChange({ ...params, message: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.6875rem' }}>Confirm Button Label</label>
              <input
                type="text"
                aria-label="Confirm Label"
                className="form-input"
                value={params.confirmLabel || ''}
                placeholder="Confirm"
                onChange={(e) => onChange({ ...params, confirmLabel: e.target.value })}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.6875rem' }}>Cancel Button Label</label>
              <input
                type="text"
                aria-label="Cancel Label"
                className="form-input"
                value={params.cancelLabel || ''}
                placeholder="Cancel"
                onChange={(e) => onChange({ ...params, cancelLabel: e.target.value })}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              />
            </div>
          </div>
        </div>
      );

    case 'exportCsv':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Data Source (optional)</label>
            <select
              className="form-select"
              value={params.source || ''}
              onChange={(e) => onChange({ ...params, source: e.target.value || undefined })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            >
              <option value="">None (Fetch by Entity)</option>
              {availableDataSources.map((ds) => (
                <option key={ds} value={ds}>{ds}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Entity ID</label>
            <input
              type="text"
              className="form-input"
              value={params.entityId || ''}
              placeholder="e.g. t_4befbc3a"
              onChange={(e) => onChange({ ...params, entityId: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: '0.6875rem' }}>Filename</label>
            <input
              type="text"
              className="form-input"
              value={params.filename || ''}
              placeholder="e.g. telemetry_export.csv"
              onChange={(e) => onChange({ ...params, filename: e.target.value })}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}
