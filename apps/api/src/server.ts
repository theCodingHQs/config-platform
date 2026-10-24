import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { schemaRoutes } from './schema/schema-routes.js';
import { recordsRoutes } from './records/records-routes.js';
import { importRoutes } from './records/import/import-routes.js';
import { importWizardRoutes } from './records/import/import-wizard-routes.js';
import { solutionTemplateRoutes } from './workspace/solution-template-routes.js';
import { pagesRoutes } from './pages/pages-routes.js';
import { permissionRoutes } from './permissions/permission-routes.js';
import { authRoutes, memberRoutes } from './auth/auth-routes.js';
import { workspaceRoutes } from './workspace/workspace-routes.js';
import { auditRoutes } from './audit/audit-routes.js';
import { reportScheduleRoutes } from './reports/report-schedule-routes.js';
import { exportRoutes } from './records/export/export-routes.js';
import { LimitExceededError } from './limits/tenant-limits.js';
import { sessionMiddlewarePlugin, decorateSession, registerSessionHook } from './auth/session-middleware.js';
import { initializeMetadataCatalog } from './db/catalog-init.js';
import { OptimisticLockError } from './migrations/migration-service.js';
import { UnsafeConversionError } from './migrations/ddl-generator.js';
import {
  UnknownFieldsError,
  RecordValidationError,
} from './records/record-validator.js';
import { QueryError } from './records/query-builder.js';
import {
  RecordNotFoundError,
  RecordConflictError,
} from './records/records-service.js';
import { AuthError } from './auth/auth-service.js';
import { isCatalogReady } from './db/catalog-init.js';
import { pool } from './db/pool.js';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { validateEmailConfig } from './auth/email-verifier.js';
import { platformSettings } from './platform/platform-settings.js';
import { platformRoutes } from './platform/platform-routes.js';
import { liveRoutes } from './live/live-routes.js';
import { liveSocketRoutes } from './live/live-socket-routes.js';
import { liveRuleRoutes } from './live/rules/live-rule-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getWebDistPath(): string {
  const candidates = [
    process.env.WEB_DIST_PATH,
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(__dirname, '../../web/dist');
}

export async function checkDemoAccountWarning(logger?: any): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return false;
  try {
    const res = await pool.query(
      `SELECT id, email FROM public.app_user WHERE email = 'admin@example.com' LIMIT 1`
    );
    if (res.rows.length > 0) {
      const msg =
        '[SECURITY WARNING] Demo account admin@example.com detected in production database! Run "pnpm check:db-clean" to inspect and remove demo accounts before public launch.';
      if (logger && typeof logger.warn === 'function') {
        logger.warn(msg);
      } else {
        console.warn(msg);
      }
      return true;
    }
  } catch {
    // Ignore if table does not exist yet
  }
  return false;
}

export async function buildServer() {
  await platformSettings.load();
  validateEmailConfig();

  const trustProxyConfig = process.env.TRUST_PROXY === 'true'
    ? true
    : process.env.TRUST_PROXY === 'false'
    ? false
    : process.env.TRUST_PROXY || false;

  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
    trustProxy: trustProxyConfig,
    bodyLimit: 10 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });

  if (process.env.NODE_ENV === 'production') {
    fastify.addHook('onReady', async () => {
      await checkDemoAccountWarning(fastify.log);
    });
  }

  fastify.addHook('onSend', async (request, reply) => {
    if (request.id) {
      reply.header('x-request-id', request.id);
    }
  });

  // ─── CORS ─────────────────────────────────────────────────────
  // CORS is off by default in production (same-origin web assets served directly via @fastify/static).
  // If WEB_URL is explicitly configured, it allows that origin. In non-production, defaults to http://localhost:3000.
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.WEB_URL ? process.env.WEB_URL : (isProd ? false : 'http://localhost:3000');
  await fastify.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  // ─── Cookies ──────────────────────────────────────────────────
  await fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'change-me-in-production-please-use-32-chars',
    parseOptions: {},
  });

  // Decorate req.session on the root instance so all scoped plugins share it
  decorateSession(fastify);

  // ─── Rate Limiting ────────────────────────────────────────────
  await fastify.register(rateLimit, {
    global: false, // only apply where explicitly configured
    redis: undefined, // in-memory store is fine for single node
  });

  // ─── Multipart Support (10MB Cap) ───────────────────────────
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB default cap
      files: 1,
    },
  });

  // Live data to browsers (/api/live/socket); messages are small JSON
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // ─── Body parser ──────────────────────────────────────────────
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ─── Error Handler ────────────────────────────────────────────
  fastify.setErrorHandler((error: any, _request, reply) => {
    if (error instanceof LimitExceededError || error.name === 'LimitExceededError') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: error.message,
      });
    }

    if (error instanceof AuthError || error.name === 'AuthError') {
      return reply.status(error.statusCode || 401).send({
        statusCode: error.statusCode || 401,
        error: error.statusCode === 403 ? 'Forbidden' : 'Unauthorized',
        message: error.message,
      });
    }

    if (
      error instanceof UnknownFieldsError ||
      error instanceof QueryError ||
      error.name === 'UnknownFieldsError' ||
      error.name === 'QueryError'
    ) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.message,
      });
    }

    if (error instanceof RecordValidationError || error.name === 'RecordValidationError') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: error.message,
        errors: (error as RecordValidationError).errors,
      });
    }

    if (error instanceof RecordNotFoundError || error.name === 'RecordNotFoundError') {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: error.message,
      });
    }

    if (
      error instanceof RecordConflictError ||
      error.name === 'RecordConflictError' ||
      (error as any).code === '23503' ||
      (error.message && error.message.includes('foreign key constraint'))
    ) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: error.message.includes('foreign key constraint')
          ? 'Cannot delete record because it is referenced by another record.'
          : error.message,
      });
    }

    if (error instanceof OptimisticLockError) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: error.message,
      });
    }

    if (error instanceof UnsafeConversionError) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }

    if (error.message && error.message.includes('already exists')) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: error.message,
      });
    }

    if (error.message && error.message.includes('not found')) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: error.message,
      });
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name || 'Client Error',
        message: error.message,
        errors: error.errors,
      });
    }

    fastify.log.error(error);
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected internal error occurred',
      });
    }

    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred',
    });
  });

  // ─── Health Checks (public) ──────────────────────────────────
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/health/live', async () => {
    return { status: 'live', uptime: process.uptime() };
  });

  fastify.get('/health/ready', async (_req, reply) => {
    if (!isCatalogReady()) {
      return reply.status(503).send({
        status: 'not_ready',
        message: 'Catalog migrations in progress or database not ready',
      });
    }
    try {
      await pool.query('SELECT 1');
      return reply.status(200).send({ status: 'ready' });
    } catch {
      return reply.status(503).send({
        status: 'not_ready',
        message: 'Database connection failed',
      });
    }
  });

  // ─── API Routes (prefix: /api) ───────────────────────────────
  await fastify.register(async (apiApp) => {
    // Auth routes (public – signup, login, logout, CSRF, etc.)
    await apiApp.register(authRoutes);

    // Protected routes (session required)
    await apiApp.register(async (protectedApp) => {
      registerSessionHook(protectedApp);
      await protectedApp.register(memberRoutes);
      await protectedApp.register(schemaRoutes);
      await protectedApp.register(recordsRoutes);
      await protectedApp.register(importRoutes);
      await protectedApp.register(importWizardRoutes);
      await protectedApp.register(solutionTemplateRoutes);
      await protectedApp.register(exportRoutes);
      await protectedApp.register(pagesRoutes);
      await protectedApp.register(permissionRoutes);
      await protectedApp.register(workspaceRoutes);
      await protectedApp.register(auditRoutes);
      await protectedApp.register(reportScheduleRoutes);
      await protectedApp.register(platformRoutes);
      await protectedApp.register(liveRoutes);
      await protectedApp.register(liveSocketRoutes);
      await protectedApp.register(liveRuleRoutes);
    });
  }, { prefix: '/api' });

  // ─── Static Web App Serving & SPA Fallback ───────────────────
  const distPath = getWebDistPath();
  if (fs.existsSync(distPath)) {
    await fastify.register(fastifyStatic, {
      root: distPath,
      prefix: '/',
      wildcard: true,
      setHeaders: (reply, pathName) => {
        if (pathName.includes('assets')) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (pathName.endsWith('.html') || pathName === '/' || pathName === '') {
          reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      },
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api') &&
        !request.url.startsWith('/health')
      ) {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      });
    });
  } else {
    fastify.setNotFoundHandler((request, reply) => {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      });
    });
  }


  return fastify;
}

