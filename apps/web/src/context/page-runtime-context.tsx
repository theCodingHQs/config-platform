import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type {
  PageDefinition,
  DataSourceDefinition,
  ActionDefinition,
  ExpressionScope,
} from "@config-platform/schema";
import { evaluateExpression, resolveTemplate } from "@config-platform/schema";
import * as apiClient from "../api/client";
import {
  executeActionChain,
  type ActionExecutionContext,
} from "../renderer/action-runner";
import { useOptionalMetadata } from "./metadata-context";
import { useLiveScope } from "../live/use-live";
import { useLiveRecordRefresh } from "../live/use-live-records";

/**
 * Resolves a data source filter value. A dynamic value ("{{ state.search }}") that resolves
 * to nothing means "not filtering on this" (e.g. an empty search box), so it is dropped
 * instead of being sent; literal values are kept as written.
 */
export function resolveDynamicFilterValue(value: string, scope: ExpressionScope): string | undefined {
  if (!value.includes("{{")) return value;
  const resolved = resolveTemplate(value, scope);
  return resolved === undefined || resolved === null || String(resolved).trim() === "" ? undefined : resolved;
}

export interface ToastState {
  message: string;
  variant: "info" | "success" | "warning" | "error";
  visible: boolean;
}

export interface DataSourceState {
  /** Entity the source reads, and its filter with {{ }} values resolved (as sent to the API). */
  entityId: string;
  filter?: Record<string, any>;
  /** The loaded page of records (see pageSize); use server aggregates for totals. */
  data: any[];
  total?: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  pageIndex: number;
  pageSize: number;
  nextCursor: string | null;
  hasMore: boolean;
  goToNextPage: () => Promise<void>;
  goToPrevPage: () => Promise<void>;
  setPageSize: (size: number) => Promise<void>;
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
  runActionChain: (
    actions: ActionDefinition[] | undefined,
    extraScope?: Partial<ExpressionScope>,
  ) => Promise<boolean>;
  toast: ToastState;
  showToast: (
    message: string,
    variant?: "info" | "success" | "warning" | "error",
  ) => void;
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
const DEFAULT_USER: Record<string, any> = {
  id: "u_admin",
  name: "Admin",
  role: "admin",
};
const DEFAULT_PAGE: PageDefinition = {
  id: "default",
  schemaVersion: 2,
  version: 1,
  route: "/",
  state: {},
  dataSources: [],
  root: { id: "root", type: "stack", props: {} },
};

export function PageRuntimeProvider({
  tenantId = "default",
  page = DEFAULT_PAGE,
  initialState,
  initialDataSources,
  params = DEFAULT_PARAMS,
  user = DEFAULT_USER,
  navigate = (url: string) => {
    if (typeof window !== "undefined") {
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
    message: "",
    variant: "info",
    visible: false,
  });

  const toastTimerRef = useRef<any>(null);

  const showToast = useCallback(
    (
      message: string,
      variant: "info" | "success" | "warning" | "error" = "info",
    ) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ message, variant, visible: true });
      toastTimerRef.current = setTimeout(() => {
        setToast((prev) => ({ ...prev, visible: false }));
      }, 4000);
    },
    [],
  );

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
    (options: {
      title?: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }) => {
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
    [],
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
  const [dsData, setDsData] = useState<
    Record<
      string,
      {
        data: any[];
        total?: number;
        nextCursor: string | null;
        loading: boolean;
        error: string | null;
      }
    >
  >({});
  const [dsPagination, setDsPagination] = useState<
    Record<
      string,
      {
        cursorStack: (string | null)[];
        pageIndex: number;
        pageSize?: number;
      }
    >
  >({});
  const [manualRefetchCounters, setManualRefetchCounters] = useState<
    Record<string, number>
  >({});

  const refetchDataSource = useCallback(
    async (sourceId?: string) => {
      // 1. Invalidate TanStack query cache for direct entity queries (Table, Stat, Chart)
      if (queryClient) {
        if (sourceId) {
          queryClient.invalidateQueries({
            queryKey: ["records", tenantId, sourceId],
          });
          queryClient.invalidateQueries({
            queryKey: ["aggregate", tenantId, sourceId],
          });
          queryClient.invalidateQueries({
            queryKey: ["chart-records", tenantId, sourceId],
          });
        } else {
          queryClient.invalidateQueries({ queryKey: ["records"] });
          queryClient.invalidateQueries({ queryKey: ["aggregate"] });
          queryClient.invalidateQueries({ queryKey: ["chart-records"] });
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
    },
    [page?.dataSources, initialDataSources, queryClient, tenantId],
  );

  const goToNextPage = useCallback(
    async (dsId: string) => {
      const currentData = dsData[dsId];
      const nextCursor = currentData?.nextCursor;
      if (!nextCursor) return;

      setDsPagination((prev) => {
        const cur = prev[dsId] || { cursorStack: [null], pageIndex: 0 };
        const nextIndex = cur.pageIndex + 1;
        const nextStack = [...cur.cursorStack];
        if (nextIndex >= nextStack.length) {
          nextStack.push(nextCursor);
        } else {
          nextStack[nextIndex] = nextCursor;
        }
        return {
          ...prev,
          [dsId]: {
            ...cur,
            cursorStack: nextStack,
            pageIndex: nextIndex,
          },
        };
      });
    },
    [dsData],
  );

  const goToPrevPage = useCallback(async (dsId: string) => {
    setDsPagination((prev) => {
      const cur = prev[dsId] || { cursorStack: [null], pageIndex: 0 };
      if (cur.pageIndex <= 0) return prev;
      return {
        ...prev,
        [dsId]: {
          ...cur,
          pageIndex: cur.pageIndex - 1,
        },
      };
    });
  }, []);

  const setDsPageSize = useCallback(async (dsId: string, size: number) => {
    setDsPagination((prev) => ({
      ...prev,
      [dsId]: {
        cursorStack: [null],
        pageIndex: 0,
        pageSize: size,
      },
    }));
  }, []);

  const stateJson = JSON.stringify(pageState);
  const dataSourcesList = initialDataSources || page?.dataSources || [];
  const dataSourcesJson = JSON.stringify(dataSourcesList);

  // Evaluate filters for each data source
  const evaluatedDataSources = useMemo(() => {
    const list = dataSourcesList;
    return list.map((ds) => {
      let resolvedFilter: Record<string, any> | undefined = undefined;
      if (ds.filter && typeof ds.filter === "object") {
        resolvedFilter = {};
        for (const [k, v] of Object.entries(ds.filter)) {
          if (typeof v === "string") {
            const resolved = resolveDynamicFilterValue(v, baseScope);
            if (resolved !== undefined) resolvedFilter[k] = resolved;
          } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            // Operator filters ({ contains: "{{ state.search }}" }) resolve each operand
            const ops: Record<string, any> = {};
            for (const [op, operand] of Object.entries(v)) {
              const resolved = typeof operand === "string" ? resolveDynamicFilterValue(operand, baseScope) : operand;
              if (resolved !== undefined) ops[op] = resolved;
            }
            if (Object.keys(ops).length > 0) resolvedFilter[k] = ops;
          } else {
            resolvedFilter[k] = v;
          }
        }
      }

      const pagination = dsPagination[ds.id];
      const pageIndex = pagination?.pageIndex ?? 0;
      const cursorStack = pagination?.cursorStack ?? [null];
      const currentCursor = cursorStack[pageIndex] ?? null;
      const currentLimit = pagination?.pageSize ?? ds.limit ?? 10;

      return {
        id: ds.id,
        entityId: ds.entityId,
        filter: resolvedFilter,
        sort: ds.sort,
        limit: currentLimit,
        cursor: currentCursor,
        pageIndex,
        cursorStack,
      };
    });
  }, [dataSourcesList, stateJson, baseScope, dsPagination]);

  // Reset pagination if filter expressions dynamically change
  const filterStrings = useMemo(() => {
    const res: Record<string, string> = {};
    for (const ds of evaluatedDataSources) {
      res[ds.id] = JSON.stringify(ds.filter);
    }
    return res;
  }, [evaluatedDataSources]);

  const prevFiltersRef = useRef<Record<string, string>>({});
  useEffect(() => {
    let changed = false;
    const nextPag = { ...dsPagination };
    for (const [id, filterStr] of Object.entries(filterStrings)) {
      if (
        prevFiltersRef.current[id] !== undefined &&
        prevFiltersRef.current[id] !== filterStr
      ) {
        if (
          nextPag[id] &&
          (nextPag[id].pageIndex > 0 || nextPag[id].cursorStack.length > 1)
        ) {
          nextPag[id] = {
            cursorStack: [null],
            pageIndex: 0,
            pageSize: nextPag[id].pageSize,
          };
          changed = true;
        }
      }
      prevFiltersRef.current[id] = filterStr;
    }
    if (changed) {
      setDsPagination(nextPag);
    }
  }, [filterStrings, dsPagination]);

  const lastFetchedKeyRef = useRef<Record<string, string>>({});

  // Fetch / refetch data sources when evaluated query parameters or manual trigger change
  useEffect(() => {
    let isCancelled = false;

    evaluatedDataSources.forEach((ds) => {
      const refetchTrigger =
        (manualRefetchCounters[ds.id] || 0) +
        (manualRefetchCounters.__all__ || 0);
      const queryKey = `${tenantId}:${ds.entityId}:${JSON.stringify(ds.filter)}:${JSON.stringify(ds.sort)}:${ds.limit}:${ds.cursor || "null"}:${refetchTrigger}`;

      // Skip fetching if this exact queryKey was already fetched and data is loaded
      if (
        lastFetchedKeyRef.current[ds.id] === queryKey &&
        dsData[ds.id]?.data !== undefined &&
        !dsData[ds.id]?.loading
      ) {
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
            nextCursor: prev[ds.id]?.nextCursor || null,
            loading: true,
            error: null,
          },
        };
      });

      // Check if duplicate query is already in flight
      let fetchPromise = inFlightQueries.get(queryKey);
      if (!fetchPromise) {
        const sortOrder =
          (ds.sort as any)?.order || (ds.sort as any)?.direction;
        const sortParam = ds.sort
          ? `${sortOrder === "desc" ? "-" : ""}${ds.sort.fieldId}`
          : undefined;
        fetchPromise = apiClient
          .fetchRecords(tenantId, ds.entityId, {
            filter: ds.filter,
            sort: sortParam,
            limit: ds.limit,
            cursor: ds.cursor,
            count: true,
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
                nextCursor: res.nextCursor || null,
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
                total: 0,
                nextCursor: null,
                loading: false,
                error: err?.message || "Failed to load data",
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
    const filtersById = new Map(evaluatedDataSources.map((ds) => [ds.id, ds.filter]));
    for (const ds of dataSourcesList) {
      const info = dsData[ds.id] || {
        data: [],
        loading: true,
        error: null,
        nextCursor: null,
      };
      const pag = dsPagination[ds.id];
      const pageIndex = pag?.pageIndex ?? 0;
      const pageSize = pag?.pageSize ?? ds.limit ?? 10;
      const hasMore = Boolean(info.nextCursor);

      res[ds.id] = {
        entityId: ds.entityId,
        filter: filtersById.get(ds.id),
        data: info.data,
        total: info.total,
        loading: info.loading,
        error: info.error,
        refetch: () => refetchDataSource(ds.id),
        pageIndex,
        pageSize,
        nextCursor: info.nextCursor || null,
        hasMore,
        goToNextPage: () => goToNextPage(ds.id),
        goToPrevPage: () => goToPrevPage(ds.id),
        setPageSize: (size: number) => setDsPageSize(ds.id, size),
      };
    }
    return res;
  }, [
    dataSourcesList,
    evaluatedDataSources,
    dsData,
    dsPagination,
    refetchDataSource,
    goToNextPage,
    goToPrevPage,
    setDsPageSize,
  ]);

  // Live machine data for the tags this page mentions ({{ live.line1.speed }}). Only in the scope
  // used for showing and actions: data source queries don't re-run on every live update.
  const liveScope = useLiveScope(page);
  // Tables, stats and data sources reload when anyone saves records they show
  useLiveRecordRefresh({ page, queryClient: queryClient ?? undefined, refetchDataSource });

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
      ...liveScope,
    };
  }, [pageState, params, user, dataSources, liveScope]);

  const metadata = useOptionalMetadata();

  const sanitizeActionData = useCallback(
    (entityId: string, data: Record<string, any>) => {
      const SYSTEM_KEYS = new Set(["id", "created_at", "updated_at"]);
      const clean: Record<string, any> = {};
      if (!data || typeof data !== "object") return clean;

      const entity = metadata?.resolveEntity(entityId);
      const fieldMap = new Map<string, any>();
      if (entity) {
        for (const col of entity.columns || entity.fields || []) {
          fieldMap.set(col.name, col);
          fieldMap.set(col.id, col);
        }
      }

      for (const [k, v] of Object.entries(data)) {
        if (SYSTEM_KEYS.has(k)) continue;

        if (entity && fieldMap.size > 0) {
          const col = fieldMap.get(k);
          if (!col) continue; // Exclude fields not configured in entity
          if (SYSTEM_KEYS.has(col.name) || SYSTEM_KEYS.has(col.id)) continue;
          clean[col.name] = v;
        } else {
          clean[k] = v;
        }
      }
      return clean;
    },
    [metadata],
  );

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
      createRecord: (entityId, data) =>
        apiClient.createRecord(
          tenantId,
          entityId,
          sanitizeActionData(entityId, data),
        ),
      updateRecord: (entityId, id, data) =>
        apiClient.updateRecord(
          tenantId,
          entityId,
          id,
          sanitizeActionData(entityId, data),
        ),
      deleteRecord: (entityId, id) =>
        apiClient.deleteRecord(tenantId, entityId, id),
      requestConfirm,
    };
  }, [
    tenantId,
    pageState,
    setKey,
    navigate,
    showToast,
    refetchDataSource,
    requestConfirm,
    sanitizeActionData,
  ]);

  const runActionChain = useCallback(
    async (
      actions: ActionDefinition[] | undefined,
      extraScope: Partial<ExpressionScope> = {},
    ) => {
      const currentScope: ExpressionScope = {
        ...fullScope,
        ...extraScope,
        state: pageState,
      };
      return executeActionChain(actions, actionContext, currentScope);
    },
    [fullScope, pageState, actionContext],
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
            position: "fixed",
            bottom: "var(--space-6)",
            right: "var(--space-6)",
            zIndex: 9999,
            padding: "var(--space-3) var(--space-5)",
            borderRadius: "var(--radius-control)",
            background:
              toast.variant === "error"
                ? "var(--danger)"
                : toast.variant === "success"
                  ? "var(--success)"
                  : toast.variant === "warning"
                    ? "var(--warning)"
                    : "var(--surface-2)",
            color:
              toast.variant === "warning"
                ? "var(--warning-contrast)"
                : "var(--accent-contrast)",
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <span>{toast.message}</span>
          <button
            onClick={hideToast}
            style={{
              background: "transparent",
              border: "none",
              color: "currentColor",
              cursor: "pointer",
              padding: 0,
              marginLeft: "var(--space-2)",
              fontSize: "var(--font-size-base)",
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
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "var(--overlay-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              borderRadius: "var(--radius-surface)",
              border: "var(--border-width) solid var(--border)",
              padding: "var(--space-6)",
              maxWidth: "420px",
              width: "90%",
              boxShadow: "var(--shadow-xl)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "var(--font-size-lg)",
                fontWeight: 600,
              }}
            >
              {confirmDialog.title || "Confirm Action"}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "var(--font-size-sm)",
                color: "var(--muted)",
              }}
            >
              {confirmDialog.message}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                marginTop: "var(--space-2)",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmDialog.resolve(false)}
              >
                {confirmDialog.cancelLabel || "Cancel"}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => confirmDialog.resolve(true)}
              >
                {confirmDialog.confirmLabel || "Confirm"}
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
