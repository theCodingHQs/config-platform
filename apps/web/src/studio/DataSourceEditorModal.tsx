import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { DataSourceDefinition, ErdTable } from '@config-platform/schema';
import { ExpressionInput } from './ExpressionInput';

export interface DataSourceEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataSources: DataSourceDefinition[];
  entities: ErdTable[];
  onSave: (newDataSources: DataSourceDefinition[]) => void;
}

export const DataSourceEditorModal: React.FC<DataSourceEditorModalProps> = ({
  isOpen,
  onClose,
  dataSources = [],
  entities = [],
  onSave,
}) => {
  const [list, setList] = useState<DataSourceDefinition[]>(() => [...dataSources]);

  if (!isOpen) return null;

  const handleAdd = () => {
    const defaultEntityObj = entities[0];
    const defaultEntity = defaultEntityObj?.id || '';
    const id = defaultEntityObj ? `ds_${defaultEntityObj.name}` : `ds_${Date.now().toString(36)}`;
    setList([
      ...list,
      {
        id,
        entityId: defaultEntity,
        filter: {},
        limit: 50,
      },
    ]);
  };

  const handleRemove = (index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, updated: DataSourceDefinition) => {
    const next = [...list];
    next[index] = updated;
    setList(next);
  };

  const handleSave = () => {
    onSave(list);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-5)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: 'var(--border-width) solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderBottom: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text)' }}>Data Sources</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost"
            style={{ padding: 'var(--space-1)', display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--muted)', margin: 0 }}>
            Configure named data sources that fetch records and refetch when filter expressions change.
          </p>

          {list.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--font-size-sm)' }}>
              No data sources configured yet. Click "Add Data Source" to create one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {list.map((ds, idx) => {
                const entity = entities.find((e) => e.id === ds.entityId);
                const columns = entity?.columns || [];

                return (
                  <div
                    key={idx}
                    data-testid={`data-source-card-${idx}`}
                    style={{
                      border: 'var(--border-width) solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                      background: 'var(--surface-2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>Source ID</label>
                        <input
                          type="text"
                          aria-label={`Data Source ${idx + 1} ID`}
                          className="form-input"
                          value={ds.id}
                          placeholder="e.g. ds_items"
                          onChange={(e) => handleUpdate(idx, { ...ds, id: e.target.value })}
                          style={{ fontSize: 'var(--font-size-sm)' }}
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>Target Entity</label>
                        <select
                          aria-label={`Data Source ${idx + 1} Entity`}
                          className="form-select"
                          value={ds.entityId}
                          onChange={(e) => {
                            const newEntityId = e.target.value;
                            const nextEnt = entities.find((t) => t.id === newEntityId);
                            const prevEnt = entities.find((t) => t.id === ds.entityId);
                            const wasAutoGenerated = !ds.id || ds.id === `ds_${idx + 1}` || ds.id === 'ds_new' || (prevEnt && ds.id === `ds_${prevEnt.name}`);
                            const newId = (wasAutoGenerated && nextEnt) ? `ds_${nextEnt.name}` : ds.id;
                            handleUpdate(idx, { ...ds, id: newId, entityId: newEntityId, filter: {} });
                          }}
                          style={{ fontSize: 'var(--font-size-sm)' }}
                        >
                          <option value="">Select Entity</option>
                          {entities.map((ent) => (
                            <option key={ent.id} value={ent.id}>
                              {ent.label} ({ent.name})
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(idx)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 'var(--space-1)',
                          color: 'var(--danger)',
                          alignSelf: 'flex-end',
                        }}
                        aria-label="Delete Data Source"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Filter (Key-Values with Expressions) */}
                    <div>
                      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--muted)', marginBottom: 'var(--space-1)' }}>
                        Filter Criteria (Values can be <code>{'{{ state.<key> }}'}</code>)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {Object.entries(ds.filter || {}).map(([fKey, fVal], fIdx) => (
                          <div key={fIdx} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                            <select
                              className="form-select"
                              value={fKey}
                              onChange={(e) => {
                                const newKey = e.target.value;
                                const newFilter = { ...(ds.filter || {}) };
                                delete newFilter[fKey];
                                if (newKey) newFilter[newKey] = fVal;
                                handleUpdate(idx, { ...ds, filter: newFilter });
                              }}
                              style={{ width: '40%', fontSize: 'var(--font-size-xs)' }}
                            >
                              <option value="">Select Field</option>
                              {columns.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label} ({c.name})
                                </option>
                              ))}
                            </select>
                            <div style={{ flex: 1 }}>
                              <ExpressionInput
                                value={typeof fVal === 'string' ? fVal : String(fVal ?? '')}
                                placeholder="e.g. {{ state.selectedStatus }}"
                                onChange={(val) => {
                                  const newFilter = { ...(ds.filter || {}), [fKey]: val };
                                  handleUpdate(idx, { ...ds, filter: newFilter });
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newFilter = { ...(ds.filter || {}) };
                                delete newFilter[fKey];
                                handleUpdate(idx, { ...ds, filter: newFilter });
                              }}
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                              aria-label="Remove Filter"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            const availableCol = columns.find((c) => !(ds.filter || {})[c.id])?.id || columns[0]?.id || 'field';
                            const newFilter = { ...(ds.filter || {}), [availableCol]: '' };
                            handleUpdate(idx, { ...ds, filter: newFilter });
                          }}
                          style={{ alignSelf: 'flex-start', fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                        >
                          + Add Filter Field
                        </button>
                      </div>
                    </div>

                    {/* Limit and Sort */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
                      <div>
                        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>Limit</label>
                        <input
                          type="number"
                          className="form-input"
                          value={ds.limit || 50}
                          onChange={(e) => handleUpdate(idx, { ...ds, limit: Number(e.target.value) })}
                          style={{ fontSize: 'var(--font-size-xs)' }}
                        />
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>Sort Field</label>
                        <select
                          className="form-select"
                          value={ds.sort?.fieldId || ''}
                          onChange={(e) =>
                            handleUpdate(idx, {
                              ...ds,
                              sort: e.target.value
                                ? { fieldId: e.target.value, order: ds.sort?.order || 'asc' }
                                : undefined,
                            })
                          }
                          style={{ fontSize: 'var(--font-size-xs)' }}
                        >
                          <option value="">Default (id)</option>
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>Sort Direction</label>
                        <select
                          className="form-select"
                          value={ds.sort?.order || 'asc'}
                          disabled={!ds.sort?.fieldId}
                          onChange={(e) =>
                            handleUpdate(idx, {
                              ...ds,
                              sort: ds.sort
                                ? { ...ds.sort, order: e.target.value as 'asc' | 'desc' }
                                : undefined,
                            })
                          }
                          style={{ fontSize: 'var(--font-size-xs)' }}
                        >
                          <option value="asc">Ascending</option>
                          <option value="desc">Descending</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAdd}
            style={{ alignSelf: 'flex-start', fontSize: 'var(--font-size-sm)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Plus size={14} /> Add Data Source
          </button>
        </div>

        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 'var(--font-size-sm)' }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} style={{ fontSize: 'var(--font-size-sm)' }}>
            Save Data Sources
          </button>
        </div>
      </div>
    </div>
  );
};
