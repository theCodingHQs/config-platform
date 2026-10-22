import { API_BASE_URL } from "../config";
import type {
  ErdTable,
  WorkspaceThemeConfig,
  ImportOptions,
  ImportPreviewResult,
  ImportDryRunResult,
  ImportCommitResult,
  UserDatePreferences,
  WorkspaceDateSettings,
  WizardAnalysis,
  WizardPlan,
} from "@config-platform/schema";

export class ApiError extends Error {
  public statusCode: number;
  public errors?: Record<string, string>;

  constructor(
    statusCode: number,
    message: string,
    errors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

let cachedCsrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/csrf`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      cachedCsrfToken = data.csrfToken;
      return data.csrfToken;
    }
  } catch {
    // ignore
  }
  return "";
}

export function getCsrfToken(): string | null {
  return cachedCsrfToken;
}

export function setCsrfToken(token: string) {
  cachedCsrfToken = token;
}

export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    if (!cachedCsrfToken) {
      await fetchCsrfToken();
    }
    if (cachedCsrfToken && !headers.has("x-csrf-token")) {
      headers.set("x-csrf-token", cachedCsrfToken);
    }
  }

  return fetch(url, {
    ...init,
    headers,
    credentials: "include",
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
      errBody.message || "An API error occurred",
      errBody.errors,
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
  role: "owner" | "admin" | "builder" | "editor" | "viewer";
  /** The user's own date display choices (absent keys = workspace default). */
  datePreferences?: UserDatePreferences;
}

export interface MemberInfo {
  id: string;
  email: string;
  role: "owner" | "admin" | "builder" | "editor" | "viewer";
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

/** Workspace date defaults (Settings → Regional). */
export async function fetchWorkspaceDateSettings(): Promise<WorkspaceDateSettings> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/date-settings`);
  return handleResponse<WorkspaceDateSettings>(res);
}

export async function updateWorkspaceDateSettings(settings: WorkspaceDateSettings): Promise<WorkspaceDateSettings> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/date-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return handleResponse<WorkspaceDateSettings>(res);
}

/** Replaces the signed-in user's date preferences (omitted keys = workspace default). */
export async function updateMyDatePreferences(preferences: UserDatePreferences): Promise<UserDatePreferences> {
  const res = await apiFetch(`${API_BASE_URL}/auth/date-preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  return (await handleResponse<{ datePreferences: UserDatePreferences }>(res)).datePreferences;
}

export async function login(
  email: string,
  password: string,
): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const user = await handleResponse<CurrentUser>(res);
  await fetchCsrfToken();
  return user;
}

export async function signup(
  email: string,
  password: string,
  tenantName?: string,
): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenantName }),
  });
  const user = await handleResponse<CurrentUser>(res);
  await fetchCsrfToken();
  return user;
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
  });
  cachedCsrfToken = null;
}

export async function forgotPassword(
  email: string,
): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const res = await apiFetch(
    `${API_BASE_URL}/auth/invite-info?token=${encodeURIComponent(token)}`,
  );
  return handleResponse<InviteInfo>(res);
}

export async function acceptInvite(
  token: string,
  email: string,
  password: string,
): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, email, password }),
  });
  return handleResponse<CurrentUser>(res);
}

export async function inviteMember(
  email: string,
  role: string,
): Promise<{ success: boolean; token: string }> {
  const res = await apiFetch(`${API_BASE_URL}/auth/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  return handleResponse<{ success: boolean; token: string }>(res);
}

export async function listMembers(): Promise<MemberInfo[]> {
  const res = await apiFetch(`${API_BASE_URL}/members`);
  return handleResponse<MemberInfo[]>(res);
}

export async function changeMemberRole(
  userId: string,
  role: string,
): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/members/${userId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return handleResponse<{ success: boolean }>(res);
}

export async function removeMember(
  userId: string,
): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/members/${userId}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean }>(res);
}

export interface WorkspaceItem {
  tenantId: string;
  tenantName: string;
  role: "owner" | "admin" | "builder" | "editor" | "viewer";
  isCurrent: boolean;
}

export async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  const res = await apiFetch(`${API_BASE_URL}/auth/workspaces`);
  return handleResponse<WorkspaceItem[]>(res);
}

export async function switchWorkspace(tenantId: string): Promise<CurrentUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/switch-workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export async function importWorkspace(
  bundle: any,
  dryRun = false,
): Promise<any> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.entityType) searchParams.set("entityType", params.entityType);
  if (params?.action) searchParams.set("action", params.action);

  const qs = searchParams.toString();
  const res = await apiFetch(`${API_BASE_URL}/audit-logs${qs ? `?${qs}` : ""}`);
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
  canExport?: boolean;
}

export interface FieldPermissionRecord {
  fieldId: string;
  role: string;
  hidden: boolean;
  readOnly: boolean;
}

export async function fetchEntityPermissions(
  entityId: string,
): Promise<EntityPermissionRecord[]> {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/permissions`,
  );
  return handleResponse<EntityPermissionRecord[]>(res);
}

export async function setEntityPermission(
  entityId: string,
  role: string,
  permissions: {
    canRead?: boolean;
    canCreate?: boolean;
    canUpdate?: boolean;
    canDelete?: boolean;
    canExport?: boolean;
  },
): Promise<{ success: boolean }> {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/permissions/${role}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(permissions),
    },
  );
  return handleResponse<{ success: boolean }>(res);
}

export async function fetchFieldPermissions(
  entityId: string,
): Promise<FieldPermissionRecord[]> {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields/permissions`,
  );
  return handleResponse<FieldPermissionRecord[]>(res);
}

export async function setFieldPermission(
  entityId: string,
  fieldId: string,
  role: string,
  permissions: { hidden?: boolean; readOnly?: boolean },
): Promise<{ success: boolean }> {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}/permissions/${role}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(permissions),
    },
  );
  return handleResponse<{ success: boolean }>(res);
}

// ==========================================
// Schema Entities Endpoints
// ==========================================

export async function fetchSchemaEntities(
  _tenantId?: string,
): Promise<ErdTable[]> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities`, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  return handleResponse<ErdTable[]>(res);
}

export interface FetchRecordsParams {
  limit?: number;
  cursor?: string | null;
  sort?: string;
  filter?: Record<string, any>;
  count?: boolean;
}

export interface RecordsResponse {
  data: Record<string, any>[];
  nextCursor: string | null;
  total?: number;
}

export async function fetchRecords(
  _tenantId: string,
  entityId: string,
  params: FetchRecordsParams = {},
): Promise<RecordsResponse> {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.sort) search.set("sort", params.sort);
  if (params.count !== false) search.set("count", "true");

  if (params.filter) {
    for (const [field, ops] of Object.entries(params.filter)) {
      if (ops !== null && typeof ops === "object") {
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
  const url = `${API_BASE_URL}/entities/${entityId}/records${queryStr ? `?${queryStr}` : ""}`;

  const res = await apiFetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  return handleResponse<RecordsResponse>(res);
}

export async function createRecord(
  _tenantId: string,
  entityId: string,
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k !== 'id' && k !== 'created_at' && k !== 'updated_at') {
      sanitized[k] = v;
    }
  }
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sanitized),
  });
  return handleResponse<Record<string, any>>(res);
}

export async function updateRecord(
  _tenantId: string,
  entityId: string,
  id: string,
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k !== 'id' && k !== 'created_at' && k !== 'updated_at') {
      sanitized[k] = v;
    }
  }
  const res = await apiFetch(
    `${API_BASE_URL}/entities/${entityId}/records/${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitized),
    },
  );
  return handleResponse<Record<string, any>>(res);
}

export async function deleteRecord(
  _tenantId: string,
  entityId: string,
  id: string,
): Promise<{ success: boolean; id: string }> {
  const res = await apiFetch(
    `${API_BASE_URL}/entities/${entityId}/records/${id}`,
    {
      method: "DELETE",
    },
  );
  return handleResponse<{ success: boolean; id: string }>(res);
}

export async function fetchRecord(
  _tenantId: string,
  entityId: string,
  id: string,
): Promise<Record<string, any>> {
  const res = await apiFetch(
    `${API_BASE_URL}/entities/${entityId}/records/${id}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  return handleResponse<Record<string, any>>(res);
}

export interface EntityPermissionsResponse {
  entityId: string;
  role: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  fields: Record<string, { hidden: boolean; readOnly: boolean }>;
}

export async function fetchMyEntityPermissions(
  entityId: string,
): Promise<EntityPermissionsResponse> {
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/permissions`);
  return handleResponse<EntityPermissionsResponse>(res);
}

export async function fetchAggregate(
  _tenantId: string,
  entityId: string,
  params: { op: string; field?: string; filter?: Record<string, any> },
): Promise<{ value: number | null; op: string; field: string }> {
  const query = new URLSearchParams();
  query.set("op", params.op);
  if (params.field) query.set("field", params.field);
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (typeof v === "object" && v !== null) {
        for (const [op, val] of Object.entries(v)) {
          query.set(`filter[${k}][${op}]`, String(val));
        }
      } else {
        query.set(`filter[${k}][eq]`, String(v));
      }
    }
  }

  const res = await apiFetch(
    `${API_BASE_URL}/entities/${entityId}/aggregate?${query.toString()}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  return handleResponse<{ value: number | null; op: string; field: string }>(
    res,
  );
}

export interface AggregateGroupsResult {
  groups: Array<{ key: unknown; value: number | null }>;
  /** More groups exist than requested; the first ones (in key order) were returned. */
  groupsTruncated: boolean;
}

/**
 * Totals per group, calculated by the server over every matching record (not just a loaded
 * page), e.g. "sum of days on target per machine". The server returns at most 50 groups.
 */
export async function fetchAggregateGroups(
  entityId: string,
  params: { op: string; field?: string; groupBy: string; filter?: Record<string, any>; groupLimit?: number },
): Promise<AggregateGroupsResult> {
  const query = new URLSearchParams();
  query.set("op", params.op);
  if (params.field) query.set("field", params.field);
  query.set("groupBy", params.groupBy);
  query.set("groupLimit", String(params.groupLimit ?? 50));
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (typeof v === "object" && v !== null) {
        for (const [op, val] of Object.entries(v)) {
          if (val !== undefined && val !== null) query.set(`filter[${k}][${op}]`, String(val));
        }
      } else if (v !== undefined && v !== null) {
        query.set(`filter[${k}][eq]`, String(v));
      }
    }
  }
  const res = await apiFetch(`${API_BASE_URL}/entities/${entityId}/aggregate?${query.toString()}`, {
    headers: { "Content-Type": "application/json" },
  });
  const body = await handleResponse<{ groups?: AggregateGroupsResult["groups"]; groupsTruncated?: boolean }>(res);
  return { groups: body.groups ?? [], groupsTruncated: Boolean(body.groupsTruncated) };
}

// ==========================================
// Schema Management Endpoints (/studio/data)
// ==========================================

export async function createEntity(
  _tenantId: string,
  data: {
    name: string;
    label: string;
    icon?: string | null;
    fields?: any[];
    displayFieldId?: string | null;
  },
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function updateEntity(
  _tenantId: string,
  entityId: string,
  data: {
    label?: string;
    name?: string;
    icon?: string | null;
    displayFieldId?: string | null;
    expectedVersion: number;
  },
) {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<any>(res);
}

export async function deleteEntity(
  _tenantId: string,
  entityId: string,
  expectedVersion: number,
) {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}?expectedVersion=${expectedVersion}`,
    {
      method: "DELETE",
    },
  );
  return handleResponse<any>(res);
}

export async function addField(
  _tenantId: string,
  entityId: string,
  data: {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    unique?: boolean;
    config?: any;
    expectedVersion: number;
  },
) {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  return handleResponse<any>(res);
}

/** Replaces an entity's unique combinations (field ids); rules without an id are new. */
export async function setUniqueRules(
  entityId: string,
  rules: Array<{ id?: string; fields: string[] }>,
  expectedVersion: number,
): Promise<{ uniqueRules: Array<{ id: string; fields: string[] }> }> {
  const res = await apiFetch(`${API_BASE_URL}/schema/entities/${entityId}/unique-rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules, expectedVersion }),
  });
  return handleResponse(res);
}

export async function updateField(
  _tenantId: string,
  entityId: string,
  fieldId: string,
  data: {
    label?: string;
    name?: string;
    type?: string;
    required?: boolean;
    unique?: boolean;
    config?: any;
    expectedVersion: number;
  },
) {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  return handleResponse<any>(res);
}

export async function deleteField(
  _tenantId: string,
  entityId: string,
  fieldId: string,
  expectedVersion: number,
) {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields/${fieldId}?expectedVersion=${expectedVersion}`,
    {
      method: "DELETE",
    },
  );
  return handleResponse<any>(res);
}

export async function reorderFields(
  _tenantId: string,
  entityId: string,
  fieldIds: string[],
) {
  const res = await apiFetch(
    `${API_BASE_URL}/schema/entities/${entityId}/fields/reorder`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldIds }),
    },
  );
  return handleResponse<{ success: boolean }>(res);
}

export async function fetchLiveErd(_tenantId?: string) {
  const res = await apiFetch(`${API_BASE_URL}/schema/erd`);
  return handleResponse<any>(res);
}

export async function fetchLiveDdl(_tenantId?: string): Promise<string> {
  const res = await apiFetch(`${API_BASE_URL}/schema/ddl`);
  if (!res.ok) throw new ApiError(res.status, "Failed to fetch live DDL");
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
  folderId?: string | null;
  position?: number;
  allowedRoles?: string[] | null;
  /** Navigation icon override; null/absent = derived automatically. */
  icon?: string | null;
  /** 'full' = always full width; null/absent = follows the theme content width. */
  width?: "full" | null;
}

export interface PageNavFolder {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  position: number;
  icon?: string | null;
}

export interface PageSettingsUpdate {
  name?: string;
  /** Last route segment; the full route is rebuilt from the page's group. */
  slug?: string;
  folderId?: string | null;
  width?: "theme" | "full";
  /** null clears the override. */
  icon?: string | null;
}

export async function updatePageSettings(pageId: string, data: PageSettingsUpdate): Promise<PageSummary> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<PageSummary>(res);
}

export interface PageNavigation {
  folders: PageNavFolder[];
  pages: PageSummary[];
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

export async function fetchPageNavigation(_tenantId?: string): Promise<PageNavigation> {
  const res = await apiFetch(`${API_BASE_URL}/pages/navigation`);
  return handleResponse<PageNavigation>(res);
}

export async function createPageFolder(
  data: { name: string; parentId?: string | null; icon?: string | null },
): Promise<PageNavFolder> {
  const res = await apiFetch(`${API_BASE_URL}/pages/navigation/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<PageNavFolder>(res);
}

export async function updatePageFolder(
  folderId: string,
  data: { name?: string; parentId?: string | null; icon?: string | null },
): Promise<PageNavFolder> {
  const res = await apiFetch(`${API_BASE_URL}/pages/navigation/folders/${folderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<PageNavFolder>(res);
}

export async function deletePageFolder(folderId: string): Promise<{ success: boolean; id: string }> {
  const res = await apiFetch(`${API_BASE_URL}/pages/navigation/folders/${folderId}`, { method: "DELETE" });
  return handleResponse<{ success: boolean; id: string }>(res);
}

export async function movePageToFolder(pageId: string, folderId: string | null): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}/navigation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  await handleResponse<{ success: boolean; id: string }>(res);
}

export async function fetchPublishedPages(_tenantId?: string): Promise<any[]> {
  const res = await apiFetch(`${API_BASE_URL}/pages/published`);
  return handleResponse<any[]>(res);
}

export async function fetchPage(
  _tenantId: string,
  pageId: string,
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`);
  return handleResponse<PageDetail>(res);
}

export async function createPage(
  _tenantId: string,
  data: {
    name: string;
    route: string;
    draft?: any;
    folderId?: string | null;
    width?: "theme" | "full";
    icon?: string | null;
  },
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<PageDetail>(res);
}

export async function updatePage(
  _tenantId: string,
  pageId: string,
  data: {
    name?: string;
    route?: string;
    draft?: any;
    expectedVersion?: number;
  },
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<PageDetail>(res);
}

export async function publishPage(
  _tenantId: string,
  pageId: string,
): Promise<PageDetail> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}/publish`, {
    method: "POST",
  });
  return handleResponse<PageDetail>(res);
}

export async function deletePage(
  _tenantId: string,
  pageId: string,
): Promise<{ success: boolean; id: string }> {
  const res = await apiFetch(`${API_BASE_URL}/pages/${pageId}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean; id: string }>(res);
}

export interface WorkspaceThemeResponse {
  themeConfig: WorkspaceThemeConfig;
  themeEditing: 'enabled' | 'locked';
  defaultPreset: string;
}

export async function fetchWorkspaceTheme(): Promise<WorkspaceThemeResponse> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/theme`);
  return handleResponse<WorkspaceThemeResponse>(res);
}

export async function updateWorkspaceTheme(
  themeConfig: WorkspaceThemeConfig
): Promise<{ success: boolean; themeConfig: WorkspaceThemeConfig; warning?: string }> {
  const res = await apiFetch(`${API_BASE_URL}/workspace/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(themeConfig),
  });
  return handleResponse<{ success: boolean; themeConfig: WorkspaceThemeConfig; warning?: string }>(res);
}

export interface SolutionTemplateCard {
  id: string;
  name: string;
  summary: string;
  description: string;
  icon: string;
  folder: string;
  entities: string[];
  pages: string[];
  reports: string[];
  hasSampleData: boolean;
}

export interface SolutionInstallResult {
  templateId: string;
  entities: Array<{ id: string; label: string; reused: boolean }>;
  pages: Array<{ id: string; name: string; route: string }>;
  reports: Array<{ id: string; name: string }>;
  sampleRecords: number;
  warnings: string[];
}

/** The template gallery (ready-made apps). */
export async function listSolutionTemplates(): Promise<SolutionTemplateCard[]> {
  return handleResponse(await apiFetch(`${API_BASE_URL}/solution-templates`));
}

export async function installSolutionTemplate(id: string, sampleData: boolean): Promise<SolutionInstallResult> {
  const res = await apiFetch(`${API_BASE_URL}/solution-templates/${id}/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sampleData }),
  });
  return handleResponse(res);
}

export interface SheetAnalysis extends WizardAnalysis {
  sheets: string[];
  selectedSheet: string;
  rowCount: number;
  suggestedLabel: string;
  suggestedName: string;
}

/** Import wizard: suggested fields for a spreadsheet (builder+). */
export async function analyzeSheet(file: File, sheetName?: string): Promise<SheetAnalysis> {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetName) formData.append("sheetName", sheetName);
  const res = await apiFetch(`${API_BASE_URL}/import-wizard/analyze`, { method: "POST", body: formData });
  return handleResponse<SheetAnalysis>(res);
}

/** Import wizard: creates the entity and imports every row (all or nothing). */
export async function createFromSheet(
  file: File,
  plan: WizardPlan,
): Promise<{ entity: { id: string; name: string; label: string; physicalTableName: string; version: number; icon?: string | null }; fields: any[]; insertedCount: number }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("plan", JSON.stringify(plan));
  const res = await apiFetch(`${API_BASE_URL}/import-wizard/create`, { method: "POST", body: formData });
  return handleResponse(res);
}

export async function previewEntityImport(
  entityIdOrName: string,
  file: File,
  sheetName?: string
): Promise<ImportPreviewResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetName) {
    formData.append("sheetName", sheetName);
  }

  const res = await apiFetch(`${API_BASE_URL}/entities/${entityIdOrName}/import/preview`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<ImportPreviewResult>(res);
}

export async function dryRunEntityImport(
  entityIdOrName: string,
  file: File,
  mapping: Record<string, string | null>,
  options?: ImportOptions,
  sheetName?: string
): Promise<ImportDryRunResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mapping", JSON.stringify(mapping));
  if (options) {
    formData.append("options", JSON.stringify(options));
  }
  if (sheetName) {
    formData.append("sheetName", sheetName);
  }

  const res = await apiFetch(`${API_BASE_URL}/entities/${entityIdOrName}/import/dry-run`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<ImportDryRunResult>(res);
}

export async function commitEntityImport(
  entityIdOrName: string,
  file: File,
  mapping: Record<string, string | null>,
  options?: ImportOptions,
  sheetName?: string
): Promise<ImportCommitResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mapping", JSON.stringify(mapping));
  if (options) {
    formData.append("options", JSON.stringify(options));
  }
  if (sheetName) {
    formData.append("sheetName", sheetName);
  }

  const res = await apiFetch(`${API_BASE_URL}/entities/${entityIdOrName}/import/commit`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<ImportCommitResult>(res);
}

// ─── Export Templates & Downloads ──────────────────────────────────────────

export interface ExportTemplateItem {
  id: string;
  tenantId?: string;
  name: string;
  entityId: string;
  draft: any;
  published?: any;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function listExportTemplates(entityId?: string): Promise<ExportTemplateItem[]> {
  const url = entityId
    ? `${API_BASE_URL}/export-templates?entityId=${encodeURIComponent(entityId)}`
    : `${API_BASE_URL}/export-templates`;
  const res = await apiFetch(url);
  return handleResponse<ExportTemplateItem[]>(res);
}

export async function getExportTemplate(id: string): Promise<ExportTemplateItem> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}`);
  return handleResponse<ExportTemplateItem>(res);
}

export async function createExportTemplate(data: {
  name: string;
  entityId: string;
  draft?: any;
}): Promise<ExportTemplateItem> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<ExportTemplateItem>(res);
}

export async function updateExportTemplate(
  id: string,
  data: { name?: string; draft?: any },
): Promise<ExportTemplateItem> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<ExportTemplateItem>(res);
}

export async function deleteExportTemplate(id: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean }>(res);
}

export async function publishExportTemplate(id: string): Promise<ExportTemplateItem> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}/publish`, {
    method: "POST",
  });
  return handleResponse<ExportTemplateItem>(res);
}

export async function duplicateExportTemplate(id: string): Promise<ExportTemplateItem> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}/duplicate`, {
    method: "POST",
  });
  return handleResponse<ExportTemplateItem>(res);
}

export async function previewExportTemplate(
  id: string,
  draft?: any,
): Promise<{ columns: Array<{ fieldId: string; header: string; format: string }>; rows: Array<Record<string, any>> }> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  return handleResponse(res);
}

export async function previewExportTemplateDraft(
  entityId: string,
  draft: any,
): Promise<{ columns: Array<{ fieldId: string; header: string; format: string }>; rows: Array<Record<string, any>> }> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId, draft }),
  });
  return handleResponse(res);
}

export async function createExportDownloadToken(params: {
  templateId?: string;
  entityId?: string;
  format: "xlsx" | "csv" | "pdf";
  filters?: any;
  parameters?: any;
}): Promise<{ token: string; expiresIn: number; downloadUrl: string }> {
  const res = await apiFetch(`${API_BASE_URL}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return handleResponse(res);
}

export async function fetchExportTemplatePreviewData(id: string): Promise<{ draft: any }> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}/preview-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse<{ draft: any }>(res);
}

export async function downloadExportTemplateRenderPreview(id: string, withData: boolean = false): Promise<Blob> {
  const url = `${API_BASE_URL}/export-templates/${id}/render-preview${withData ? '?withData=true' : ''}`;
  const res = await apiFetch(url, {
    method: "POST",
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorData.message || "Failed to render preview", errorData.errors);
  }
  return res.blob();
}

export async function fetchDatasetPreview(
  id: string,
  dataset: any,
  parameters?: any
): Promise<{ rows: any[]; totalCount: number; isGrouped: boolean }> {
  const res = await apiFetch(`${API_BASE_URL}/export-templates/${id}/dataset-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, parameters }),
  });
  return handleResponse(res);
}
