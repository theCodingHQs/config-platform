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
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, margin: 0 }}>Workspace Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: '0.25rem' }}>
            Plan limits, data bundle export/import, and activity audit trail.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--danger-subtle)',
            color: 'var(--danger)',
            border: 'var(--border-width) solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--success-subtle)',
            color: 'var(--success)',
            border: 'var(--border-width) solid var(--success)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: 'var(--border-width) solid var(--border)', marginBottom: 'var(--space-5)' }}>
        <button
          type="button"
          onClick={() => setActiveTab('usage')}
          style={{
            padding: 'var(--space-3) var(--space-4)',
            border: 'none',
            background: 'transparent',
            fontWeight: 600,
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
            color: activeTab === 'usage' ? 'var(--accent)' : 'var(--muted)',
            borderBottom: activeTab === 'usage' ? '2px solid var(--accent)' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <Sliders size={15} /> Resource Usage & Plan
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('export-import')}
          style={{
            padding: 'var(--space-3) var(--space-4)',
            border: 'none',
            background: 'transparent',
            fontWeight: 600,
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
            color: activeTab === 'export-import' ? 'var(--accent)' : 'var(--muted)',
            borderBottom: activeTab === 'export-import' ? '2px solid var(--accent)' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <Download size={15} /> Export & Import
        </button>

        {(user?.role === 'admin' || user?.role === 'owner') && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
              color: activeTab === 'audit' ? 'var(--accent)' : 'var(--muted)',
              borderBottom: activeTab === 'audit' ? '2px solid var(--accent)' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
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
            <p style={{ color: 'var(--muted)' }}>Loading usage metrics...</p>
          ) : usage ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
              <div
                style={{
                  padding: 'var(--space-4)',
                  backgroundColor: 'var(--surface)',
                  border: 'var(--border-width) solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <Layers size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600 }}>Entities</h3>
                </div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>
                  {usage.usage.entities} / {usage.limits.maxEntities}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-2)' }}>
                  Max fields per entity: {usage.limits.maxFieldsPerEntity}
                </div>
              </div>

              <div
                style={{
                  padding: 'var(--space-4)',
                  backgroundColor: 'var(--surface)',
                  border: 'var(--border-width) solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <FileText size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600 }}>Pages</h3>
                </div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>
                  {usage.usage.pages} / {usage.limits.maxPages}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-2)' }}>
                  Total published and draft pages
                </div>
              </div>

              <div
                style={{
                  padding: 'var(--space-4)',
                  backgroundColor: 'var(--surface)',
                  border: 'var(--border-width) solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <Users size={18} color="var(--accent)" />
                  <h3 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600 }}>Members</h3>
                </div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>
                  {usage.usage.members} / {usage.limits.maxMembers}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-2)' }}>
                  Current Plan: <strong style={{ textTransform: 'capitalize' }}>{usage.plan}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Tab: Export / Import */}
      {activeTab === 'export-import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--surface)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <h3 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Export Workspace</h3>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
              Export all entity schemas, fields, relations, and page configurations as a versioned JSON bundle.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exportLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export JSON Bundle'}
            </button>
          </div>

          <div
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--surface)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <h3 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Import Workspace</h3>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
              Paste a valid workspace bundle JSON to import schemas and pages into this workspace.
            </p>
            <textarea
              rows={8}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder="Paste WorkspaceBundle JSON here..."
              className="form-input"
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                marginBottom: 'var(--space-4)',
              }}
            />

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importLoading || !importJson.trim()}
                onClick={() => handleImport(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <Eye size={16} /> Validate & Check Conflicts (Dry Run)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importLoading || !importJson.trim()}
                onClick={() => handleImport(false)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <Upload size={16} /> Import Bundle
              </button>
            </div>

            {importResult && (
              <div
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-4)',
                  backgroundColor: importResult.success ? 'var(--surface-2)' : 'var(--danger-subtle)',
                  border: 'var(--border-width) solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                <strong>{importResult.dryRun ? 'Validation Result:' : 'Import Result:'}</strong>
                {importResult.conflicts.length > 0 ? (
                  <ul style={{ margin: 'var(--space-2) 0 0 var(--space-5)', color: 'var(--danger)' }}>
                    {importResult.conflicts.map((c: string, idx: number) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 'var(--space-2) 0 0 0', color: 'var(--success)' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Activity Audit Trail</h3>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={loadLogs}
              disabled={loadingLogs}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {loadingLogs ? (
            <p style={{ color: 'var(--muted)' }}>Loading audit trail...</p>
          ) : logs.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No audit events recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-xs)' }}>
                <thead>
                  <tr style={{ borderBottom: 'var(--border-width) solid var(--border)', backgroundColor: 'var(--surface-2)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Time</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>User</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Action</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Entity Type</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Entity ID</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: 'var(--border-width) solid var(--border)' }}>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)' }}>{log.userEmail}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{log.action}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textTransform: 'capitalize' }}>{log.entityType}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'var(--font-mono)' }}>{log.entityId}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setSelectedLog(log)}
                          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--font-size-xs)' }}
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
                backgroundColor: 'var(--overlay-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: 'var(--space-4)',
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  border: 'var(--border-width) solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-xl)',
                  width: '100%',
                  maxWidth: '650px',
                  padding: 'var(--space-6)',
                  maxHeight: '85vh',
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                  <h4 style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 600 }}>
                    Audit Event: {selectedLog.action} ({selectedLog.entityId})
                  </h4>
                  <button type="button" className="btn btn-ghost" onClick={() => setSelectedLog(null)}>
                    ✕
                  </button>
                </div>

                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <strong>Before State:</strong>
                  <pre
                    style={{
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--surface-2)',
                      border: 'var(--border-width) solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-xs)',
                      fontFamily: 'var(--font-mono)',
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
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--surface-2)',
                      border: 'var(--border-width) solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-xs)',
                      fontFamily: 'var(--font-mono)',
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
