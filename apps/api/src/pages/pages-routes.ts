import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pagesService } from './pages-service.js';
import { permissionService } from '../permissions/permission-service.js';
import { csrfCheckHook } from '../auth/session-middleware.js';
import { hasMinRole } from '../auth/auth-types.js';
import { tenantLimitsService } from '../limits/tenant-limits.js';
import { auditLogService } from '../audit/audit-service.js';

export async function pagesRoutes(fastify: FastifyInstance) {
  fastify.get('/pages/navigation', async (req: FastifyRequest) => {
    const { tenantId, role } = req.session;
    const navigation = await pagesService.getNavigation(tenantId);
    if (hasMinRole(role, 'builder')) return navigation;
    const pages = navigation.pages.filter((page) =>
      page.hasPublished && permissionService.canAccessPage(role, (page as any).allowedRoles, true)
    );
    const visibleFolderIds = new Set<string>();
    const foldersById = new Map(navigation.folders.map((folder) => [folder.id, folder]));
    for (const page of pages) {
      let folder = page.folderId ? foldersById.get(page.folderId) : undefined;
      while (folder) {
        visibleFolderIds.add(folder.id);
        folder = folder.parentId ? foldersById.get(folder.parentId) : undefined;
      }
    }
    return { pages, folders: navigation.folders.filter((folder) => visibleFolderIds.has(folder.id)) };
  });

  fastify.post('/pages/navigation/folders', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const body = (req.body as any) || {};
    if (typeof body.name !== 'string') return reply.status(400).send({ error: 'Folder name is required' });
    return reply.status(201).send(await pagesService.createFolder(req.session.tenantId, body));
  });

  fastify.put('/pages/navigation/folders/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { id } = req.params as { id: string };
    return pagesService.updateFolder(req.session.tenantId, id, (req.body as any) || {});
  });

  fastify.delete('/pages/navigation/folders/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { id } = req.params as { id: string };
    await pagesService.deleteFolder(req.session.tenantId, id);
    return { success: true, id };
  });

  fastify.put('/pages/:id/navigation', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    if (body.folderId !== null && typeof body.folderId !== 'string') {
      return reply.status(400).send({ error: 'folderId must be a folder ID or null' });
    }
    await pagesService.movePage(req.session.tenantId, id, body.folderId);
    return { success: true, id };
  });

  // GET /pages - List all pages for tenant (builder+ get all; others see published they can access)
  fastify.get('/pages', async (req: FastifyRequest) => {
    const { tenantId, role } = req.session;
    const pages = await pagesService.listPages(tenantId);
    if (hasMinRole(role, 'builder')) return pages;
    // Non-builders only see pages they have published access to
    return pages.filter((p) => {
      if (!p.hasPublished) return false;
      return permissionService.canAccessPage(role, (p as any).allowedRoles, true);
    });
  });

  // GET /pages/published - Returns published pages visible to this role
  fastify.get('/pages/published', async (req: FastifyRequest) => {
    const { tenantId, role } = req.session;
    const published = await pagesService.listPublishedPages(tenantId);
    return published.filter((p) =>
      permissionService.canAccessPage(role, (p as any).allowedRoles, true)
    );
  });

  // GET /pages/:id - Get page by ID (builder+ see draft; others only published)
  fastify.get('/pages/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = req.session;
    const { id } = req.params as { id: string };
    const page = await pagesService.getPage(tenantId, id);

    if (!hasMinRole(role, 'builder')) {
      if (!page.hasPublished) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Page not found' });
      }
      const pageAllowedRoles = (page.published as any)?.allowedRoles ?? (page as any).allowedRoles;
      if (!permissionService.canAccessPage(role, pageAllowedRoles, true)) {
        return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access denied' });
      }
      // Return only published fields
      return { ...page, draft: undefined };
    }

    return page;
  });

  // POST /pages - Create page (builder+)
  fastify.post('/pages', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { tenantId } = req.session;
    const body = (req.body as any) || {};
    if (!body.name || !body.route) {
      return reply.status(400).send({ error: 'Page name and route are required' });
    }

    await tenantLimitsService.checkPageLimit(tenantId);

    const page = await pagesService.createPage(tenantId, body);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'page.create',
      entityType: 'page',
      entityId: page.id,
      afterState: { name: page.name, route: page.route },
    });

    return reply.status(201).send(page);
  });

  // PUT /pages/:id - Update page draft / metadata (builder+)
  fastify.put('/pages/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const updated = await pagesService.updatePage(tenantId, id, body);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'page.update',
      entityType: 'page',
      entityId: id,
      afterState: { name: updated.name, route: updated.route },
    });

    return updated;
  });

  // POST /pages/:id/publish - Publish page (builder+)
  fastify.post('/pages/:id/publish', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const published = await pagesService.publishPage(tenantId, id);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'page.publish',
      entityType: 'page',
      entityId: id,
    });

    return published;
  });

  // DELETE /pages/:id - Delete page (builder+)
  fastify.delete('/pages/:id', {
    preHandler: csrfCheckHook,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasMinRole(req.session.role, 'builder')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Builder role or higher required' });
    }
    const { tenantId } = req.session;
    const { id } = req.params as { id: string };
    const result = await pagesService.deletePage(tenantId, id);

    await auditLogService.log({
      tenantId,
      userId: req.session.userId,
      userEmail: req.session.email,
      action: 'page.delete',
      entityType: 'page',
      entityId: id,
    });

    return result;
  });
}
