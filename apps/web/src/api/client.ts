import { API_BASE_URL } from '../config';
import type { ErdTable } from '@config-platform/schema';

export class ApiError extends Error {
  public statusCode: number;
  public errors?: Record<string, string>;

  constructor(statusCode: number, message: string, errors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

let cachedCsrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/csrf`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      cachedCsrfToken = data.csrfToken;
      return data.csrfToken;
    }
  } catch {
    // ignore
  }
  return '';
}

export function getCsrfToken(): string | null {
  return cachedCsrfToken;
}

export function setCsrfToken(token: string) {
  cachedCsrfToken = token;
}

async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!cachedCsrfToken) {
      await fetchCsrfToken();
    }
    if (cachedCsrfToken && !headers.has('x-csrf-token')) {
      headers.set('x-csrf-token', cachedCsrfToken);
    }
  }

  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errBody: any = {};
    try {
      errBody = await res.json();
    } catch {
      errBody = { message: res.statusText };
    }
    throw new ApiError(
      res.status,
      errBody.message || 'An API error occurred',
      errBody.errors
    );
  }
  return res.json();
}

// ==========================================
// Auth API
// ==========================================

export interface CurrentUser {
  id: string;
  email: string;
  tenantId: string;
  tenantName?: string;
  role: 'owner' | 'admin' | 'builder' | 'editor' | 'viewer';
}

export interface MemberInfo {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'builder' | 'editor' | 'viewer';
  memberSince: string;
}

export async function fetchMe(): Promise<CurrentUser | null> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/auth/me`);
    if (res.status === 401) return null;
    return handleResponse<CurrentUser>(res);
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const user = await handleResponse<CurrentUser>(res);
  await fetchCsrfToken();
  return user;
}

export async function signup(email: string, password: string, tenantName?: string): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, tenantName }),
  });
  const user = await handleResponse<CurrentUser>(res);
  await fetchCsrfToken();
  return user;
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
  });
  cachedCsrfToken = null;
}

export async function forgotPassword(email: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse<{ success: boolean }>(res);
}

export interface InviteInfo {
  email: string;
  role: string;
  tenantName: string;
  userExists: boolean;
}

export async function fetchInviteInfo(token: string): Promise<InviteInfo> {
  const res = await apiFetch(`${API_BASE_URL}/auth/invite-info?token=${encodeURIComponent(token)}`);
  return handleResponse<InviteInfo>(res);
}

export async function acceptInvite(token: string, email: string, password: string): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/accept-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, password }),
  });
  return handleResponse<CurrentUser>(res);
}

export async function inviteMember(email: string, role: string): Promise<{ success: boolean; token: string }> {
  const res = await apiFetch(`${API_BASE_URL}/auth/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  return handleResponse<{ success: boolean; token: string }>(res);
}

export async function listMembers(): Promise<MemberInfo[]> {
  const res = await apiFetch(`${API_BASE_URL}/members`);
  return handleResponse<MemberInfo[]>(res);
}

export async function changeMemberRole(userId: string, role: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/members/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  return handleResponse<{ success: boolean }>(res);
}

export async function removeMember(userId: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/members/${userId}`, {
    method: 'DELETE',
  });
  return handleResponse<{ success: boolean }>(res);
}

export interface WorkspaceItem {
  tenantId: string;
  tenantName: string;
  role: 'owner' | 'admin' | 'builder' | 'editor' | 'viewer';
  isCurrent: boolean;
}

export async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  const res = await apiFetch(`${API_BASE_URL}/auth/workspaces`);
  return handleResponse<WorkspaceItem[]>(res);
}

export async function switchWorkspace(tenantId: string): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/switch-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });
  const user = await handleResponse<CurrentUser>(res);
  await fetchCsrfToken();
  return user;
}

export interface WorkspaceUsage {
  tenantId: string;
  plan: string;
  limits: {
    maxEntities: number;
    maxFieldsPerEntity: number;
    maxRecordsPerEntity: number;
    maxPages: number;
    maxMembers: number;
  };
  usage: {
    entities: number;
    pages: number;
    members: number;
  };
}

export async function fetchWorkspaceUsage(): Promise<WorkspaceUsage> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/usage`);
  return handleResponse<WorkspaceUsage>(res);
}

export async function exportWorkspace(): Promise<any> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/export`);
  return handleResponse<any>(res);
}

export async function importWorkspace(bundle: any, dryRun = false): Promise<any> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle, dryRun }),
  });
  return handleResponse<any>(res);
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: any;
  afterState: any;
  createdAt: string;
}

export async function fetchAuditLogs(params?: {
  limit?: number;
  offset?: number;
  entityType?: string;
  action?: string;
}): Promise<AuditLog[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.entityType) searchParams.set('entityType', params.entityType);
  if (params?.action) searchParams.set('action', params.action);

  const qs = searchParams.toString();
  const res = await apiFetch(`${API_BASE_URL}/audit-logs${qs ? `?${qs}` : ''}`);
  return handleResponse<AuditLog[]>(res);
}

// ==========================================
// Permissions API
// ==========================================

export interface EntityPermissionRecord {
  role: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export interface FieldPermissionRecord {
  fieldId: string;
  role: string;
  hidden: boolean;
  readOnly: boolean;
}

export async function fetchEntityPermissions(entityId: string): Promise<EntityPermissionRecord[]> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/permissions`);
  return handleResponse<EntityPermissionRecord[]>(res);
}

export async function setEntityPermission(
  entityId: string,
  role: string,
  permissions: { canRead?: boolean; canCreate?: boolean; canUpdate?: boolean; canDelete?: boolean }
): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/permissions/${role}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(permissions),
  });
  return handleResponse<{ success: boolean }>(res);
}

export async function fetchFieldPermissions(entityId: string): Promise<FieldPermissionRecord[]> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields/permissions`);
  return handleResponse<FieldPermissionRecord[]>(res);
}

export async function setFieldPermission(
  entityId: string,
  fieldId: string,
  role: string,
  permissions: { hidden?: boolean; readOnly?: boolean }
): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}/permissions/${role}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(permissions),
  });
  return handleResponse<{ success: boolean }>(res);
}

// ==========================================
// Schema Entities Endpoints
// ==========================================

export async function fetchSchemaEntities(_tenantId?: string): Promise<ErdTable[]> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<ErdTable[]>(res);
}

export interface FetchRecordsParams {
  limit?: number;
  cursor?: string | null;
  sort?: string;
  filter?: Record<string, any>;
}

export interface RecordsResponse {
  data: Record<string, any>[];
  nextCursor: string | null;
  total?: number;
}

export async function fetchRecords(
  _tenantId: string,
  entityId: string,
  params: FetchRecordsParams = {}
): Promise<RecordsResponse> {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.sort) search.set('sort', params.sort);

  if (params.filter) {
    for (const [field, ops] of Object.entries(params.filter)) {
      if (ops !== null && typeof ops === 'object') {
        for (const [op, val] of Object.entries(ops)) {
          if (val !== undefined && val !== null) {
            search.set(`filter[${field}][${op}]`, String(val));
          }
        }
      } else if (ops !== undefined && ops !== null) {
        search.set(`filter[${field}][eq]`, String(ops));
      }
    }
  }

  const queryStr = search.toString();
  const url = `${API_BASE_URL}/entities/${entityId}/records${queryStr ? `?${queryStr}` : ''}`;

  const res = await apiFetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<RecordsResponse>(res);
}

export async function createRecord(
  _tenantId: string,
  entityId: string,
  data: Record<string, any>
): Promise<Record<string, any>> {
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<Record<string, any>>(res);
}

export async function updateRecord(
  _tenantId: string,
  entityId: string,
  id: string,
  data: Record<string, any>
): Promise<Record<string, any>> {
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/records/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<Record<string, any>>(res);
}

export async function deleteRecord(
  _tenantId: string,
  entityId: string,
  id: string
): Promise<{ success: boolean; id: string }> {
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/records/${id}`, {
    method: 'DELETE',
  });
  return handleResponse<{ success: boolean; id: string }>(res);
}

export async function fetchRecord(
  _tenantId: string,
  entityId: string,
  id: string
): Promise<Record<string, any>> {
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/records/${id}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<Record<string, any>>(res);
}

export async function fetchAggregate(
  _tenantId: string,
  entityId: string,
  params: { op: string; field?: string; filter?: Record<string, any> }
): Promise<{ value: number | null; op: string; field: string }> {
  const query = new URLSearchParams();
  query.set('op', params.op);
  if (params.field) query.set('field', params.field);
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (typeof v === 'object' && v !== null) {
        for (const [op, val] of Object.entries(v)) {
          query.set(`filter[${k}][${op}]`, String(val));
        }
      } else {
        query.set(`filter[${k}][eq]`, String(v));
      }
    }
  }

  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/aggregate?${query.toString()}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<{ value: number | null; op: string; field: string }>(res);
}

// ==========================================
// Schema Management Endpoints (/studio/data)
// ==========================================

export async function createEntity(
  _tenantId: string,
  data: { name: string; label: string; fields?: any[]; displayFieldId?: string | null }
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function updateEntity(
  _tenantId: string,
  entityId: string,
  data: { label?: string; name?: string; displayFieldId?: string | null; expectedVersion: number }
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function deleteEntity(
  _tenantId: string,
  entityId: string,
  expectedVersion: number
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}?expectedVersion=${expectedVersion}`, {
    method: 'DELETE',
  });
  return handleResponse<any>(res);
}

export async function addField(
  _tenantId: string,
  entityId: string,
  data: { name: string; label: string; type: string; required?: boolean; unique?: boolean; config?: any; expectedVersion: number }
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function updateField(
  _tenantId: string,
  entityId: string,
  fieldId: string,
  data: { label?: string; name?: string; type?: string; required?: boolean; unique?: boolean; config?: any; expectedVersion: number }
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function deleteField(
  _tenantId: string,
  entityId: string,
  fieldId: string,
  expectedVersion: number
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}?expectedVersion=${expectedVersion}`, {
    method: 'DELETE',
  });
  return handleResponse<any>(res);
}

export async function reorderFields(
  _tenantId: string,
  entityId: string,
  fieldIds: string[]
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/fields/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fieldIds }),
  });
  return handleResponse<{ success: boolean }>(res);
}

export async function fetchLiveErd(_tenantId?: string) {
  const res = await apiFetch(`${API_BASE_URL}/schema/erd`);
  return handleResponse<any>(res);
}

export async function fetchLiveDdl(_tenantId?: string): Promise<string> {
  const res = await apiFetch(`${API_BASE_URL}/schema/ddl`);
  if (!res.ok) throw new ApiError(res.status, 'Failed to fetch live DDL');
  return res.text();
}

// ==========================================
// Pages Management Endpoints (/studio/pages)
// ==========================================

export interface PageSummary {
  id: string;
  name: string;
  route: string;
  version: number;
  hasDraft: boolean;
  hasPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PageDetail extends PageSummary {
  draft: any;
  published: any;
  brokenBindings: string[];
}

export async function fetchPages(_tenantId?: string): Promise<PageSummary[]> {
  const res = await apiFetch(`${API_BASE_URL}/pages`);
  return handleResponse<PageSummary[]>(res);
}

export async function fetchPublishedPages(_tenantId?: string): Promise<any[]> {
  const res = await apiFetch(`${API_BASE_URL}/pages/published`);
  return handleResponse<any[]>(res);
}

export async function fetchPage(_tenantId: string, pageId: string): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`);
  return handleResponse<PageDetail>(res);
}

export async function createPage(
  _tenantId: string,
  data: { name: string; route: string; draft?: any }
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<PageDetail>(res);
}

export async function updatePage(
  _tenantId: string,
  pageId: string,
  data: { name?: string; route?: string; draft?: any; expectedVersion?: number }
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<PageDetail>(res);
}

export async function publishPage(_tenantId: string, pageId: string): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}/publish`, {
    method: 'POST',
  });
  return handleResponse<PageDetail>(res);
}

export async function deletePage(_tenantId: string, pageId: string): Promise<{ success: boolean; id: string }> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`, {
    method: 'DELETE',
  });
  return handleResponse<{ success: boolean; id: string }>(res);
}
