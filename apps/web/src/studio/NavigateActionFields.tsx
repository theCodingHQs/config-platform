/** The Navigate action's fields: open a page (by id, so moving it never breaks the link) or a typed address */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { fetchPages } from '../api/client';
import { ExpressionInput } from './ExpressionInput';

const small = { fontSize: 'var(--font-size-xs)', padding: '0.25rem 0.5rem' } as const;

export function NavigateActionFields({ params, onChange }: { params: Record<string, any>; onChange: (params: Record<string, any>) => void }) {
  const { data: pages = [] } = useQuery({ queryKey: ['pages-for-links'], queryFn: () => fetchPages() });
  const openPage = params.pageId !== undefined;
  const values: [string, string][] = Object.entries(params.with ?? {}).map(([key, value]) => [key, String(value)]);
  const setValues = (next: [string, string][]) => onChange({ ...params, with: Object.fromEntries(next) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }} htmlFor="navigate-target">Go to</label>
      <select
        id="navigate-target"
        className="form-input"
        style={small}
        value={openPage ? 'page' : 'url'}
        onChange={(e) => onChange(e.target.value === 'page' ? { pageId: '', with: {} } : { url: '/' })}
      >
        <option value="page">A page</option>
        <option value="url">A web address</option>
      </select>

      {openPage ? (
        <>
          <select aria-label="Page" className="form-input" style={small} value={params.pageId} onChange={(e) => onChange({ ...params, pageId: e.target.value })}>
            <option value="">Choose a page…</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>{page.name}{page.hidden ? ' (view)' : ''}</option>
            ))}
          </select>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            Values to pass: the page reads them as <code>{'{{ params.name }}'}</code>.
          </span>
          {values.map(([key, value], idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: '0.375rem', alignItems: 'end' }}>
              <input
                aria-label="Value name"
                className="form-input"
                style={small}
                value={key}
                placeholder="e.g. machine"
                onChange={(e) => setValues(values.map((pair, i) => (i === idx ? [e.target.value, pair[1]] : pair)))}
              />
              <ExpressionInput
                value={value}
                placeholder="e.g. {{ row.id }}"
                onChange={(next) => setValues(values.map((pair, i) => (i === idx ? [pair[0], next] : pair)))}
              />
              <button type="button" className="btn btn-ghost" aria-label="Remove value" onClick={() => setValues(values.filter((_, i) => i !== idx))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" style={{ ...small, alignSelf: 'flex-start' }} onClick={() => setValues([...values, ['', '']])}>
            <Plus size={12} /> Pass a value
          </button>
        </>
      ) : (
        <ExpressionInput
          label="URL / Path"
          value={params.url || ''}
          placeholder="e.g. /items/{{ row.id }}"
          onChange={(url) => onChange({ ...params, url })}
        />
      )}
    </div>
  );
}
