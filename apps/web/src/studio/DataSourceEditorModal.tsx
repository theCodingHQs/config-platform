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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius, 8px)',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.4), 0 10px 10px -5px rgba(0,0,0,0.2)',
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Data Sources</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost"
            style={{ padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Configure named data sources that fetch records and refetch when filter expressions change.
          </p>

          {list.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No data sources configured yet. Click "Add Data Source" to create one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {list.map((ds, idx) => {
                const entity = entities.find((e) => e.id === ds.entityId);
                const columns = entity?.columns || [];

                return (
                  <div
                    key={idx}
                    data-testid={`data-source-card-${idx}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 14,
                      background: 'var(--surface-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: 12, marginBottom: 2 }}>Source ID</label>
                        <input
                          type="text"
                          aria-label={`Data Source ${idx + 1} ID`}
                          className="form-input"
                          value={ds.id}
                          placeholder="e.g. ds_items"
                          onChange={(e) => handleUpdate(idx, { ...ds, id: e.target.value })}
                          style={{ fontSize: 13, padding: '4px 8px' }}
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: 12, marginBottom: 2 }}>Target Entity</label>
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
                          style={{ fontSize: 13, padding: '4px 8px' }}
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
                          padding: 6,
                          color: 'var(--danger, #ef4444)',
                          alignSelf: 'flex-end',
                        }}
                        aria-label="Delete Data Source"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Filter (Key-Values with Expressions) */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                        Filter Criteria (Values can be <code>{'{{ state.<key> }}'}</code>)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {Object.entries(ds.filter || {}).map(([fKey, fVal], fIdx) => (
                          <div key={fIdx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                              style={{ width: '40%', fontSize: 12, padding: '4px 8px' }}
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
                          style={{ alignSelf: 'flex-start', fontSize: 11, padding: '2px 6px' }}
                        >
                          + Add Filter Field
                        </button>
                      </div>
                    </div>

                    {/* Limit and Sort */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <label className="form-label" style={{ fontSize: 11, marginBottom: 2 }}>Limit</label>
                        <input
                          type="number"
                          className="form-input"
                          value={ds.limit || 50}
                          onChange={(e) => handleUpdate(idx, { ...ds, limit: Number(e.target.value) })}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        />
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: 11, marginBottom: 2 }}>Sort Field</label>
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
                          style={{ fontSize: 12, padding: '4px 8px' }}
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
                        <label className="form-label" style={{ fontSize: 11, marginBottom: 2 }}>Sort Direction</label>
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
                          style={{ fontSize: 12, padding: '4px 8px' }}
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
            style={{ alignSelf: 'flex-start', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={14} /> Add Data Source
          </button>
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 13 }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} style={{ fontSize: 13 }}>
            Save Data Sources
          </button>
        </div>
      </div>
    </div>
  );
};
