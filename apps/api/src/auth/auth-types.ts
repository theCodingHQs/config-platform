/**
 * Auth types for the config-platform.
 *
 * Role hierarchy: owner > admin > builder > editor > viewer
 */

export const ROLES = ['owner', 'admin', 'builder', 'editor', 'viewer'] as const;
export type TenantRole = (typeof ROLES)[number];

export function isValidRole(role: string): role is TenantRole {
  return (ROLES as readonly string[]).includes(role);
}

/** Ordered rank — higher index = more permissions */
const ROLE_RANK: Record<TenantRole, number> = {
  viewer: 0,
  editor: 1,
  builder: 2,
  admin: 3,
  owner: 4,
};

export function hasMinRole(userRole: TenantRole, required: TenantRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

export interface AppUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface TenantMember {
  userId: string;
  tenantId: string;
  role: TenantRole;
}

export interface SessionPayload {
  sessionId: string;
  userId: string;
  tenantId: string;
  tenantName?: string;
  role: TenantRole;
  email: string;
  expiresAt: Date;
}

export interface AuthenticatedRequest {
  session: SessionPayload;
}
