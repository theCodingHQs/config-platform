import type { ActionDefinition } from '@config-platform/schema';
import { evaluateExpression, resolveTemplate, type ExpressionScope } from '@config-platform/schema';
import * as apiClient from '../api/client';

export interface ActionExecutionContext {
  tenantId: string;
  state: Record<string, any>;
  setState: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setKey: (key: string, value: any) => void;
  navigate: (url: string) => void;
  showToast: (message: string, variant?: 'info' | 'success' | 'warning' | 'error') => void;
  refetchDataSource: (sourceId?: string) => Promise<void>;
  createRecord: (entityId: string, data: Record<string, any>) => Promise<any>;
  updateRecord: (entityId: string, id: string, data: Record<string, any>) => Promise<any>;
  deleteRecord: (entityId: string, id: string) => Promise<any>;
  requestConfirm?: (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
}

/**
 * Resolves a value that could be an expression or template string or primitive
 */
function resolveValue(val: any, scope: ExpressionScope): any {
  if (typeof val === 'string') {
    return resolveTemplate(val, scope);
  }
  if (Array.isArray(val)) {
    return val.map((item) => resolveValue(item, scope));
  }
  if (val !== null && typeof val === 'object') {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = resolveValue(v, scope);
    }
    return res;
  }
  return val;
}

/**
 * Executes a chain of actions sequentially with condition checks and error handling
 */
export async function executeActionChain(
  actions: ActionDefinition[] | undefined,
  context: ActionExecutionContext,
  scope: ExpressionScope
): Promise<boolean> {
  if (!actions || actions.length === 0) {
    return true;
  }

  for (const action of actions) {
    // 1. Check condition (if)
    if (action.if) {
      try {
        const condResult = evaluateExpression(action.if, scope);
        if (!condResult) {
          // Condition failed / falsy -> skip this action
          continue;
        }
      } catch (err: any) {
        // If condition evaluation fails, treat as false or error
        console.error(`Condition evaluation failed for action ${action.type}:`, err);
        continue;
      }
    }

    // 2. Execute action
    try {
      const params = action.params || {};

      switch (action.type) {
        case 'navigate': {
          const rawUrl = params.url || params.to || '/';
          const resolvedUrl = String(resolveValue(rawUrl, scope));
          context.navigate(resolvedUrl);
          break;
        }

        case 'setState': {
          if (params.key !== undefined) {
            const resolvedVal = resolveValue(params.value, scope);
            context.setKey(params.key, resolvedVal);
            scope.state = { ...(scope.state || {}), [params.key]: resolvedVal };
          } else if (params.values && typeof params.values === 'object') {
            const resolvedValues = resolveValue(params.values, scope);
            context.setState((prev) => ({ ...prev, ...resolvedValues }));
            scope.state = { ...(scope.state || {}), ...resolvedValues };
          }
          break;
        }

        case 'openModal': {
          const modalKey = params.modalKey || (params.modalId ? `modal_${params.modalId}_open` : 'modal_open');
          context.setKey(modalKey, true);
          scope.state = { ...(scope.state || {}), [modalKey]: true };
          break;
        }

        case 'closeModal': {
          const modalKey = params.modalKey || (params.modalId ? `modal_${params.modalId}_open` : 'modal_open');
          context.setKey(modalKey, false);
          scope.state = { ...(scope.state || {}), [modalKey]: false };
          break;
        }

        case 'createRecord': {
          const entityId = String(resolveValue(params.entityId, scope));
          const data = resolveValue(params.data || {}, scope);
          const created = await context.createRecord(entityId, data);
          if (params.resultStateKey) {
            context.setKey(params.resultStateKey, created);
            scope.state = { ...(scope.state || {}), [params.resultStateKey]: created };
          }
          break;
        }

        case 'updateRecord': {
          const entityId = String(resolveValue(params.entityId, scope));
          const id = String(resolveValue(params.id || params.recordId, scope));
          const data = resolveValue(params.data || {}, scope);
          const updated = await context.updateRecord(entityId, id, data);
          if (params.resultStateKey) {
            context.setKey(params.resultStateKey, updated);
            scope.state = { ...(scope.state || {}), [params.resultStateKey]: updated };
          }
          break;
        }

        case 'deleteRecord': {
          const entityId = String(resolveValue(params.entityId, scope));
          const id = String(resolveValue(params.id || params.recordId, scope));
          await context.deleteRecord(entityId, id);
          break;
        }

        case 'refetch': {
          const source = params.source ? String(resolveValue(params.source, scope)) : undefined;
          await context.refetchDataSource(source);
          break;
        }

        case 'showToast': {
          const message = String(resolveValue(params.message || '', scope));
          const variant = params.variant || 'info';
          context.showToast(message, variant);
          break;
        }

        case 'confirm': {
          const title = params.title ? String(resolveValue(params.title, scope)) : undefined;
          const message = String(resolveValue(params.message || 'Are you sure?', scope));
          const confirmLabel = params.confirmLabel ? String(resolveValue(params.confirmLabel, scope)) : undefined;
          const cancelLabel = params.cancelLabel ? String(resolveValue(params.cancelLabel, scope)) : undefined;

          let confirmed = false;
          if (context.requestConfirm) {
            confirmed = await context.requestConfirm({ title, message, confirmLabel, cancelLabel });
          } else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            confirmed = window.confirm(message);
          } else {
            confirmed = true;
          }

          if (!confirmed) {
            // A cancelled or failed confirm stops the chain!
            return false;
          }
          break;
        }

        case 'exportCsv': {
          const source = params.source ? String(resolveValue(params.source, scope)) : undefined;
          const entityId = params.entityId ? String(resolveValue(params.entityId, scope)) : undefined;
          const rawFilename = params.filename ? String(resolveValue(params.filename, scope)) : 'export.csv';
          const filename = rawFilename.endsWith('.csv') ? rawFilename : `${rawFilename}.csv`;

          let rows: any[] = [];
          if (source && (scope.ds as any)?.[source]) {
            rows = (scope.ds as any)[source];
          } else if (entityId) {
            try {
              const res = await apiClient.fetchRecords(context.tenantId, entityId, { limit: 500 });
              rows = res.data || [];
            } catch (err: any) {
              console.error('Failed to fetch records for CSV export:', err);
              context.showToast('Failed to fetch data for export', 'error');
              break;
            }
          }

          if (!rows || rows.length === 0) {
            context.showToast('No records available to export', 'warning');
            break;
          }

          // Build CSV content
          const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
          const headerLine = allKeys.map((k) => `"${String(k).replace(/"/g, '""')}"`).join(',');
          const rowLines = rows.map((r) =>
            allKeys
              .map((k) => {
                const val = r[k];
                if (val === null || val === undefined) return '""';
                if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
                return `"${String(val).replace(/"/g, '""')}"`;
              })
              .join(',')
          );
          const csvContent = [headerLine, ...rowLines].join('\r\n');

          if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            try {
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (typeof URL.revokeObjectURL === 'function') {
                  URL.revokeObjectURL(url);
                }
              }
            } catch (dlErr) {
              console.warn('CSV file download helper:', dlErr);
            }
          }

          context.showToast(`Exported ${rows.length} records to ${filename}`, 'success');
          break;
        }

        default:
          console.warn(`Unknown action type: ${(action as any).type}`);
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Action execution failed';
      // A failure stops the chain, then runs onError if present, else shows a toast
      if (action.onError && action.onError.length > 0) {
        const errorScope: ExpressionScope = {
          ...scope,
          error: { message: errorMessage, ...err },
        };
        await executeActionChain(action.onError, context, errorScope);
      } else {
        context.showToast(errorMessage, 'error');
      }
      return false; // Stop the chain!
    }
  }

  return true;
}
