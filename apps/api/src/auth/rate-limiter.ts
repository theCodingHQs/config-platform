/**
 * Rate Limiter interface and in-memory implementation.
 * Designed to be easily replaced by a Redis-backed implementation in production.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private hits: Map<string, number[]> = new Map();

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (this.hits.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const resetMs = oldest + windowMs - now;
      this.hits.set(key, timestamps);
      return { allowed: false, remaining: 0, resetMs: Math.max(0, resetMs) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, remaining: limit - timestamps.length, resetMs: windowMs };
  }

  // Clear for tests
  reset(): void {
    this.hits.clear();
  }
}

export const defaultRateLimiter: RateLimiter = new MemoryRateLimiter();

/**
 * Extracts client IP from request.
 */
export function getClientIp(req: FastifyRequest): string {
  return req.ip || req.socket.remoteAddress || 'unknown-ip';
}

/**
 * Extracts and normalizes email from request body or query.
 */
export function getRequestEmail(req: FastifyRequest, explicitEmail?: string): string | null {
  const email = (explicitEmail || (req.body as any)?.email || (req.query as any)?.email || '').trim().toLowerCase();
  return email || null;
}

/**
 * Builds composite key for backward compatibility if needed.
 */
export function buildRateLimitKey(req: FastifyRequest, email?: string): string {
  const ip = getClientIp(req);
  return email ? `${ip}:${email.trim().toLowerCase()}` : `ip:${ip}`;
}

export interface RateLimitOptions {
  ipLimit?: number;
  emailLimit?: number;
  windowMs?: number;
}

/**
 * Creates a Fastify preHandler hook for separate rate limiting:
 * Separately limits by IP key ('ip:<ip>') and by Email key ('email:<email>').
 */
export function createRateLimitHook(
  ipLimit: number = 30,
  windowMs: number = 15 * 60 * 1000,
  limiter: RateLimiter = defaultRateLimiter,
  emailLimit: number = 10
) {
  return async function rateLimitHook(req: FastifyRequest, reply: FastifyReply) {
    const ip = getClientIp(req);
    const email = getRequestEmail(req);

    // 1. Check IP rate limit separately
    const ipKey = `ip:${ip}`;
    const ipRes = await limiter.consume(ipKey, ipLimit, windowMs);
    reply.header('X-RateLimit-IP-Remaining', ipRes.remaining);

    if (!ipRes.allowed) {
      reply.header('Retry-After', Math.ceil(ipRes.resetMs / 1000));
      return reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for IP. Please try again later.',
      });
    }

    // 2. Check Email rate limit separately if email is provided
    if (email) {
      const emailKey = `email:${email}`;
      const emailRes = await limiter.consume(emailKey, emailLimit, windowMs);
      reply.header('X-RateLimit-Email-Remaining', emailRes.remaining);

      if (!emailRes.allowed) {
        reply.header('Retry-After', Math.ceil(emailRes.resetMs / 1000));
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded for this email address. Please try again later.',
        });
      }
    }
  };
}
