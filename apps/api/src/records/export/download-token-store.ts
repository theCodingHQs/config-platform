import crypto from 'node:crypto';
import type { TenantRole } from '../../auth/auth-types.js';

export interface DownloadTokenPayload {
  token: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: TenantRole;
  params: {
    templateId?: string;
    entityId: string;
    format: 'xlsx' | 'csv' | 'pdf';
    filters?: any;
    parameters?: any;
  };
  expiresAt: number;
}

export class DownloadTokenStore {
  private tokens = new Map<string, DownloadTokenPayload>();

  createToken(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    userRole: TenantRole;
    templateId?: string;
    entityId: string;
    format: 'xlsx' | 'csv' | 'pdf';
    filters?: any;
    parameters?: any;
    ttlSeconds?: number;
  }): { token: string; expiresIn: number } {
    this.pruneExpired();
    const token = crypto.randomBytes(32).toString('hex');
    const ttlSeconds = params.ttlSeconds ?? 60;
    const expiresAt = Date.now() + ttlSeconds * 1000;

    const payload: DownloadTokenPayload = {
      token,
      tenantId: params.tenantId,
      userId: params.userId,
      userEmail: params.userEmail,
      userRole: params.userRole,
      params: {
        templateId: params.templateId,
        entityId: params.entityId,
        format: params.format,
        filters: params.filters,
        parameters: params.parameters,
      },
      expiresAt,
    };

    this.tokens.set(token, payload);
    return { token, expiresIn: ttlSeconds };
  }

  /**
   * Consumes a token. Returns the payload and deletes the token immediately (single-use).
   * Returns null if token does not exist or has expired.
   */
  consumeToken(token: string): DownloadTokenPayload | null {
    const payload = this.tokens.get(token);
    if (!payload) {
      return null;
    }

    // Always delete token on access (single use)
    this.tokens.delete(token);

    if (Date.now() > payload.expiresAt) {
      return null;
    }

    return payload;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.tokens.entries()) {
      if (now > value.expiresAt) {
        this.tokens.delete(key);
      }
    }
  }
}

export const downloadTokenStore = new DownloadTokenStore();
