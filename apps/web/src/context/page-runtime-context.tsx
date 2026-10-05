import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { PageDefinition, DataSourceDefinition, ActionDefinition, ExpressionScope } from '@config-platform/schema';
import { evaluateExpression, resolveTemplate } from '@config-platform/schema';
import * as apiClient from '../api/client';
import { executeActionChain, type ActionExecutionContext } from '../renderer/action-runner';

export interface ToastState {
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
  visible: boolean;
}

export interface DataSourceState {
  data: any[];
  total?: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export interface PageRuntimeContextType {
  tenantId: string;
  state: Record<string, any>;
  setState: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setKey: (key: string, value: any) => void;
  params: Record<string, any>;
  user: Record<string, any>;
  dataSources: Record<string, DataSourceState>;
  scope: ExpressionScope;
  runActionChain: (actions: ActionDefinition[] | undefined, extraScope?: Partial<ExpressionScope>) => Promise<boolean>;
  toast: ToastState;
  showToast: (message: string, variant?: 'info' | 'success' | 'warning' | 'error') => void;
  hideToast: () => void;
}

const PageRuntimeContext = createContext<PageRuntimeContextType | null>(null);

export interface PageRuntimeProviderProps {
  tenantId?: string;
  page?: PageDefinition;
  initialState?: Record<string, any>;
  initialDataSources?: any[];
  params?: Record<string, any>;
  user?: Record<string, any>;
  navigate?: (url: string) => void;
  children: React.ReactNode;
}

// In-flight query promise deduplication cache across data sources
const inFlightQueries = new Map<string, Promise<any>>();

const DEFAULT_PARAMS: Record<string, any> = {};
const DEFAULT_USER: Record<string, any> = { id: 'u_admin', name: 'Admin', role: 'admin' };
const DEFAULT_PAGE: PageDefinition = {
  id: 'default',
  schemaVersion: 2,
  version: 1,
  route: '/',
  state: {},
  dataSources: [],
  root: { id: 'root', type: 'stack', props: {} },
};

export function PageRuntimeProvider({
  tenantId = 'default',
  page = DEFAULT_PAGE,
  initialState,
  initialDataSources,
  params = DEFAULT_PARAMS,
  user = DEFAULT_USER,
  navigate = (url: string) => {
    if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  },
  children,
}: PageRuntimeProviderProps) {
  // 1. Page State
  const [pageState, setPageState] = useState<Record<string, any>>(() => ({
    ...(page?.state || {}),
    ...(initialState || {}),
  }));

  const setKey = useCallback((key: string, value: any) => {
    setPageState((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 2. Toast State
  const [toast, setToast] = useState<ToastState>({
    message: '',
    variant: 'info',
    visible: false,
  });

  const toastTimerRef = useRef<any>(null);

  const showToast = useCallback((message: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, variant, visible: true });
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 4000);
  }, []);

  const hideToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // 2b. Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const requestConfirm = useCallback(
    (options: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => {
      return new Promise<boolean>((resolve) => {
        setConfirmDialog({
          ...options,
          resolve: (confirmed: boolean) => {
            setConfirmDialog(null);
            resolve(confirmed);
          },
        });
      });
    },
    []
  );

  // 3. Base Scope for evaluation (state, params, user)
  const baseScope = useMemo<ExpressionScope>(() => {
    return {
      state: pageState,
      params,
      user,
      ds: {},
    };
  }, [pageState, params, user]);

  const queryClient = useContext(QueryClientContext);

  // 4. Data Sources Manager
  const [dsData, setDsData] = useState<Record<string, { data: any[]; total?: number; loading: boolean; error: string | null }>>({});
  const [manualRefetchCounters, setManualRefetchCounters] = useState<Record<string, number>>({});

  const refetchDataSource = useCallback(async (sourceId?: string) => {
    // 1. Invalidate TanStack query cache for direct entity queries (Table, Stat, Chart)
    if (queryClient) {
      if (sourceId) {
        queryClient.invalidateQueries({ queryKey: ['records', tenantId, sourceId] });
        queryClient.invalidateQueries({ queryKey: ['aggregate', tenantId, sourceId] });
        queryClient.invalidateQueries({ queryKey: ['chart-records', tenantId, sourceId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['records'] });
        queryClient.invalidateQueries({ queryKey: ['aggregate'] });
        queryClient.invalidateQueries({ queryKey: ['chart-records'] });
      }
    }

    // 2. Trigger refetch for custom page Data Sources
    setManualRefetchCounters((prev) => {
      if (sourceId) {
        return { ...prev, [sourceId]: (prev[sourceId] || 0) + 1 };
      }
      // Refetch all data sources
      const next: Record<string, number> = {
        ...prev,
        __all__: (prev.__all__ || 0) + 1,
      };
      const sources = initialDataSources || page?.dataSources || [];
      for (const ds of sources) {
        next[ds.id] = (prev[ds.id] || 0) + 1;
      }
      return next;
    });
  }, [page?.dataSources, initialDataSources, queryClient, tenantId]);

  const stateJson = JSON.stringify(pageState);
  const dataSourcesList = initialDataSources || page?.dataSources || [];
  const dataSourcesJson = JSON.stringify(dataSourcesList);

  // Evaluate filters for each data source
  const evaluatedDataSources = useMemo(() => {
    const list = dataSourcesList;
    return list.map((ds) => {
      let resolvedFilter: Record<string, any> | undefined = undefined;
      if (ds.filter && typeof ds.filter === 'object') {
        resolvedFilter = {};
        for (const [k, v] of Object.entries(ds.filter)) {
          if (typeof v === 'string') {
            resolvedFilter[k] = resolveTemplate(v, baseScope);
          } else {
            resolvedFilter[k] = v;
          }
        }
      }
      return {
        id: ds.id,
        entityId: ds.entityId,
        filter: resolvedFilter,
        sort: ds.sort,
        limit: ds.limit,
      };
    });
  }, [dataSourcesJson, stateJson, baseScope]);

  const lastFetchedKeyRef = useRef<Record<string, string>>({});

  // Fetch / refetch data sources when evaluated query parameters or manual trigger change
  useEffect(() => {
    let isCancelled = false;

    evaluatedDataSources.forEach((ds) => {
      const refetchTrigger = (manualRefetchCounters[ds.id] || 0) + (manualRefetchCounters.__all__ || 0);
      const queryKey = `${tenantId}:${ds.entityId}:${JSON.stringify(ds.filter)}:${JSON.stringify(ds.sort)}:${ds.limit}:${refetchTrigger}`;

      // Skip fetching if this exact queryKey was already fetched and data is loaded
      if (lastFetchedKeyRef.current[ds.id] === queryKey && dsData[ds.id]?.data !== undefined && !dsData[ds.id]?.loading) {
        return;
      }
      lastFetchedKeyRef.current[ds.id] = queryKey;

      // Set loading state if not already loading
      setDsData((prev) => {
        if (prev[ds.id]?.loading) return prev;
        return {
          ...prev,
          [ds.id]: {
            data: prev[ds.id]?.data || [],
            total: prev[ds.id]?.total,
            loading: true,
            error: null,
          },
        };
      });

      // Check if duplicate query is already in flight
      let fetchPromise = inFlightQueries.get(queryKey);
      if (!fetchPromise) {
        const sortOrder = (ds.sort as any)?.order || (ds.sort as any)?.direction;
        const sortParam = ds.sort ? `${sortOrder === 'desc' ? '-' : ''}${ds.sort.fieldId}` : undefined;
        fetchPromise = apiClient
          .fetchRecords(tenantId, ds.entityId, {
            filter: ds.filter,
            sort: sortParam,
            limit: ds.limit,
          })
          .finally(() => {
            inFlightQueries.delete(queryKey);
          });
        inFlightQueries.set(queryKey, fetchPromise);
      }

      fetchPromise
        .then((res) => {
          if (!isCancelled) {
            setDsData((prev) => ({
              ...prev,
              [ds.id]: {
                data: res.data || [],
                total: res.total,
                loading: false,
                error: null,
              },
            }));
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setDsData((prev) => ({
              ...prev,
              [ds.id]: {
                data: [],
                loading: false,
                error: err?.message || 'Failed to load data',
              },
            }));
          }
        });
    });

    return () => {
      isCancelled = true;
    };
  }, [tenantId, evaluatedDataSources, manualRefetchCounters]);

  // Combined dataSources map for consumers
  const dataSources = useMemo<Record<string, DataSourceState>>(() => {
    const res: Record<string, DataSourceState> = {};
    for (const ds of page.dataSources || []) {
      const info = dsData[ds.id] || { data: [], loading: true, error: null };
      res[ds.id] = {
        data: info.data,
        total: info.total,
        loading: info.loading,
        error: info.error,
        refetch: () => refetchDataSource(ds.id),
      };
    }
    return res;
  }, [page.dataSources, dsData, refetchDataSource]);

  // 5. Full Expression Scope including ds
  const fullScope = useMemo<ExpressionScope>(() => {
    const dsValues: Record<string, any[]> = {};
    for (const [k, v] of Object.entries(dataSources)) {
      dsValues[k] = v.data;
    }
    return {
      state: pageState,
      params,
      user,
      ds: dsValues,
    };
  }, [pageState, params, user, dataSources]);

  // 6. Action Execution Context
  const actionContext = useMemo<ActionExecutionContext>(() => {
    return {
      tenantId,
      state: pageState,
      setState: setPageState,
      setKey,
      navigate,
      showToast,
      refetchDataSource,
      createRecord: (entityId, data) => apiClient.createRecord(tenantId, entityId, data),
      updateRecord: (entityId, id, data) => apiClient.updateRecord(tenantId, entityId, id, data),
      deleteRecord: (entityId, id) => apiClient.deleteRecord(tenantId, entityId, id),
      requestConfirm,
    };
  }, [tenantId, pageState, setKey, navigate, showToast, refetchDataSource, requestConfirm]);

  const runActionChain = useCallback(
    async (actions: ActionDefinition[] | undefined, extraScope: Partial<ExpressionScope> = {}) => {
      const currentScope: ExpressionScope = {
        ...fullScope,
        ...extraScope,
        state: pageState,
      };
      return executeActionChain(actions, actionContext, currentScope);
    },
    [fullScope, pageState, actionContext]
  );

  return (
    <PageRuntimeContext.Provider
      value={{
        tenantId,
        state: pageState,
        setState: setPageState,
        setKey,
        params,
        user,
        dataSources,
        scope: fullScope,
        runActionChain,
        toast,
        showToast,
        hideToast,
      }}
    >
      {children}
      {/* Toast Notification Container */}
      {toast.visible && (
        <div
          role="status"
          aria-live="polite"
          data-testid="toast-notification"
          style={{
            position: 'fixed',
            bottom: 'var(--space-6)',
            right: 'var(--space-6)',
            zIndex: 9999,
            padding: 'var(--space-3) var(--space-5)',
            borderRadius: 'var(--radius-md)',
            background:
              toast.variant === 'error'
                ? 'var(--danger)'
                : toast.variant === 'success'
                ? 'var(--success)'
                : toast.variant === 'warning'
                ? 'var(--warning)'
                : 'var(--surface-2)',
            color: toast.variant === 'warning' ? 'var(--warning-contrast)' : 'var(--accent-contrast)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <span>{toast.message}</span>
          <button
            onClick={hideToast}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'currentColor',
              cursor: 'pointer',
              padding: 0,
              marginLeft: 'var(--space-2)',
              fontSize: 'var(--font-size-base)',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      {/* Confirmation Dialog Modal */}
      {confirmDialog && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="confirm-dialog"
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
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface)',
              borderRadius: 'var(--radius-lg)',
              border: 'var(--border-width) solid var(--border)',
              padding: 'var(--space-6)',
              maxWidth: '420px',
              width: '90%',
              boxShadow: 'var(--shadow-xl)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
              {confirmDialog.title || 'Confirm Action'}
            </h3>
            <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--muted)' }}>
              {confirmDialog.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmDialog.resolve(false)}
              >
                {confirmDialog.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => confirmDialog.resolve(true)}
              >
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageRuntimeContext.Provider>
  );
}

export function usePageRuntime() {
  const context = useContext(PageRuntimeContext);
  return context;
}
