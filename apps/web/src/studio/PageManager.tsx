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
  updatePageSettings,
  type PageNavFolder,
  type PageNavigation,
  type PageSettingsUpdate,
  type PageSummary,
} from '../api/client';
import { Plus, X, AlertTriangle, Folder, FolderPlus, ChevronRight, FileText, PencilRuler, ExternalLink, Copy, Trash2, Pencil, Settings2, Maximize2 } from 'lucide-react';
import { DynamicIcon } from '../components/dynamic-icon';
import { useStatusNotify } from '../context/app-bar-context';
import {
  GroupDialog,
  PageSettingsDialog,
  folderPath,
  type GroupValues,
  type PageSettingsValues,
} from './PageNavigationDialogs';

type PageDialogState = { mode: 'create' } | { mode: 'edit'; page: PageSummary } | null;
type GroupDialogState = { mode: 'create'; parentId: string | null } | { mode: 'edit'; folder: PageNavFolder } | null;

export const PageManager: React.FC = () => {
  const { tenantId } = useMetadata();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [pageDialog, setPageDialog] = useState<PageDialogState>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  // Action errors go to the status bar (visible above open dialogs too)
  const notify = useStatusNotify();

  const { data: navigation = { folders: [], pages: [] }, isLoading } = useQuery<PageNavigation>({
    queryKey: ['page-navigation', tenantId],
    queryFn: () => fetchPageNavigation(tenantId),
  });
  const { folders, pages } = navigation;

  const invalidateNavigation = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['page-navigation', tenantId] }),
    queryClient.invalidateQueries({ queryKey: ['published-pages', tenantId] }),
  ]);

  const createPageMut = useMutation({
    mutationFn: (values: PageSettingsValues) => createPage(tenantId, {
      name: values.name,
      route: `/${[...folderPath(folders, values.folderId), values.slug].join('/')}`,
      folderId: values.folderId,
      // Defaults ('theme' width, automatic icon) are omitted
      ...(values.width === 'full' ? { width: 'full' as const } : {}),
      ...(values.icon ? { icon: values.icon } : {}),
    }),
    onSuccess: (newPage) => {
      setPageDialog(null);
      queryClient.invalidateQueries({ queryKey: ['page-navigation', tenantId] });
      navigate(`/studio/pages/${newPage.id}`);
    },
    onError: (err: any) => notify("error", err.message),
  });

  const updatePageSettingsMut = useMutation({
    mutationFn: ({ page, values }: { page: PageSummary; values: PageSettingsValues }) => {
      // Send only what changed
      const change: PageSettingsUpdate = {};
      if (values.name !== page.name) change.name = values.name;
      if (values.slug !== page.route.split('/').filter(Boolean).pop()) change.slug = values.slug;
      if (values.folderId !== (page.folderId ?? null)) change.folderId = values.folderId;
      if (values.width !== (page.width === 'full' ? 'full' : 'theme')) change.width = values.width;
      if (values.icon !== (page.icon ?? null)) change.icon = values.icon;
      return updatePageSettings(page.id, change);
    },
    onSuccess: () => {
      setPageDialog(null);
      invalidateNavigation();
    },
    onError: (err: any) => notify("error", err.message),
  });

  const folderIsDescendant = (candidateId: string, ancestorId: string): boolean => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    let current = byId.get(candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = byId.get(current.parentId);
    }
    return false;
  };
  const saveGroupMut = useMutation({
    mutationFn: ({ folder, values }: { folder?: PageNavFolder; values: GroupValues }) =>
      folder
        ? updatePageFolder(folder.id, {
            ...(values.name !== folder.name ? { name: values.name } : {}),
            ...(values.parentId !== folder.parentId ? { parentId: values.parentId } : {}),
            ...(values.icon !== (folder.icon ?? null) ? { icon: values.icon } : {}),
          })
        : createPageFolder({ name: values.name, parentId: values.parentId, ...(values.icon ? { icon: values.icon } : {}) }),
    onSuccess: () => {
      setGroupDialog(null);
      invalidateNavigation();
    },
    onError: (err: any) => notify("error", err.message),
  });
  const deleteFolderMut = useMutation({
    mutationFn: (id: string) => deletePageFolder(id),
    onSuccess: invalidateNavigation,
    onError: (err: any) => notify("error", err.message),
  });
  const movePageMut = useMutation({
    mutationFn: ({ pageId, folderId }: { pageId: string; folderId: string | null }) => movePageToFolder(pageId, folderId),
    onSuccess: invalidateNavigation,
    onError: (err: any) => notify("error", err.message),
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
    onError: (err: any) => notify("error", err.message),
  });

  const deletePageMut = useMutation({
    mutationFn: (id: string) => deletePage(tenantId, id),
    onSuccess: () => {
      invalidateNavigation();
    },
    onError: (err: any) => notify("error", err.message),
  });

  // Pages in a group, including nested subgroups
  const countPages = (folderId: string): number =>
    pages.filter((page) => page.folderId === folderId).length +
    folders.filter((folder) => folder.parentId === folderId).reduce((sum, child) => sum + countPages(child.id), 0);

  // Indent only the name cell so every other column stays aligned at any depth
  const indent = (depth: number) => ({ paddingLeft: `calc(${depth} * var(--spacing-6))` });

  const renderPages = (folderId: string | null, depth: number): React.ReactNode => (
    <>
      {pages.filter((page) => page.folderId === folderId).map((page) => (
        <div key={page.id} className="page-tree-row">
          {/* Spacer matches the group chevron so page names line up with group names */}
          <div className="page-tree-name" style={indent(depth)}>
            <span aria-hidden="true" style={{ width: 14, flexShrink: 0 }} />
            <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-muted)' }}>
              {page.icon ? <DynamicIcon name={page.icon} size={16} /> : <FileText size={16} />}
            </span>
            <button
              type="button"
              className="page-tree-truncate"
              title={page.name}
              onClick={() => navigate(`/studio/pages/${page.id}`)}
              style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 'var(--font-size-sm)', cursor: 'pointer', textAlign: 'left' }}
            >
              {page.name}
            </button>
            {page.width === 'full' && (
              <span title="Always full width" aria-label="Always full width" style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-muted)' }}>
                <Maximize2 size={12} />
              </span>
            )}
          </div>
          <code className="page-tree-truncate page-tree-cell-route" title={page.route} style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>{page.route}</code>
          <div className="page-tree-cell-status">
            {page.hasPublished ? <span className="badge badge-success">Published</span> : <span className="badge">Draft only</span>}
          </div>
          <select
            className="form-select form-control-sm page-tree-cell-group"
            aria-label={`Move ${page.name} to folder`}
            value={page.folderId ?? ''}
            onChange={(event) => movePageMut.mutate({ pageId: page.id, folderId: event.target.value || null })}
          >
            <option value="">Root</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <div className="page-tree-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/studio/pages/${page.id}`)} style={{ gap: 'var(--spacing-1)' }}>
              <PencilRuler size={14} /> Builder
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Settings for ${page.name}`} title="Page settings" onClick={() => setPageDialog({ mode: 'edit', page })}>
              <Settings2 size={15} />
            </button>
            {/* Disabled rather than hidden, so the action columns stay aligned */}
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={`View ${page.name} live`}
              title={page.hasPublished ? 'View live' : 'Publish the page to view it live'}
              disabled={!page.hasPublished}
              onClick={() => navigate(page.route)}
            >
              <ExternalLink size={15} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Duplicate ${page.name}`} title="Duplicate" onClick={() => duplicatePageMut.mutate(page)}>
              <Copy size={15} />
            </button>
            <button type="button" className="btn btn-ghost-danger btn-sm btn-icon" aria-label={`Delete ${page.name}`} title="Delete" onClick={() => {
              if (confirm(`Delete page "${page.name}"?`)) deletePageMut.mutate(page.id);
            }}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
      {folders.filter((folder) => folder.parentId === folderId).map((folder) => {
        const pageCount = countPages(folder.id);
        return (
          <details key={folder.id} open className="page-tree-group">
            <summary className="page-tree-row">
              <div className="page-tree-name" style={indent(depth)}>
                <ChevronRight size={14} className="page-tree-chevron" />
                <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--accent)' }}>
                  {folder.icon ? <DynamicIcon name={folder.icon} size={16} /> : <Folder size={16} />}
                </span>
                <strong className="page-tree-truncate" title={folder.name} style={{ fontSize: 'var(--font-size-sm)' }}>{folder.name}</strong>
              </div>
              <code className="page-tree-truncate page-tree-cell-route" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>/{folder.slug}</code>
              <div className="page-tree-cell-status" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                {pageCount} {pageCount === 1 ? 'page' : 'pages'}
              </div>
              <select
                className="form-select form-control-sm page-tree-cell-group"
                aria-label={`Move group ${folder.name} under`}
                value={folder.parentId ?? ''}
                onClick={(event) => event.preventDefault()}
                onChange={(event) => {
                  const parentId = event.target.value || null;
                  updatePageFolder(folder.id, { parentId }).then(invalidateNavigation).catch((err: Error) => notify("error", err.message));
                }}
              >
                <option value="">Root level</option>
                {folders.filter((candidate) => candidate.id !== folder.id && !folderIsDescendant(candidate.id, folder.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
              <div className="page-tree-actions">
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Add subgroup under ${folder.name}`} title="Add subgroup" onClick={(event) => {
                  event.preventDefault();
                  setGroupDialog({ mode: 'create', parentId: folder.id });
                }}>
                  <FolderPlus size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Settings for group ${folder.name}`} title="Group settings" onClick={(event) => {
                  event.preventDefault();
                  setGroupDialog({ mode: 'edit', folder });
                }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost-danger btn-sm btn-icon" aria-label={`Delete ${folder.name}`} title={pageCount ? 'Move or delete its pages first' : 'Delete'} onClick={(event) => {
                  event.preventDefault();
                  if (confirm(`Delete empty folder "${folder.name}"?`)) deleteFolderMut.mutate(folder.id);
                }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </summary>
            {renderPages(folder.id, depth + 1)}
          </details>
        );
      })}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: "var(--font-size-2xl)" }}>Pages</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: "var(--font-size-sm)" }}>
            Build and manage JSON-defined pages with draft and published versions.
          </p>
        </div>
        {/* Secondary action first, primary last (rightmost) */}
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setGroupDialog({ mode: 'create', parentId: null })} style={{ gap: 'var(--spacing-1)' }}>
            <FolderPlus size={14} /> New Group
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPageDialog({ mode: 'create' })}
            aria-label="+ Create Page"
            style={{ gap: 'var(--spacing-1)' }}
          >
            <Plus size={14} /> Create Page
          </button>
        </div>
      </div>

      <div className="table-container">
        {isLoading ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading navigation...</div> : (
          <>
            {(pages.length > 0 || folders.length > 0) && (
              <div className="page-tree-row page-tree-head" aria-hidden="true">
                <span>Name</span>
                <span className="page-tree-cell-route">Route</span>
                <span className="page-tree-cell-status">Status</span>
                <span className="page-tree-cell-group">Group</span>
                <span style={{ textAlign: 'right' }}>Actions</span>
              </div>
            )}
            {renderPages(null, 0)}
            {!pages.length && !folders.length && <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No pages or groups yet. Create a page or organize your workspace with a group.</p>
            </div>}
          </>
        )}
      </div>

      {pageDialog && (
        <PageSettingsDialog
          key={pageDialog.mode === 'edit' ? pageDialog.page.id : 'create'}
          page={pageDialog.mode === 'edit' ? pageDialog.page : undefined}
          folders={folders}
          saving={createPageMut.isPending || updatePageSettingsMut.isPending}
          onClose={() => setPageDialog(null)}
          onSubmit={(values) => {
            if (pageDialog.mode === 'edit') updatePageSettingsMut.mutate({ page: pageDialog.page, values });
            else createPageMut.mutate(values);
          }}
        />
      )}
      {groupDialog && (
        <GroupDialog
          key={groupDialog.mode === 'edit' ? groupDialog.folder.id : `create-${groupDialog.parentId ?? 'root'}`}
          folder={groupDialog.mode === 'edit' ? groupDialog.folder : undefined}
          defaultParentId={groupDialog.mode === 'create' ? groupDialog.parentId : null}
          // A group can't be placed under itself or its own subgroups
          folders={groupDialog.mode === 'edit'
            ? folders.filter((candidate) => candidate.id !== groupDialog.folder.id && !folderIsDescendant(candidate.id, groupDialog.folder.id))
            : folders}
          saving={saveGroupMut.isPending}
          onClose={() => setGroupDialog(null)}
          onSubmit={(values) => saveGroupMut.mutate({ folder: groupDialog.mode === 'edit' ? groupDialog.folder : undefined, values })}
        />
      )}
    </div>
  );
};
