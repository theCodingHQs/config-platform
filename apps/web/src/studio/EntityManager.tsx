import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMetadata } from '../context/metadata-context';
import {
  fetchSchemaEntities,
  createEntity,
  updateEntity,
  deleteEntity,
  addField,
  updateField,
  deleteField,
  reorderFields,
  fetchLiveErd,
  fetchLiveDdl,
  ApiError,
} from '../api/client';
import { Plus, X, AlertTriangle, ChevronUp, ChevronDown, Edit2, Upload, FileSpreadsheet, LayoutGrid } from 'lucide-react';
import type { ErdTable, ErdColumn, FieldType } from '@config-platform/schema';
import { DynamicIcon } from '../components/dynamic-icon';
import { IconPicker } from '../components/icon-picker';
import { useStatusNotify } from '../context/app-bar-context';
import { ImportDataModal } from './ImportDataModal';
import { FormulaEditor, canBeCalculated } from './FormulaEditor';
import { UniqueRulesPanel } from './UniqueRulesPanel';
import { ImportWizard } from './ImportWizard';
import { TemplateGallery } from './TemplateGallery';

export const EntityManager: React.FC = () => {
  const { tenantId } = useMetadata();
  const queryClient = useQueryClient();

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditEntityModal, setShowEditEntityModal] = useState(false);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingField, setEditingField] = useState<ErdColumn | null>(null);
  const [activeSideTab, setActiveSideTab] = useState<'none' | 'erd' | 'ddl'>('none');
  // Action errors go to the status bar (visible above open dialogs too)
  const notify = useStatusNotify();

  // Form states
  const [newEntityLabel, setNewEntityLabel] = useState('');
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityIcon, setNewEntityIcon] = useState('User');

  const [editEntityLabel, setEditEntityLabel] = useState('');
  const [editEntityIcon, setEditEntityIcon] = useState('Database');

  const [fieldName, setFieldName] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldSelectOptions, setFieldSelectOptions] = useState('Option 1, Option 2');
  const [fieldRefTarget, setFieldRefTarget] = useState('');
  /** Date fields: a calendar date, a month, or a moment (date & time). */
  const [fieldDateKind, setFieldDateKind] = useState<DateKind>('day');
  /** Calculated field formula; null = the value is entered by people. */
  const [fieldFormula, setFieldFormula] = useState<string | null>(null);

  // Queries
  const { data: entities = [], isLoading, refetch } = useQuery<ErdTable[]>({
    queryKey: ['schema-entities', tenantId],
    queryFn: () => fetchSchemaEntities(tenantId),
  });

  const { data: liveErd } = useQuery({
    queryKey: ['live-erd', tenantId],
    queryFn: () => fetchLiveErd(tenantId),
    enabled: activeSideTab === 'erd',
  });

  const { data: liveDdl } = useQuery<string>({
    queryKey: ['live-ddl', tenantId],
    queryFn: () => fetchLiveDdl(tenantId),
    enabled: activeSideTab === 'ddl',
  });

  const selectedEntity = entities.find((e) => e.id === selectedEntityId) || entities[0];

  // Helper to slugify & suggest icon
  const handleLabelChange = (lbl: string) => {
    setNewEntityLabel(lbl);
    setNewEntityName(lbl.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    const lower = lbl.toLowerCase();
    if (lower.includes('user') || lower.includes('customer') || lower.includes('member') || lower.includes('person') || lower.includes('author')) {
      setNewEntityIcon('User');
    } else if (lower.includes('dept') || lower.includes('department') || lower.includes('company') || lower.includes('org') || lower.includes('office')) {
      setNewEntityIcon('Building2');
    } else if (lower.includes('prod') || lower.includes('item') || lower.includes('inventory') || lower.includes('box')) {
      setNewEntityIcon('Package');
    } else if (lower.includes('order') || lower.includes('cart') || lower.includes('purchase')) {
      setNewEntityIcon('ShoppingCart');
    } else if (lower.includes('pay') || lower.includes('invoice') || lower.includes('billing')) {
      setNewEntityIcon('CreditCard');
    } else if (lower.includes('event') || lower.includes('schedule') || lower.includes('calendar')) {
      setNewEntityIcon('Calendar');
    } else if (lower.includes('task') || lower.includes('todo') || lower.includes('ticket')) {
      setNewEntityIcon('CheckSquare');
    } else if (lower.includes('doc') || lower.includes('post') || lower.includes('article')) {
      setNewEntityIcon('FileText');
    }
  };

  const handleFieldLabelChange = (lbl: string) => {
    setFieldLabel(lbl);
    if (!editingField) {
      setFieldName(lbl.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    }
  };

  // Mutations
  const createEntityMut = useMutation({
    mutationFn: () =>
      createEntity(tenantId, {
        label: newEntityLabel,
        name: newEntityName || newEntityLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        icon: newEntityIcon,
      }),
    onSuccess: (res) => {
      setShowCreateModal(false);
      setNewEntityLabel('');
      setNewEntityName('');
      setNewEntityIcon('User');
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
      setSelectedEntityId(res.entityId || res.id);
    },
    onError: (err: any) => notify("error", err.message),
  });

  const deleteEntityMut = useMutation({
    mutationFn: (e: ErdTable) => deleteEntity(tenantId, e.id, e.version),
    onSuccess: () => {
      setSelectedEntityId(null);
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const updateDisplayFieldMut = useMutation({
    mutationFn: (displayFieldId: string | null) => {
      if (!selectedEntity) throw new Error('No entity selected');
      return updateEntity(tenantId, selectedEntity.id, {
        expectedVersion: selectedEntity.version,
        displayFieldId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const updateEntityMut = useMutation({
    mutationFn: () => {
      if (!selectedEntity) throw new Error('No entity selected');
      return updateEntity(tenantId, selectedEntity.id, {
        label: editEntityLabel,
        icon: editEntityIcon,
        expectedVersion: selectedEntity.version,
      });
    },
    onSuccess: () => {
      setShowEditEntityModal(false);
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const openEditEntityModal = () => {
    if (!selectedEntity) return;
    setEditEntityLabel(selectedEntity.label);
    setEditEntityIcon(selectedEntity.icon || 'Database');
    setShowEditEntityModal(true);
  };

  const addFieldMut = useMutation({
    mutationFn: () => {
      if (!selectedEntity) throw new Error('No entity selected');
      let config: any = {};
      if (fieldType === 'select') {
        config.options = fieldSelectOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => ({ label: v, value: v }));
      } else if (fieldType === 'reference') {
        config.targetEntityId = fieldRefTarget;
      } else if (fieldType === 'date') {
        config = dateKindToConfig(fieldDateKind, config);
      }
      if (canBeCalculated(fieldType)) {
        if (fieldFormula !== null) config.formula = fieldFormula.trim();
        else delete config.formula;
      }
      return addField(tenantId, selectedEntity.id, {
        name: fieldName,
        label: fieldLabel,
        type: fieldType,
        required: fieldRequired,
        config,
        expectedVersion: selectedEntity.version,
      });
    },
    onSuccess: () => {
      setShowAddFieldModal(false);
      resetFieldForm();
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const updateFieldMut = useMutation({
    mutationFn: () => {
      if (!selectedEntity || !editingField) throw new Error('Missing selection');
      let config: any = { ...(editingField.config || {}) };
      if (fieldType === 'select') {
        config.options = fieldSelectOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => ({ label: v, value: v }));
      } else if (fieldType === 'reference') {
        config.targetEntityId = fieldRefTarget;
      } else if (fieldType === 'date') {
        config = dateKindToConfig(fieldDateKind, config);
      }
      if (canBeCalculated(fieldType)) {
        if (fieldFormula !== null) config.formula = fieldFormula.trim();
        else delete config.formula;
      }
      return updateField(tenantId, selectedEntity.id, editingField.id, {
        label: fieldLabel,
        name: fieldName,
        config,
        expectedVersion: selectedEntity.version,
      });
    },
    onSuccess: () => {
      setEditingField(null);
      resetFieldForm();
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const deleteFieldMut = useMutation({
    mutationFn: (fieldId: string) => {
      if (!selectedEntity) throw new Error('No entity selected');
      return deleteField(tenantId, selectedEntity.id, fieldId, selectedEntity.version);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        refetch();
      }
      notify("error", err.message);
    },
  });

  const reorderFieldsMut = useMutation({
    mutationFn: (fieldIds: string[]) => {
      if (!selectedEntity) throw new Error('No entity selected');
      return reorderFields(tenantId, selectedEntity.id, fieldIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
    },
    onError: (err: any) => notify("error", err.message),
  });

  const handleMoveField = (fieldId: string, direction: 'up' | 'down') => {
    if (!selectedEntity) return;
    const customFields = (selectedEntity.columns || []).filter(
      (c) => !['id', 'created_at', 'updated_at'].includes(c.id)
    );
    const idx = customFields.findIndex((c) => c.id === fieldId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === customFields.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const reordered = [...customFields];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    reorderFieldsMut.mutate(reordered.map((c) => c.id));
  };

  const resetFieldForm = () => {
    setFieldName('');
    setFieldLabel('');
    setFieldType('text');
    setFieldRequired(false);
    setFieldSelectOptions('Option 1, Option 2');
    setFieldRefTarget('');
    setFieldDateKind('day');
    setFieldFormula(null);
  };

  const openEditFieldModal = (f: ErdColumn) => {
    setEditingField(f);
    setFieldLabel(f.label);
    setFieldName(f.name);
    setFieldType(f.type);
    setFieldRequired(f.required);
    if (f.type === 'select' && f.config?.options) {
      setFieldSelectOptions(f.config.options.map((o: any) => o.label || o.value).join(', '));
    } else {
      setFieldSelectOptions('Option 1, Option 2');
    }
    if (f.type === 'reference') {
      setFieldRefTarget(f.references?.entityId || f.config?.targetEntityId || '');
    } else {
      setFieldRefTarget('');
    }
    setFieldDateKind(dateKindOf(f.config));
    setFieldFormula(f.config?.formula ?? null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* Top action header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: "var(--font-size-2xl)" }}>Data Entities</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: "var(--font-size-sm)" }}>
            Catalog metadata management. Tables and columns use stable immutable IDs.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setActiveSideTab(activeSideTab === 'erd' ? 'none' : 'erd')}
          >
            {activeSideTab === 'erd' ? 'Hide ERD' : 'View ERD'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setActiveSideTab(activeSideTab === 'ddl' ? 'none' : 'ddl')}
          >
            {activeSideTab === 'ddl' ? 'Hide DDL' : 'View Live DDL'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowTemplates(true)}>
            <LayoutGrid size="1.1em" /> Templates
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowImportWizard(true)}
          >
            <FileSpreadsheet size="1.1em" /> New from Excel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            aria-label="+ Create Entity"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <Plus size={14} /> Create Entity
          </button>
        </div>
      </div>

      {/* Main Layout: Left entity list, center entity fields, right schema panel */}
      <div style={{ display: 'grid', gridTemplateColumns: activeSideTab !== 'none' ? '240px 1fr 340px' : '240px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left: Entities list */}
        <div
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-surface)',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <div style={{ padding: '0.25rem 0.5rem', fontSize: "var(--font-size-xs)", fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Entities ({entities.length})
          </div>
          {isLoading && <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: "var(--font-size-sm)" }}>Loading...</div>}
          {entities.map((e) => {
            const isSelected = selectedEntity?.id === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setSelectedEntityId(e.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-control)',
                  backgroundColor: isSelected ? 'var(--surface-subtle)' : 'transparent',
                  border: isSelected ? '1px solid var(--border)' : '1px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <div
                    style={{
                      width: 'var(--control-height-sm)',
                      height: 'var(--control-height-sm)',
                      borderRadius: 'var(--radius-control)',
                      backgroundColor: 'var(--primary-subtle)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <DynamicIcon name={e.icon || 'Database'} size={15} />
                  </div>
                  <div>
                    <div style={{ fontWeight: isSelected ? 600 : 500, fontSize: "var(--font-size-sm)", color: 'var(--text)' }}>
                      {e.label}
                    </div>
                    <div style={{ fontSize: "var(--font-size-xs)", color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {e.id}
                    </div>
                  </div>
                </div>
                <span className="badge" style={{ fontSize: "var(--font-size-xs)" }}>v{e.version}</span>
              </button>
            );
          })}
        </div>

        {/* Center: Selected entity details & fields */}
        {selectedEntity ? (
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-surface)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    onClick={openEditEntityModal}
                    title="Click to edit entity icon & label"
                    style={{
                      width: 'var(--control-height-md)',
                      height: 'var(--control-height-md)',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: 'var(--primary-subtle)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <DynamicIcon name={selectedEntity.icon || 'Database'} size={20} />
                  </div>
                  <h2 style={{ fontSize: "var(--font-size-xl)", margin: 0 }}>{selectedEntity.label}</h2>
                  <span className="badge">v{selectedEntity.version}</span>
                </div>
                <div style={{ fontSize: "var(--font-size-sm)", color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Slug: <code style={{ backgroundColor: 'var(--surface-subtle)', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-sm)' }}>{selectedEntity.name}</code> | Physical Table: <code style={{ backgroundColor: 'var(--surface-subtle)', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-sm)' }}>{selectedEntity.physicalTableName}</code>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <label htmlFor="entity-display-field" style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: 'var(--text-muted)' }}>
                    Display Field:
                  </label>
                  <select
                    id="entity-display-field"
                    aria-label="Display Field"
                    className="form-select"
                    value={selectedEntity.displayFieldId || ''}
                    disabled={updateDisplayFieldMut.isPending}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      updateDisplayFieldMut.mutate(val);
                    }}
                    style={{ fontSize: "var(--font-size-sm)", padding: '0.2rem 0.5rem', width: 'auto' }}
                  >
                    <option value="">Default (name / title / id)</option>
                    {(selectedEntity.columns || []).map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label} ({col.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={openEditEntityModal}
                  aria-label="Edit Entity"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Edit2 size={14} /> Edit Entity
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowImportModal(true)}
                  aria-label="Import Data"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Upload size={14} /> Import
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddFieldModal(true)}
                  aria-label="+ Add Field"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Plus size={14} /> Add Field
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => {
                    if (confirm(`Delete entity "${selectedEntity.label}"? All records will be dropped.`)) {
                      deleteEntityMut.mutate(selectedEntity);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Fields table */}
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Slug</th>
                    <th>Type</th>
                    <th>Stable ID</th>
                    <th>Required</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const customFields = (selectedEntity.columns || []).filter(
                      (c) => !['id', 'created_at', 'updated_at'].includes(c.id)
                    );
                    return (selectedEntity.columns || []).map((col) => {
                      const isSystem = ['id', 'created_at', 'updated_at'].includes(col.id);
                      const customIdx = customFields.findIndex((c) => c.id === col.id);
                      return (
                        <tr key={col.id}>
                          <td style={{ fontWeight: 500 }}>{col.label}</td>
                          <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: "var(--font-size-sm)" }}>{col.name}</td>
                          <td>
                            <span className="badge">{FIELD_TYPE_LABELS[col.type] ?? col.type}</span>
                            {col.config?.formula && (
                              <span className="badge badge-success" title={col.config.formula} style={{ marginLeft: 'var(--space-1)' }}>
                                Calculated
                              </span>
                            )}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: "var(--font-size-xs)" }}>{col.id}</td>
                          <td>{col.required ? <span className="badge badge-success">Required</span> : <span style={{ color: 'var(--text-muted)' }}>Optional</span>}</td>
                          <td style={{ textAlign: 'right' }}>
                            {!isSystem && (
                              <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.2rem 0.35rem', display: 'inline-flex', alignItems: 'center' }}
                                  disabled={customIdx <= 0 || reorderFieldsMut.isPending}
                                  onClick={() => handleMoveField(col.id, 'up')}
                                  title="Move Up"
                                  aria-label="Move Up"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.2rem 0.35rem', display: 'inline-flex', alignItems: 'center' }}
                                  disabled={customIdx === -1 || customIdx >= customFields.length - 1 || reorderFieldsMut.isPending}
                                  onClick={() => handleMoveField(col.id, 'down')}
                                  title="Move Down"
                                  aria-label="Move Down"
                                >
                                  <ChevronDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: "var(--font-size-xs)" }}
                                  onClick={() => openEditFieldModal(col)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: "var(--font-size-xs)", color: 'var(--danger)' }}
                                  onClick={() => {
                                    if (confirm(`Delete field "${col.label}"?`)) {
                                      deleteFieldMut.mutate(col.id);
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                            {isSystem && <span style={{ fontSize: "var(--font-size-xs)", color: 'var(--text-muted)' }}>System</span>}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            <UniqueRulesPanel entity={selectedEntity} tenantId={tenantId} />
          </div>
        ) : entities.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px dashed var(--border)',
              borderRadius: 'var(--radius-surface)',
              padding: '3rem 2rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              maxWidth: '560px',
              margin: '2rem auto',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-control)',
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plus size={24} />
            </div>
            <h3 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600, margin: 0 }}>
              Welcome to Your New Workspace
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: "var(--font-size-sm)", lineHeight: 1.6, margin: 0 }}>
              Workspaces start clean with no entities or pages.
              <br />
              <strong>Step 1:</strong> Install a ready-made template, start from an Excel sheet you already use, or create a Data Entity (e.g. Products, Customers, Orders) and its fields.
              <br />
              <strong>Step 2:</strong> Go to <em>Pages</em> in the top navigation to build and publish views bound to your entities.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
              style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Plus size={16} /> Create Your First Entity
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowImportWizard(true)}
            >
              <FileSpreadsheet size="1.1em" /> Start from an Excel sheet
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowTemplates(true)}>
              <LayoutGrid size="1.1em" /> Start from a template
            </button>
          </div>
        ) : (
          <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Select an entity from the list to view and edit its schema.
          </div>
        )}

        {/* Right side panel: Live ERD or Live DDL */}
        {activeSideTab !== 'none' && (
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-surface)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: "var(--font-size-sm)" }}>
                {activeSideTab === 'erd' ? 'Live ERD Model' : 'Live Projected DDL'}
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '0.25rem', display: 'inline-flex', alignItems: 'center' }}
                onClick={() => setActiveSideTab('none')}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {activeSideTab === 'erd' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {liveErd?.tables?.map((table: any) => (
                  <div key={table.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-surface)', padding: '0.75rem' }}>
                    <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{table.label} ({table.physicalTableName})</div>
                    <ul style={{ paddingLeft: '1rem', fontSize: "var(--font-size-xs)", marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      {table.columns.map((c: any) => (
                        <li key={c.id}>
                          {c.label} (<span style={{ fontFamily: 'monospace' }}>{c.type}</span>)
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {activeSideTab === 'ddl' && (
              <pre
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontFamily: 'monospace',
                  backgroundColor: 'var(--surface-subtle)',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-control)',
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                }}
              >
                {liveDdl || 'Loading DDL...'}
              </pre>
            )}
          </div>
        )}
      </div>

      {showTemplates && (
        <TemplateGallery
          tenantId={tenantId}
          onClose={() => setShowTemplates(false)}
          onInstalled={(result) => {
            // The template's main entity is listed last (shared ones like Machine come first)
            const main = result.entities[result.entities.length - 1];
            if (main) setSelectedEntityId(main.id);
          }}
        />
      )}

      {showImportWizard && (
        <ImportWizard
          tenantId={tenantId}
          onClose={() => setShowImportWizard(false)}
          onCreated={(result) => setSelectedEntityId(result.entityId)}
        />
      )}

      {/* Modal: Create Entity */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 'var(--space-4)' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '420px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)', maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Create Entity</h3>
            <div>
              <label className="form-label" htmlFor="new-entity-label" style={{ fontSize: 'var(--font-size-xs)' }}>Display Label</label>
              <input
                id="new-entity-label"
                type="text"
                className="form-input"
                placeholder="e.g. Customer, Order, Department"
                value={newEntityLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="form-label" htmlFor="new-entity-name" style={{ fontSize: 'var(--font-size-xs)' }}>Slug / Name</label>
              <input
                id="new-entity-name"
                type="text"
                className="form-input"
                placeholder="e.g. customer, order, department"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
              />
            </div>
            <div>
              <IconPicker
                value={newEntityIcon}
                onChange={setNewEntityIcon}
                label="Entity Icon"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!newEntityLabel} onClick={() => createEntityMut.mutate()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Entity */}
      {showEditEntityModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 'var(--space-4)' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '420px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)', maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Edit Entity</h3>
            <div>
              <label className="form-label" htmlFor="edit-entity-label" style={{ fontSize: 'var(--font-size-xs)' }}>Display Label</label>
              <input
                id="edit-entity-label"
                type="text"
                className="form-input"
                value={editEntityLabel}
                onChange={(e) => setEditEntityLabel(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <IconPicker
                value={editEntityIcon}
                onChange={setEditEntityIcon}
                label="Entity Icon"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowEditEntityModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!editEntityLabel || updateEntityMut.isPending}
                onClick={() => updateEntityMut.mutate()}
              >
                {updateEntityMut.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Field */}
      {showAddFieldModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 'var(--space-4)' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '450px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)', maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Add Field to {selectedEntity?.label}</h3>
            <div>
              <label className="form-label" htmlFor="add-field-label" style={{ fontSize: 'var(--font-size-xs)' }}>Field Label</label>
              <input
                id="add-field-label"
                type="text"
                className="form-input"
                value={fieldLabel}
                onChange={(e) => handleFieldLabelChange(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="form-label" htmlFor="add-field-slug" style={{ fontSize: 'var(--font-size-xs)' }}>Field Slug</label>
              <input
                id="add-field-slug"
                type="text"
                className="form-input"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="add-field-type" style={{ fontSize: 'var(--font-size-xs)' }}>Type</label>
              <select id="add-field-type" className="form-select" value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
                <option value="reference">Reference</option>
              </select>
            </div>

            {fieldType === 'select' && (
              <div>
                <label className="form-label" htmlFor="add-field-options" style={{ fontSize: 'var(--font-size-xs)' }}>Select Options (comma-separated)</label>
                <input
                  id="add-field-options"
                  type="text"
                  className="form-input"
                  value={fieldSelectOptions}
                  onChange={(e) => setFieldSelectOptions(e.target.value)}
                />
              </div>
            )}

            {fieldType === 'date' && (
              <DateKindField id="add-field-date-kind" value={fieldDateKind} onChange={setFieldDateKind} />
            )}

            <FormulaEditor
              idPrefix="add-field"
              fieldType={fieldType}
              formula={fieldFormula}
              onChange={setFieldFormula}
              otherFields={selectedEntity?.columns ?? []}
            />

            {fieldType === 'reference' && (
              <div>
                <label className="form-label" htmlFor="add-field-target" style={{ fontSize: 'var(--font-size-xs)' }}>Target Entity</label>
                <select id="add-field-target" className="form-select" value={fieldRefTarget} onChange={(e) => setFieldRefTarget(e.target.value)}>
                  <option value="">Select Target Entity</option>
                  {entities.filter((e) => e.id !== selectedEntity?.id).map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                <input type="checkbox" checked={fieldRequired} onChange={(e) => setFieldRequired(e.target.checked)} />
                <span>Required Field</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowAddFieldModal(false); resetFieldForm(); }}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!fieldLabel || !fieldName} onClick={() => addFieldMut.mutate()}>Add Field</button>
            </div>
          </div>
        </div>
      )}

      {editingField && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 'var(--space-4)' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '420px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)', maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Edit Field: {editingField.label}</h3>
            <div>
              <label className="form-label" htmlFor="edit-field-label" style={{ fontSize: 'var(--font-size-xs)' }}>Field Label</label>
              <input
                id="edit-field-label"
                type="text"
                className="form-input"
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="form-label" htmlFor="edit-field-slug" style={{ fontSize: 'var(--font-size-xs)' }}>Field Slug</label>
              <input
                id="edit-field-slug"
                type="text"
                className="form-input"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
              />
            </div>
            {editingField.type === 'date' && (
              <DateKindField
                id="edit-field-date-kind"
                value={fieldDateKind}
                onChange={setFieldDateKind}
                // DATE and TIMESTAMPTZ are different columns: only Date ⇄ Month can switch in place
                lockedToDateTime={dateKindOf(editingField.config) === 'datetime'}
              />
            )}
            <FormulaEditor
              idPrefix="edit-field"
              fieldType={editingField.type}
              formula={fieldFormula}
              onChange={setFieldFormula}
              otherFields={(selectedEntity?.columns ?? []).filter((c) => c.id !== editingField.id)}
            />
            {editingField.type === 'select' && (
              <div>
                <label className="form-label" htmlFor="edit-field-options" style={{ fontSize: 'var(--font-size-xs)' }}>Select Options (comma-separated)</label>
                <input
                  id="edit-field-options"
                  type="text"
                  className="form-input"
                  value={fieldSelectOptions}
                  onChange={(e) => setFieldSelectOptions(e.target.value)}
                />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingField(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => updateFieldMut.mutate()}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
      {/* Import Data Modal */}
      {selectedEntity && (
        <ImportDataModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          entity={selectedEntity}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['schema-entities', tenantId] });
          }}
        />
      )}
    </div>
  );
};

type DateKind = 'day' | 'month' | 'datetime';

function dateKindOf(config: any): DateKind {
  if (config?.includeTime) return 'datetime';
  return config?.granularity === 'month' ? 'month' : 'day';
}

function dateKindToConfig(kind: DateKind, config: Record<string, any>): Record<string, any> {
  const { includeTime: _t, granularity: _g, ...rest } = config;
  if (kind === 'datetime') return { ...rest, includeTime: true };
  if (kind === 'month') return { ...rest, granularity: 'month' };
  return rest;
}

/** Date, Month or Date & time for a date field. */
function DateKindField({
  id,
  value,
  onChange,
  lockedToDateTime,
}: {
  id: string;
  value: DateKind;
  onChange: (kind: DateKind) => void;
  /** Editing an existing field: date & time can't switch to/from a calendar date. */
  lockedToDateTime?: boolean;
}) {
  const editing = lockedToDateTime !== undefined;
  return (
    <div>
      <label className="form-label" htmlFor={id} style={{ fontSize: 'var(--font-size-xs)' }}>Stores</label>
      <select id={id} className="form-select" value={value} onChange={(e) => onChange(e.target.value as DateKind)} disabled={lockedToDateTime}>
        <option value="day">Date (a calendar day)</option>
        <option value="month">Month (e.g. a monthly sheet)</option>
        {(!editing || lockedToDateTime) && <option value="datetime">Date & time (a moment)</option>}
      </select>
      <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        {value === 'datetime'
          ? "Shown in each viewer's time zone."
          : value === 'month'
            ? 'Saved as the 1st of the month; people pick a month.'
            : 'The same day for everyone, in any time zone.'}
        {editing && !lockedToDateTime && ' Switching to Month moves existing values to the 1st of their month.'}
      </p>
    </div>
  );
}

/** Field types as people know them (the same names as on the Permissions screen). */
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / No',
  date: 'Date',
  select: 'Choice',
  reference: 'Link',
};
