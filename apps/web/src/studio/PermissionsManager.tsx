import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  Users,
  Check,
  X,
  Mail,
  Plus,
  Trash2,
  Lock,
  EyeOff,
  Eye,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type { ErdTable } from "@config-platform/schema";
import {
  fetchSchemaEntities,
  fetchEntityPermissions,
  setEntityPermission,
  fetchFieldPermissions,
  setFieldPermission,
  listMembers,
  inviteMember,
  changeMemberRole,
  removeMember,
  type EntityPermissionRecord,
  type FieldPermissionRecord,
  type MemberInfo,
} from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { useDateDisplayPrefs } from "../context/date-display-context";
import { formatPlainDate, plainDateInTimeZone } from "@config-platform/schema";
import { useMetadata } from "../context/metadata-context";
import { useTabParam } from "../components/use-tab-param";

const ROLES = ["owner", "admin", "builder", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];


/** Field types as they're named in the Data Entities screen. */
const FIELD_TYPE_NAMES: Record<string, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / No",
  date: "Date",
  select: "Choice",
  reference: "Link",
};

/** Record actions a role can be allowed, in the words people use for them. */
const RECORD_ACTIONS = [
  { key: "canRead", label: "View", hint: "See records (in tables, details, charts)" },
  { key: "canCreate", label: "Add", hint: "Create new records" },
  { key: "canUpdate", label: "Edit", hint: "Change existing records" },
  { key: "canDelete", label: "Delete", hint: "Remove records" },
  { key: "canExport", label: "Export", hint: "Download records (CSV, Excel, reports)" },
] as const;

export function PermissionsManager() {
  const { tenantId } = useMetadata();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useTabParam(["entities", "members"] as const, "entities");
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [generatedInviteToken, setGeneratedInviteToken] = useState<
    string | null
  >(null);
  // Action results go to the status bar instead of banners above the tabs
  const notify = useStatusNotify();
  const datePrefs = useDateDisplayPrefs();

  // Entities query
  const { data: entities = [], isLoading: entitiesLoading } = useQuery<
    ErdTable[]
  >({
    queryKey: ["schema-entities", tenantId],
    queryFn: () => fetchSchemaEntities(tenantId),
  });

  // Select first entity when available
  useEffect(() => {
    if (!selectedEntityId && entities.length > 0) {
      setSelectedEntityId(entities[0].id);
    }
  }, [entities, selectedEntityId]);

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  // Entity permissions query
  const {
    data: entityPerms = [],
    isLoading: entityPermsLoading,
    refetch: refetchEntityPerms,
  } = useQuery<EntityPermissionRecord[]>({
    queryKey: ["entity-permissions", selectedEntityId],
    queryFn: () => fetchEntityPermissions(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  // Field permissions query
  const {
    data: fieldPerms = [],
    isLoading: fieldPermsLoading,
    refetch: refetchFieldPerms,
  } = useQuery<FieldPermissionRecord[]>({
    queryKey: ["field-permissions", selectedEntityId],
    queryFn: () => fetchFieldPermissions(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  // Members query
  const {
    data: members = [],
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useQuery<MemberInfo[]>({
    queryKey: ["tenant-members"],
    queryFn: () => listMembers(),
  });

  // Entity perm toggle mutation
  const entityPermMutation = useMutation({
    mutationFn: async (vars: {
      role: Role;
      canRead?: boolean;
      canCreate?: boolean;
      canUpdate?: boolean;
      canDelete?: boolean;
      canExport?: boolean;
    }) => {
      await setEntityPermission(selectedEntityId, vars.role, {
        canRead: vars.canRead,
        canCreate: vars.canCreate,
        canUpdate: vars.canUpdate,
        canDelete: vars.canDelete,
        canExport: vars.canExport,
      });
    },
    onMutate: (vars) => {
      const queryKey = ["entity-permissions", selectedEntityId];
      const previous = queryClient.getQueryData<EntityPermissionRecord[]>(queryKey);
      queryClient.setQueryData<EntityPermissionRecord[]>(queryKey, (old = []) => {
        const existing = old.find((p) => p.role === vars.role);
        if (existing) {
          return old.map((p) =>
            p.role === vars.role
              ? {
                  ...p,
                  canRead: vars.canRead ?? p.canRead,
                  canCreate: vars.canCreate ?? p.canCreate,
                  canUpdate: vars.canUpdate ?? p.canUpdate,
                  canDelete: vars.canDelete ?? p.canDelete,
                  canExport: vars.canExport ?? (p.canExport ?? (p.role !== 'viewer')),
                }
              : p,
          );
        }
        return [
          ...old,
          {
            role: vars.role,
            canRead: vars.canRead ?? false,
            canCreate: vars.canCreate ?? false,
            canUpdate: vars.canUpdate ?? false,
            canDelete: vars.canDelete ?? false,
            canExport: vars.canExport ?? (vars.role !== 'viewer'),
          },
        ];
      });
      return { previous };
    },
    onSuccess: () => {
      refetchEntityPerms();
      notify("success", "Entity permission updated");
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["entity-permissions", selectedEntityId], ctx.previous);
      }
      notify("error", err.message || "Failed to update entity permission");
    },
  });

  // Field perm toggle mutation
  const fieldPermMutation = useMutation({
    mutationFn: async (vars: {
      fieldId: string;
      role: Role;
      hidden?: boolean;
      readOnly?: boolean;
    }) => {
      await setFieldPermission(selectedEntityId, vars.fieldId, vars.role, {
        hidden: vars.hidden,
        readOnly: vars.readOnly,
      });
    },
    onMutate: (vars) => {
      const queryKey = ["field-permissions", selectedEntityId];
      const previous = queryClient.getQueryData<FieldPermissionRecord[]>(queryKey);
      queryClient.setQueryData<FieldPermissionRecord[]>(queryKey, (old = []) => {
        const existing = old.find(
          (p) => p.fieldId === vars.fieldId && p.role === vars.role,
        );
        if (existing) {
          return old.map((p) =>
            p.fieldId === vars.fieldId && p.role === vars.role
              ? { ...p, hidden: vars.hidden ?? p.hidden, readOnly: vars.readOnly ?? p.readOnly }
              : p,
          );
        }
        return [
          ...old,
          {
            fieldId: vars.fieldId,
            role: vars.role,
            hidden: vars.hidden ?? false,
            readOnly: vars.readOnly ?? false,
          },
        ];
      });
      return { previous };
    },
    onSuccess: () => {
      refetchFieldPerms();
      notify("success", "Field permission updated");
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["field-permissions", selectedEntityId], ctx.previous);
      }
      notify("error", err.message || "Failed to update field permission");
    },
  });

  // Invite member mutation
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await inviteMember(inviteEmail, inviteRole);
      return res.token;
    },
    onSuccess: (token) => {
      setGeneratedInviteToken(token);
      setInviteEmail("");
      refetchMembers();
      notify("success", "Invite generated successfully");
    },
    onError: (err: any) => {
      notify("error", err.message || "Failed to send invite");
    },
  });

  // Change role mutation
  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      await changeMemberRole(userId, role);
    },
    onSuccess: () => {
      refetchMembers();
      notify("success", "Member role updated");
    },
    onError: (err: any) => {
      notify("error", err.message || "Failed to update member role");
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await removeMember(userId);
    },
    onSuccess: () => {
      refetchMembers();
      notify("success", "Member removed");
    },
    onError: (err: any) => {
      notify("error", err.message || "Failed to remove member");
    },
  });

  // Helper to get effective entity perm for role
  const getEntityPerm = (role: Role) => {
    const found = entityPerms.find((p) => p.role === role);
    if (found) {
      return {
        ...found,
        canExport: found.canExport ?? (role !== "viewer"),
      };
    }
    // Defaults based on role hierarchy
    if (
      role === "owner" ||
      role === "admin" ||
      role === "builder" ||
      role === "editor"
    ) {
      return {
        role,
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canExport: true,
      };
    }
    return {
      role,
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canExport: false,
    };
  };

  // Helper to get field perm for field + role
  const getFieldPerm = (fieldId: string, role: Role) => {
    const found = fieldPerms.find(
      (p) => p.fieldId === fieldId && p.role === role,
    );
    return found || { fieldId, role, hidden: false, readOnly: false };
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
            }}
          >
            <Shield size={24} style={{ color: "var(--accent)" }} />
            Access & Permissions
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--font-size-sm)",
              marginTop: "0.25rem",
            }}
          >
            Decide who can see and change each kind of data, and manage the people
            in this workspace.
          </p>
        </div>

        {/* Tab switchers */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            backgroundColor: "var(--surface-subtle)",
            padding: "0.25rem",
            borderRadius: "var(--radius-control)",
          }}
        >
          <button
            type="button"
            className={`btn ${activeTab === "entities" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("entities")}
            style={{
              fontSize: "var(--font-size-sm)",
              padding: "0.375rem 0.875rem",
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            <Shield size={15} /> Data Access
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "members" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("members")}
            style={{
              fontSize: "var(--font-size-sm)",
              padding: "0.375rem 0.875rem",
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            <Users size={15} /> Team Members
          </button>
        </div>
      </div>

      {/* TAB 1: Entity & Field Permissions */}
      {activeTab === "entities" && (
        <div>
          {/* Entity Selector */}
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-surface)",
              padding: "1.25rem",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <label style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>
              Data entity:
            </label>
            <select
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              className="input"
              style={{ width: "280px" }}
              disabled={entitiesLoading || entities.length === 0}
            >
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label} ({ent.name})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                refetchEntityPerms();
                refetchFieldPerms();
              }}
              title="Refresh permissions"
              style={{ padding: "0.5rem" }}
            >
              <RefreshCw size={15} />
            </button>
          </div>

          {selectedEntity && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              {/* Entity Permission Matrix */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                }}
              >
                <h2
                  style={{
                    fontSize: "var(--font-size-lg)",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                  }}
                >
                  Record access: {selectedEntity.label}
                </h2>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--font-size-sm)",
                    marginBottom: "1.25rem",
                  }}
                >
                  What each role can do with {selectedEntity.label} records. This applies
                  everywhere: pages, exports and imports. Owners and admins always have
                  full access.
                </p>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          fontSize: "var(--font-size-sm)",
                        }}
                      >
                        <th style={{ padding: "0.75rem 1rem" }}>Role</th>
                        {RECORD_ACTIONS.map((action) => (
                          <th key={action.key} style={{ padding: "0.75rem 1rem" }} title={action.hint}>
                            {action.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ROLES.map((role) => {
                        const stored = getEntityPerm(role);
                        // Export defaults like the server: on for every role except viewers
                        const perm = { ...stored, canExport: stored.canExport ?? role !== "viewer" };
                        const isImmutableRole =
                          role === "owner" || role === "admin";
                        return (
                          <tr
                            key={role}
                            style={{
                              borderBottom: "1px solid var(--border)",
                              fontSize: "var(--font-size-sm)",
                            }}
                          >
                            <td
                              style={{
                                padding: "0.875rem 1rem",
                                fontWeight: 600,
                                textTransform: "capitalize",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                }}
                              >
                                {role === "owner" ? (
                                  <Shield
                                    size={14}
                                    style={{ color: "var(--accent)" }}
                                  />
                                ) : null}
                                {role}
                              </span>
                            </td>
                            {RECORD_ACTIONS.map((action) => (
                              <td key={action.key} style={{ padding: "0.875rem 1rem" }}>
                                <input
                                  type="checkbox"
                                  aria-label={`${role}: ${action.label}`}
                                  checked={perm[action.key]}
                                  disabled={isImmutableRole}
                                  onChange={(e) =>
                                    // Always send every action: one left out falls back to the
                                    // role default on the server (it used to re-enable Export)
                                    entityPermMutation.mutate({
                                      role,
                                      canRead: perm.canRead,
                                      canCreate: perm.canCreate,
                                      canUpdate: perm.canUpdate,
                                      canDelete: perm.canDelete,
                                      canExport: perm.canExport,
                                      [action.key]: e.target.checked,
                                    })
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Field-Level Permissions */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                }}
              >
                <h2
                  style={{
                    fontSize: "var(--font-size-lg)",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                  }}
                >
                  Field access: {selectedEntity.label}
                </h2>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--font-size-sm)",
                    marginBottom: "1.25rem",
                  }}
                >
                  Hide confidential fields from a role, or let it see a field without
                  changing it. Hidden fields never leave the server for that role, and
                  it can't filter or sort by them.
                </p>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          fontSize: "var(--font-size-sm)",
                        }}
                      >
                        <th style={{ padding: "0.75rem 1rem" }}>Field</th>
                        <th style={{ padding: "0.75rem 1rem" }}>Type</th>
                        <th style={{ padding: "0.75rem 1rem" }}>
                          Viewer: hide
                        </th>
                        <th style={{ padding: "0.75rem 1rem" }}>
                          Viewer: view only
                        </th>
                        <th style={{ padding: "0.75rem 1rem" }}>
                          Editor: hide
                        </th>
                        <th style={{ padding: "0.75rem 1rem" }}>
                          Editor: view only
                        </th>
                        <th style={{ padding: "0.75rem 1rem" }}>
                          Builder: hide
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEntity.columns
                        .filter((col: any) => !['id', 'created_at', 'updated_at'].includes(col.id))
                        .map((col: any) => {

                        const viewerPerm = getFieldPerm(col.id, "viewer");
                        const editorPerm = getFieldPerm(col.id, "editor");
                        const builderPerm = getFieldPerm(col.id, "builder");

                        return (
                          <tr
                            key={col.id}
                            style={{
                              borderBottom: "1px solid var(--border)",
                              fontSize: "var(--font-size-sm)",
                            }}
                          >
                            <td
                              style={{
                                padding: "0.75rem 1rem",
                                fontWeight: 600,
                              }}
                            >
                              {col.label}{" "}
                              <span
                                style={{
                                  color: "var(--text-muted)",
                                  fontWeight: 400,
                                }}
                              >
                                ({col.name})
                              </span>
                            </td>
                            <td
                              style={{
                                padding: "0.75rem 1rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              {FIELD_TYPE_NAMES[col.type] ?? col.type}
                            </td>
                            {/* Viewer Hidden */}
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={viewerPerm.hidden}
                                  onChange={(e) => {
                                    fieldPermMutation.mutate({
                                      fieldId: col.id,
                                      role: "viewer",
                                      hidden: e.target.checked,
                                      readOnly: viewerPerm.readOnly,
                                    });
                                  }}
                                />
                                {viewerPerm.hidden ? (
                                  <EyeOff
                                    size={14}
                                    style={{ color: "var(--danger)" }}
                                  />
                                ) : (
                                  <Eye
                                    size={14}
                                    style={{ color: "var(--text-muted)" }}
                                  />
                                )}
                              </label>
                            </td>
                            {/* Viewer Read-Only */}
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={viewerPerm.readOnly}
                                  onChange={(e) => {
                                    fieldPermMutation.mutate({
                                      fieldId: col.id,
                                      role: "viewer",
                                      hidden: viewerPerm.hidden,
                                      readOnly: e.target.checked,
                                    });
                                  }}
                                />
                                <Lock
                                  size={14}
                                  style={{
                                    color: viewerPerm.readOnly
                                      ? "var(--accent)"
                                      : "var(--text-muted)",
                                  }}
                                />
                              </label>
                            </td>
                            {/* Editor Hidden */}
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={editorPerm.hidden}
                                  onChange={(e) => {
                                    fieldPermMutation.mutate({
                                      fieldId: col.id,
                                      role: "editor",
                                      hidden: e.target.checked,
                                      readOnly: editorPerm.readOnly,
                                    });
                                  }}
                                />
                                {editorPerm.hidden ? (
                                  <EyeOff
                                    size={14}
                                    style={{ color: "var(--danger)" }}
                                  />
                                ) : (
                                  <Eye
                                    size={14}
                                    style={{ color: "var(--muted)" }}
                                  />
                                )}
                              </label>
                            </td>
                            {/* Editor Read-Only */}
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={editorPerm.readOnly}
                                  onChange={(e) => {
                                    fieldPermMutation.mutate({
                                      fieldId: col.id,
                                      role: "editor",
                                      hidden: editorPerm.hidden,
                                      readOnly: e.target.checked,
                                    });
                                  }}
                                />
                                <Lock
                                  size={14}
                                  style={{
                                    color: editorPerm.readOnly
                                      ? "var(--accent)"
                                      : "var(--muted)",
                                  }}
                                />
                              </label>
                            </td>
                            {/* Builder Hidden */}
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.375rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={builderPerm.hidden}
                                  onChange={(e) => {
                                    fieldPermMutation.mutate({
                                      fieldId: col.id,
                                      role: "builder",
                                      hidden: e.target.checked,
                                      readOnly: builderPerm.readOnly,
                                    });
                                  }}
                                />
                                {builderPerm.hidden ? (
                                  <EyeOff
                                    size={14}
                                    style={{ color: "var(--danger)" }}
                                  />
                                ) : (
                                  <Eye
                                    size={14}
                                    style={{ color: "var(--muted)" }}
                                  />
                                )}
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Team Members & Invites */}
      {activeTab === "members" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
        >
          {/* Invite New Member Card */}
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-surface)",
              padding: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "var(--font-size-lg)",
                fontWeight: 600,
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <Mail size={18} style={{ color: "var(--accent)" }} /> Invite New
              Team Member
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
                marginBottom: "1.25rem",
              }}
            >
              Generate an invitation link or token for a new user to join this
              tenant with a designated role.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail.trim()) inviteMutation.mutate();
              }}
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="input"
                style={{ minWidth: "280px", flex: 1 }}
                required
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="input"
                style={{ width: "140px" }}
              >
                <option value="admin">Admin</option>
                <option value="builder">Builder</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                }}
              >
                <Plus size={16} /> Send Invite
              </button>
            </form>

            {generatedInviteToken && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  backgroundColor: "var(--surface-subtle)",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    display: "block",
                    marginBottom: "0.375rem",
                  }}
                >
                  Generated Invite Token (share with invitee):
                </span>
                <code
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontFamily: "monospace",
                    color: "var(--accent)",
                    wordBreak: "break-all",
                  }}
                >
                  {generatedInviteToken}
                </code>
              </div>
            )}
          </div>

          {/* Members Table */}
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-surface)",
              padding: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "var(--font-size-lg)",
                fontWeight: 600,
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <Users size={18} style={{ color: "var(--accent)" }} /> Current
              Members ({members.length})
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
                marginBottom: "1.25rem",
              }}
            >
              Members who have access to this tenant and their current
              permission roles.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      fontSize: "var(--font-size-sm)",
                    }}
                  >
                    <th style={{ padding: "0.75rem 1rem" }}>User Email</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Role</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Member since</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        fontSize: "var(--font-size-sm)",
                      }}
                    >
                      <td style={{ padding: "0.875rem 1rem", fontWeight: 500 }}>
                        {member.email}
                      </td>
                      <td style={{ padding: "0.875rem 1rem" }}>
                        {member.role === "owner" ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.25rem",
                              fontWeight: 600,
                              color: "var(--accent)",
                            }}
                          >
                            <Shield size={14} /> Owner
                          </span>
                        ) : (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              changeRoleMutation.mutate({
                                userId: member.id,
                                role: e.target.value as Role,
                              })
                            }
                            className="input"
                            style={{
                              padding: "0.25rem 0.5rem",
                              fontSize: "var(--font-size-sm)",
                              width: "120px",
                            }}
                          >
                            <option value="admin">Admin</option>
                            <option value="builder">Builder</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.875rem 1rem",
                          color: "var(--text-muted)",
                          fontSize: "var(--font-size-sm)",
                        }}
                      >
                        {formatPlainDate(plainDateInTimeZone(member.memberSince, datePrefs.timeZone), datePrefs)}
                      </td>
                      <td
                        style={{ padding: "0.875rem 1rem", textAlign: "right" }}
                      >
                        {member.role !== "owner" && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Are you sure you want to remove ${member.email}?`,
                                )
                              ) {
                                removeMemberMutation.mutate(member.id);
                              }
                            }}
                            style={{
                              color: "var(--danger)",
                              padding: "0.375rem 0.5rem",
                            }}
                            title="Remove member"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && !membersLoading && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "2rem",
                          textAlign: "center",
                          color: "var(--text-muted)",
                        }}
                      >
                        No members found or permission denied.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
