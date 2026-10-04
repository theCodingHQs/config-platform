import React, { useState, useEffect } from 'react';
import {
  fetchWorkspaceUsage,
  exportWorkspace,
  importWorkspace,
  fetchAuditLogs,
  type WorkspaceUsage,
  type AuditLog,
} from '../api/client';
import { useAuth } from '../context/auth-context';
import {
  Activity,
  Download,
  Upload,
  Layers,
  FileText,
  Users,
  AlertTriangle,
  CheckCircle,
  Eye,
  RefreshCw,
  Sliders,
} from 'lucide-react';

export function WorkspaceSettings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'usage' | 'audit' | 'export-import'>('usage');

  // Usage state
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);

  // Audit state
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Export / Import state
  const [importJson, setImportJson] = useState('');
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadUsage = async () => {
    try {
      setLoadingUsage(true);
      const data = await fetchWorkspaceUsage();
      setUsage(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load workspace usage');
    } finally {
      setLoadingUsage(false);
    }
  };

  const loadLogs = async () => {
    try {
      setLoadingLogs(true);
      const data = await fetchAuditLogs({ limit: 50 });
      setLogs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadUsage();
    if (user?.role === 'admin' || user?.role === 'owner') {
      loadLogs();
    }
  }, [user]);

  const handleExport = async () => {
    try {
      setExportLoading(true);
      setError(null);
      const bundle = await exportWorkspace();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-${user?.tenantName || user?.tenantId || 'bundle'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess('Workspace bundle exported successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to export workspace bundle');
    } finally {
      setExportLoading(false);
    }
  };

  const handleImport = async (dryRun: boolean) => {
    try {
      setImportLoading(true);
      setError(null);
      setSuccess(null);
      const bundle = JSON.parse(importJson);
      const result = await importWorkspace(bundle, dryRun);
      setImportResult(result);
      if (!dryRun && result.success) {
        setSuccess(`Successfully imported ${result.entitiesCount} entities and ${result.pagesCount} pages.`);
        loadUsage();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import workspace bundle');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem 1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Workspace Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Plan limits, data bundle export/import, and activity audit trail.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--danger-subtle, rgba(239, 68, 68, 0.1))',
            color: 'var(--danger, #ef4444)',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {success && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--success-subtle, rgba(34, 197, 94, 0.1))',
            color: 'var(--success, #22c55e)',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('usage')}
          style={{
            padding: '0.625rem 1rem',
            border: 'none',
            background: 'transparent',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            color: activeTab === 'usage' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'usage' ? '2px solid var(--accent)' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}
        >
          <Sliders size={15} /> Resource Usage & Plan
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('export-import')}
          style={{
            padding: '0.625rem 1rem',
            border: 'none',
            background: 'transparent',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            color: activeTab === 'export-import' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'export-import' ? '2px solid var(--accent)' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}
        >
          <Download size={15} /> Export & Import
        </button>

        {(user?.role === 'admin' || user?.role === 'owner') && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            style={{
              padding: '0.625rem 1rem',
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              color: activeTab === 'audit' ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === 'audit' ? '2px solid var(--accent)' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}
          >
            <Activity size={15} /> Audit Log
          </button>
        )}
      </div>

      {/* Tab: Usage */}
      {activeTab === 'usage' && (
        <div>
          {loadingUsage ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading usage metrics...</p>
          ) : usage ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div
                style={{
                  padding: '1.25rem',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Layers size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Entities</h3>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>
                  {usage.usage.entities} / {usage.limits.maxEntities}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                  Max fields per entity: {usage.limits.maxFieldsPerEntity}
                </div>
              </div>

              <div
                style={{
                  padding: '1.25rem',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <FileText size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Pages</h3>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>
                  {usage.usage.pages} / {usage.limits.maxPages}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                  Total published and draft pages
                </div>
              </div>

              <div
                style={{
                  padding: '1.25rem',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Users size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Members</h3>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>
                  {usage.usage.members} / {usage.limits.maxMembers}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                  Current Plan: <strong style={{ textTransform: 'capitalize' }}>{usage.plan}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Tab: Export / Import */}
      {activeTab === 'export-import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div
            style={{
              padding: '1.5rem',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.125rem', fontWeight: 600 }}>Export Workspace</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Export all entity schemas, fields, relations, and page configurations as a versioned JSON bundle.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exportLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export JSON Bundle'}
            </button>
          </div>

          <div
            style={{
              padding: '1.5rem',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.125rem', fontWeight: 600 }}>Import Workspace</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Paste a valid workspace bundle JSON to import schemas and pages into this workspace.
            </p>
            <textarea
              rows={8}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder="Paste WorkspaceBundle JSON here..."
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
                marginBottom: '1rem',
              }}
            />

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importLoading || !importJson.trim()}
                onClick={() => handleImport(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Eye size={16} /> Validate & Check Conflicts (Dry Run)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importLoading || !importJson.trim()}
                onClick={() => handleImport(false)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Upload size={16} /> Import Bundle
              </button>
            </div>

            {importResult && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  backgroundColor: importResult.success ? 'var(--surface-subtle)' : 'var(--danger-subtle, rgba(239, 68, 68, 0.1))',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                }}
              >
                <strong>{importResult.dryRun ? 'Validation Result:' : 'Import Result:'}</strong>
                {importResult.conflicts.length > 0 ? (
                  <ul style={{ margin: '0.5rem 0 0 1.25rem', color: 'var(--danger, #ef4444)' }}>
                    {importResult.conflicts.map((c: string, idx: number) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: '0.5rem 0 0 0', color: 'var(--success, #22c55e)' }}>
                    Bundle is valid with {importResult.entitiesCount} entities and {importResult.pagesCount} pages. No conflicts found.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Audit Log */}
      {activeTab === 'audit' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Activity Audit Trail</h3>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={loadLogs}
              disabled={loadingLogs}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {loadingLogs ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading audit trail...</p>
          ) : logs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No audit events recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Time</th>
                    <th style={{ padding: '0.75rem 1rem' }}>User</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Action</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Entity Type</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Entity ID</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>{log.userEmail}</td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600 }}>{log.action}</td>
                      <td style={{ padding: '0.75rem 1rem', textTransform: 'capitalize' }}>{log.entityType}</td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace' }}>{log.entityId}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setSelectedLog(log)}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          View Diff
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedLog && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '1rem',
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  width: '100%',
                  maxWidth: '650px',
                  padding: '1.5rem',
                  maxHeight: '85vh',
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                    Audit Event: {selectedLog.action} ({selectedLog.entityId})
                  </h4>
                  <button type="button" className="btn btn-ghost" onClick={() => setSelectedLog(null)}>
                    ✕
                  </button>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <strong>Before State:</strong>
                  <pre
                    style={{
                      padding: '0.75rem',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      maxHeight: '150px',
                      overflowY: 'auto',
                    }}
                  >
                    {selectedLog.beforeState ? JSON.stringify(selectedLog.beforeState, null, 2) : 'None'}
                  </pre>
                </div>

                <div>
                  <strong>After State:</strong>
                  <pre
                    style={{
                      padding: '0.75rem',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      maxHeight: '150px',
                      overflowY: 'auto',
                    }}
                  >
                    {selectedLog.afterState ? JSON.stringify(selectedLog.afterState, null, 2) : 'None'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
