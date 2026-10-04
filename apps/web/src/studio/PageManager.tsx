import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useMetadata } from '../context/metadata-context';
import {
  fetchPages,
  createPage,
  deletePage,
  fetchPage,
  type PageSummary,
} from '../api/client';
import { Plus, X, AlertTriangle } from 'lucide-react';

export const PageManager: React.FC = () => {
  const { tenantId } = useMetadata();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pageName, setPageName] = useState('');
  const [pageRoute, setPageRoute] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: pages = [], isLoading } = useQuery<PageSummary[]>({
    queryKey: ['pages', tenantId],
    queryFn: () => fetchPages(tenantId),
  });

  const handleTitleChange = (title: string) => {
    setPageName(title);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setPageRoute(`/${slug}`);
  };

  const createPageMut = useMutation({
    mutationFn: () => createPage(tenantId, { name: pageName, route: pageRoute }),
    onSuccess: (newPage) => {
      setShowCreateModal(false);
      setPageName('');
      setPageRoute('');
      queryClient.invalidateQueries({ queryKey: ['pages', tenantId] });
      navigate(`/studio/pages/${newPage.id}`);
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const duplicatePageMut = useMutation({
    mutationFn: async (srcPage: PageSummary) => {
      const full = await fetchPage(tenantId, srcPage.id);
      const cloneDraft = JSON.parse(JSON.stringify(full.draft));
      cloneDraft.id = `p_${Math.random().toString(36).substring(2, 9)}`;
      cloneDraft.route = `${srcPage.route}-copy`;

      return createPage(tenantId, {
        name: `${srcPage.name} (Copy)`,
        route: `${srcPage.route}-copy`,
        draft: cloneDraft,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', tenantId] });
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const deletePageMut = useMutation({
    mutationFn: (id: string) => deletePage(tenantId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', tenantId] });
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem' }}>Pages</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Build and manage JSON-defined pages with draft and published versions.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          aria-label="+ Create Page"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
        >
          <Plus size={14} /> Create Page
        </button>
      </div>

      {errorMessage && (
        <div className="props-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
            <span>{errorMessage}</span>
          </div>
          <button type="button" onClick={() => setErrorMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', alignItems: 'center' }} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {/* Pages table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Route</th>
              <th>Status</th>
              <th>Version</th>
              <th>Last Updated</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Loading pages...
                </td>
              </tr>
            ) : pages.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '3rem 2rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', maxWidth: '480px', margin: '0 auto' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={20} />
                    </div>
                    <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>No pages created yet</strong>
                    <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
                      Workspaces start empty. After defining an entity under <em>Data Entities</em>, click <strong>Create Page</strong> to design interactive views, dashboards, and tables.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowCreateModal(true)}
                      style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                      <Plus size={14} /> Create Your First Page
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              pages.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => navigate(`/studio/pages/${p.id}`)}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem' }}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{p.route}</td>
                  <td>
                    {p.hasPublished ? (
                      <span className="badge badge-success">Published</span>
                    ) : (
                      <span className="badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', borderColor: 'var(--warning-border)' }}>
                        Draft only
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="badge">v{p.version}</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {new Date(p.updatedAt).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                        onClick={() => navigate(`/studio/pages/${p.id}`)}
                      >
                        Builder
                      </button>
                      {p.hasPublished && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => navigate(p.route)}
                        >
                          View Live
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        onClick={() => duplicatePageMut.mutate(p)}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }}
                        onClick={() => {
                          if (confirm(`Delete page "${p.name}"?`)) {
                            deletePageMut.mutate(p.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Create Page */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '1.5rem', borderRadius: 'var(--radius)', width: '420px', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>
            <h3>Create Page</h3>
            <div>
              <label className="form-label">Page Title</label>
              <input
                type="text"
                className="form-input"
                value={pageName}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Inventory Dashboard"
                autoFocus
              />
            </div>
            <div>
              <label className="form-label">URL Route</label>
              <input
                type="text"
                className="form-input"
                value={pageRoute}
                onChange={(e) => setPageRoute(e.target.value)}
                placeholder="/inventory"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pageName || !pageRoute}
                onClick={() => createPageMut.mutate()}
              >
                Create Page
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
