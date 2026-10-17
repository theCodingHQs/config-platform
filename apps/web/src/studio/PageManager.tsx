import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useMetadata } from '../context/metadata-context';
import {
  fetchPageNavigation,
  createPage,
  createPageFolder,
  deletePage,
  deletePageFolder,
  fetchPage,
  movePageToFolder,
  updatePageFolder,
  type PageNavFolder,
  type PageNavigation,
  type PageSummary,
} from '../api/client';
import { Plus, X, AlertTriangle, Folder, FolderPlus, ChevronRight } from 'lucide-react';

export const PageManager: React.FC = () => {
  const { tenantId } = useMetadata();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pageName, setPageName] = useState('');
  const [pageRoute, setPageRoute] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [parentFolderId, setParentFolderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: navigation = { folders: [], pages: [] }, isLoading } = useQuery<PageNavigation>({
    queryKey: ['page-navigation', tenantId],
    queryFn: () => fetchPageNavigation(tenantId),
  });
  const { folders, pages } = navigation;

  const handleTitleChange = (title: string) => {
    setPageName(title);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const path: string[] = [];
    let folder = selectedFolderId ? byId.get(selectedFolderId) : undefined;
    while (folder) {
      path.unshift(folder.slug);
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
    setPageRoute(`/${[...path, slug].filter(Boolean).join('/')}`);
  };

  const createPageMut = useMutation({
    mutationFn: () => createPage(tenantId, { name: pageName, route: pageRoute, folderId: selectedFolderId }),
    onSuccess: (newPage) => {
      setShowCreateModal(false);
      setPageName('');
      setPageRoute('');
      setSelectedFolderId(null);
      queryClient.invalidateQueries({ queryKey: ['page-navigation', tenantId] });
      navigate(`/studio/pages/${newPage.id}`);
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const invalidateNavigation = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['page-navigation', tenantId] }),
    queryClient.invalidateQueries({ queryKey: ['published-pages', tenantId] }),
  ]);
  const folderIsDescendant = (candidateId: string, ancestorId: string): boolean => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    let current = byId.get(candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = byId.get(current.parentId);
    }
    return false;
  };
  const createFolderMut = useMutation({
    mutationFn: () => createPageFolder({ name: folderName, parentId: parentFolderId }),
    onSuccess: () => {
      setShowFolderModal(false);
      setFolderName('');
      setParentFolderId(null);
      invalidateNavigation();
    },
    onError: (err: any) => setErrorMessage(err.message),
  });
  const deleteFolderMut = useMutation({
    mutationFn: (id: string) => deletePageFolder(id),
    onSuccess: invalidateNavigation,
    onError: (err: any) => setErrorMessage(err.message),
  });
  const movePageMut = useMutation({
    mutationFn: ({ pageId, folderId }: { pageId: string; folderId: string | null }) => movePageToFolder(pageId, folderId),
    onSuccess: invalidateNavigation,
    onError: (err: any) => setErrorMessage(err.message),
  });
  const renameFolderMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePageFolder(id, { name }),
    onSuccess: invalidateNavigation,
    onError: (err: any) => setErrorMessage(err.message),
  });

  const duplicatePageMut = useMutation({
    mutationFn: async (srcPage: PageSummary) => {
      const full = await fetchPage(tenantId, srcPage.id);
      const cloneDraft = JSON.parse(JSON.stringify(full.draft));
      cloneDraft.id = `p_${Math.random().toString(36).substring(2, 9)}`;
      const routeParts = srcPage.route.split('/').filter(Boolean);
      routeParts[routeParts.length - 1] = `${routeParts[routeParts.length - 1]}-copy`;
      cloneDraft.route = `/${routeParts.join('/')}`;

      return createPage(tenantId, {
        name: `${srcPage.name} (Copy)`,
        route: cloneDraft.route,
        draft: cloneDraft,
        folderId: srcPage.folderId,
      });
    },
    onSuccess: () => {
      invalidateNavigation();
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const deletePageMut = useMutation({
    mutationFn: (id: string) => deletePage(tenantId, id),
    onSuccess: () => {
      invalidateNavigation();
    },
    onError: (err: any) => setErrorMessage(err.message),
  });

  const renderPages = (folderId: string | null, depth: number): React.ReactNode => (
    <>
      {pages.filter((page) => page.folderId === folderId).map((page) => (
        <div key={page.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', paddingLeft: `${0.75 + depth * 1.25}rem`, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => navigate(`/studio/pages/${page.id}`)} style={{ background: 'none', border: 0, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', textAlign: 'left', flex: '1 1 160px' }}>
            {page.name}
          </button>
          <code style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>{page.route}</code>
          {page.hasPublished ? <span className="badge badge-success">Published</span> : <span className="badge">Draft only</span>}
          <select
            className="form-input"
            aria-label={`Move ${page.name} to folder`}
            value={page.folderId ?? ''}
            onChange={(event) => movePageMut.mutate({ pageId: page.id, folderId: event.target.value || null })}
            style={{ width: '145px', padding: '0.3rem', fontSize: 'var(--font-size-xs)' }}
          >
            <option value="">Root</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(`/studio/pages/${page.id}`)}>Builder</button>
            {page.hasPublished && <button type="button" className="btn btn-ghost" onClick={() => navigate(page.route)}>View Live</button>}
            <button type="button" className="btn btn-ghost" onClick={() => duplicatePageMut.mutate(page)}>Duplicate</button>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => {
              if (confirm(`Delete page "${page.name}"?`)) deletePageMut.mutate(page.id);
            }}>Delete</button>
          </div>
        </div>
      ))}
      {folders.filter((folder) => folder.parentId === folderId).map((folder) => (
        <details key={folder.id} open style={{ borderTop: '1px solid var(--border)' }}>
          <summary style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.75rem', paddingLeft: `${0.75 + depth * 1.25}rem`, cursor: 'pointer' }}>
            <ChevronRight size={14} />
            <Folder size={16} color="var(--accent)" />
            <strong style={{ flex: 1 }}>{folder.name}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>/{folder.slug}</span>
            <select
              className="form-input"
              aria-label={`Move group ${folder.name} under`}
              value={folder.parentId ?? ''}
              onClick={(event) => event.preventDefault()}
              onChange={(event) => {
                const parentId = event.target.value || null;
                updatePageFolder(folder.id, { parentId }).then(invalidateNavigation).catch((err: Error) => setErrorMessage(err.message));
              }}
              style={{ width: '135px', padding: '0.3rem', fontSize: 'var(--font-size-xs)' }}
            >
              <option value="">Root level</option>
              {folders.filter((candidate) => candidate.id !== folder.id && !folderIsDescendant(candidate.id, folder.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost" aria-label={`Add subgroup under ${folder.name}`} onClick={(event) => {
              event.preventDefault();
              setParentFolderId(folder.id);
              setShowFolderModal(true);
            }}><FolderPlus size={14} /></button>
            <button type="button" className="btn btn-ghost" onClick={(event) => {
              event.preventDefault();
              const name = prompt('Rename folder', folder.name);
              if (name?.trim()) renameFolderMut.mutate({ id: folder.id, name: name.trim() });
            }}>Rename</button>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={(event) => {
              event.preventDefault();
              if (confirm(`Delete empty folder "${folder.name}"?`)) deleteFolderMut.mutate(folder.id);
            }}>Delete</button>
          </summary>
          {renderPages(folder.id, depth + 1)}
        </details>
      ))}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: "var(--font-size-2xl)" }}>Pages</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: "var(--font-size-sm)" }}>
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
        <button type="button" className="btn btn-secondary" onClick={() => {
          setParentFolderId(null);
          setShowFolderModal(true);
        }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <FolderPlus size={14} /> New Group
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

      <div className="table-container">
        {isLoading ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading navigation...</div> : (
          <>
            {renderPages(null, 0)}
            {!pages.length && !folders.length && <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No pages or groups yet. Create a page or organize your workspace with a group.</p>
            </div>}
          </>
        )}
      </div>

      {/* Modal: Create Page */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '420px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Create Page</h3>
            <div>
              <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>Navigation Group</label>
              <select className="form-input" value={selectedFolderId ?? ''} onChange={(event) => {
                setSelectedFolderId(event.target.value || null);
                const slug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const byId = new Map(folders.map((folder) => [folder.id, folder]));
                const path: string[] = [];
                let current = event.target.value ? byId.get(event.target.value) : undefined;
                while (current) {
                  path.unshift(current.slug);
                  current = current.parentId ? byId.get(current.parentId) : undefined;
                }
                setPageRoute(`/${[...path, slug].filter(Boolean).join('/')}`);
              }}>
                <option value="">Root level</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>Page Title</label>
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
              <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>URL Route</label>
              <input
                type="text"
                className="form-input"
                value={pageRoute}
                onChange={(e) => setPageRoute(e.target.value)}
                placeholder="/inventory"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
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
      {showFolderModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-surface)', width: '420px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: 'var(--border-width) solid var(--border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Create Navigation Group</h3>
            <div>
              <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>Group Name</label>
              <input className="form-input" value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Sales" autoFocus />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 'var(--font-size-xs)' }}>Parent Group</label>
              <select className="form-input" value={parentFolderId ?? ''} onChange={(event) => setParentFolderId(event.target.value || null)}>
                <option value="">Root level</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!folderName.trim()} onClick={() => createFolderMut.mutate()}>Create Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
