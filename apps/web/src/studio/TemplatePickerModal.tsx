import React, { useState } from 'react';
import { X, LayoutTemplate, FileSpreadsheet, LayoutDashboard, Database } from 'lucide-react';
import type { ErdTable, PageDefinition } from '@config-platform/schema';
import type { TemplateType } from './templates';
import { SharedTemplateChooser } from '../library/SharedTemplateChooser';
import { MyPageTemplates } from './MyPageTemplates';

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  entities: ErdTable[];
  onApply: (template: TemplateType, entity: ErdTable) => void;
  /** A shared template or a copy of another page: the layout to put in this page, and what couldn't be matched */
  onApplyDefinition: (definition: PageDefinition, name: string, missingFields: string[]) => void;
  currentPageId?: string;
}

/** Where a template comes from: built into the app, shared by a workspace, or one of this workspace's pages */
type Source = 'built-in' | 'shared' | 'mine';
const SOURCES: Array<{ id: Source; label: string }> = [
  { id: 'built-in', label: 'Built-in' },
  { id: 'shared', label: 'Shared' },
  { id: 'mine', label: 'Mine' },
];

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
  onApplyDefinition,
  currentPageId,
}) => {
  const [source, setSource] = useState<Source>('built-in');
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
        backgroundColor: 'var(--overlay-bg)',
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
          borderRadius: 'var(--radius-surface)',
          width: '560px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-xl)',
          border: 'var(--border-width) solid var(--border)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <LayoutTemplate size={18} />
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text)' }}>Create From Template</h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            style={{ padding: 'var(--space-1)', display: 'flex', alignItems: 'center' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div role="tablist" aria-label="Template source" style={{ display: 'flex', gap: 'var(--space-1)', padding: 'var(--space-3) var(--space-5) 0' }}>
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={source === s.id}
              className={source === s.id ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {source === 'shared' && (
          <div style={{ padding: 'var(--space-5)', overflowY: 'auto' }}>
            <SharedTemplateChooser
              kind="page-template"
              entities={entities}
              emptyHint="No shared page templates yet. Open a page and choose Share to share it as a template."
              onUse={(used, name) => {
                onApplyDefinition(used.definition as PageDefinition, name, used.missingFields);
                onClose();
              }}
            />
          </div>
        )}

        {source === 'mine' && (
          <div style={{ padding: 'var(--space-5)', overflowY: 'auto' }}>
            <MyPageTemplates
              currentPageId={currentPageId}
              onUse={(draft, name) => {
                onApplyDefinition(draft, name, []);
                onClose();
              }}
            />
          </div>
        )}

        {source === 'built-in' && (
        <>
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              Choose a Template
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
                      gap: 'var(--space-3)',
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-surface)',
                      border: `${isSelected ? '2px' : '1px'} solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-control)',
                        backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface-2)',
                        color: isSelected ? 'var(--accent-contrast)' : 'var(--muted)',
                        display: 'flex',
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text)' }}>{tmpl.title}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted)', marginTop: 'var(--space-1)' }}>
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
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)', marginTop: 'var(--space-1)' }}>
                No entities found. Create an entity first in Data Entities.
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
            backgroundColor: 'var(--surface-2)',
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
        </>
        )}
      </div>
    </div>
  );
};
