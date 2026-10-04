import React, { useState } from 'react';
import { X, LayoutTemplate, FileSpreadsheet, LayoutDashboard, Database } from 'lucide-react';
import type { ErdTable } from '@config-platform/schema';
import type { TemplateType } from './templates';

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  entities: ErdTable[];
  onApply: (template: TemplateType, entity: ErdTable) => void;
}

const TEMPLATES: Array<{
  id: TemplateType;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: 'Master/Detail',
    title: 'Master / Detail',
    description: 'Two-column grid with a table on the left and selected item details on the right.',
    icon: FileSpreadsheet,
  },
  {
    id: 'Dashboard',
    title: 'Dashboard',
    description: 'Header, 3 aggregate stat cards in a responsive grid, and tabs for chart & table.',
    icon: LayoutDashboard,
  },
  {
    id: 'CRUD list',
    title: 'CRUD List',
    description: 'Table with "+ New" modal form, edit modal on row click, and delete with confirmation.',
    icon: Database,
  },
];

export const TemplatePickerModal: React.FC<TemplatePickerModalProps> = ({
  isOpen,
  onClose,
  entities,
  onApply,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('CRUD list');
  const [selectedEntityId, setSelectedEntityId] = useState<string>(entities[0]?.id || '');

  if (!isOpen) return null;

  const handleConfirm = () => {
    const entity = entities.find((e) => e.id === selectedEntityId) || entities[0];
    if (!entity) return;
    onApply(selectedTemplate, entity);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius, 8px)',
          width: '560px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutTemplate size={18} />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Create From Template</h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            style={{ padding: '0.25rem', display: 'flex', alignItems: 'center' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              Choose a Template
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {TEMPLATES.map((tmpl) => {
                const Icon = tmpl.icon;
                const isSelected = selectedTemplate === tmpl.id;
                return (
                  <div
                    key={tmpl.id}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        padding: '0.375rem',
                        borderRadius: 'var(--radius-sm, 4px)',
                        backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface-subtle)',
                        color: isSelected ? '#ffffff' : 'var(--text-muted)',
                        display: 'flex',
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text)' }}>{tmpl.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                        {tmpl.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="template-target-entity" style={{ fontWeight: 600 }}>
              Target Data Entity
            </label>
            <select
              id="template-target-entity"
              className="form-select"
              value={selectedEntityId || entities[0]?.id || ''}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              disabled={entities.length === 0}
            >
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label} ({ent.name})
                </option>
              ))}
            </select>
            {entities.length === 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>
                No entities found. Create an entity first in Data Entities.
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '0.875rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={entities.length === 0}
          >
            Apply Template
          </button>
        </div>
      </div>
    </div>
  );
};
