import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { pagesService } from '../src/pages/pages-service.js';
import { migrationService } from '../src/migrations/migration-service.js';
import { initializeMetadataCatalog } from '../src/db/catalog-init.js';
import { defaultStorageAdapter } from '../src/db/storage-adapter.js';
import { pool } from '../src/db/pool.js';
import crypto from 'node:crypto';
import type { PageDefinition } from '@config-platform/schema';
import type { FastifyInstance } from 'fastify';
import { createTestSession, cleanupTestUser } from './test-session-helper.js';
import type { TestSession } from './test-session-helper.js';

describe('Pages Service & Publishing', () => {
  let server: FastifyInstance;
  const tenantId = `page_test_${crypto.randomBytes(3).toString('hex')}`;
  const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);

  let deviceEntityId: string;
  let nameFieldId: string;
  let auth: TestSession;

  beforeAll(async () => {
    await initializeMetadataCatalog(pool);
    server = await buildServer();
    await server.ready();

    await migrationService.provisionTenant(tenantId, 'Page Test Tenant');

    const entityRes = await migrationService.createEntity(tenantId, {
      name: 'device',
      label: 'Device',
      fields: [{ name: 'serial_no', label: 'Serial No', type: 'text', required: true }],
    });
    deviceEntityId = entityRes.entity.id;
    nameFieldId = entityRes.fields[0].id;

    auth = await createTestSession(tenantId, 'owner', 'page_owner');
  });

  afterAll(async () => {
    await server.close();
    await cleanupTestUser(auth.userId);
    await pool.query(`DELETE FROM public.tenant WHERE id = $1`, [tenantId]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  });

  let createdPageId: string;

  it('creates a page with draft JSON and validates binding integrity', async () => {
    const page = await pagesService.createPage(tenantId, {
      name: 'Device Monitor',
      route: '/device-monitor',
      draft: {
        schemaVersion: 1,
        id: 'p_dev_mon',
        version: 1,
        route: '/device-monitor',
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical', gap: 16 },
          children: [
            {
              id: 'device_table',
              type: 'table',
              props: {
                entityId: deviceEntityId,
                columns: [{ fieldId: nameFieldId }],
                pageSize: 10,
              },
            },
          ],
        },
      },
    });

    expect(page.id).toBeDefined();
    expect(page.name).toBe('Device Monitor');
    expect(page.hasDraft).toBe(true);
    expect(page.hasPublished).toBe(false);
    expect(page.brokenBindings.length).toBe(0);

    createdPageId = page.id;
  });

  it('flags broken bindings when an invalid entityId or fieldId is referenced', async () => {
    const brokenDraft: PageDefinition = {
      schemaVersion: 1,
      id: createdPageId,
      version: 1,
      route: '/device-monitor',
      root: {
        id: 'root_stack',
        type: 'stack',
        props: { direction: 'vertical' },
        children: [
          {
            id: 'broken_table',
            type: 'table',
            props: {
              entityId: 't_non_existent',
              columns: [{ fieldId: 'c_non_existent' }],
            },
          },
        ],
      },
    };

    const updated = await pagesService.updatePage(tenantId, createdPageId, {
      draft: brokenDraft,
    });

    expect(updated.brokenBindings.length).toBeGreaterThan(0);
    expect(updated.brokenBindings[0]).toContain('missing entity');
  });

  it('flags broken binding when a data source filter references a deleted or missing field', async () => {
    const entityRow = await pool.query<{ version: number }>(
      'SELECT version FROM public.entity_def WHERE id = $1',
      [deviceEntityId]
    );
    const addFieldRes = await migrationService.addField(tenantId, {
      entityId: deviceEntityId,
      expectedVersion: entityRow.rows[0].version,
      name: 'temp_status',
      label: 'Temp Status',
      type: 'text',
      required: false,
    });
    const tempFieldId = addFieldRes.field.id;

    const dsDraft: PageDefinition = {
      schemaVersion: 2,
      id: createdPageId,
      version: 1,
      route: '/device-monitor',
      state: {},
      dataSources: [
        {
          id: 'ds_devices',
          entityId: deviceEntityId,
          filter: { [tempFieldId]: 'active' },
        },
      ],
      root: {
        id: 'root_stack',
        type: 'stack',
        props: { direction: 'vertical' },
        children: [
          {
            id: 'tbl',
            type: 'table',
            props: {
              source: 'ds_devices',
              columns: [{ fieldId: nameFieldId }],
            },
          },
        ],
      },
    };

    const updatedBeforeDelete = await pagesService.updatePage(tenantId, createdPageId, {
      draft: dsDraft,
    });
    expect(updatedBeforeDelete.brokenBindings.length).toBe(0);

    await migrationService.dropField(tenantId, {
      entityId: deviceEntityId,
      fieldId: tempFieldId,
      expectedVersion: entityRow.rows[0].version + 1,
    });

    const checkedAfterDelete = await pagesService.getPage(tenantId, createdPageId);
    expect(checkedAfterDelete.brokenBindings.length).toBeGreaterThan(0);
    expect(
      checkedAfterDelete.brokenBindings.some(
        (b) => b.includes('Data source [ds_devices] filter references missing field') && b.includes(tempFieldId)
      )
    ).toBe(true);
  });

  it('publishes a draft and ensures draft edits do not affect published page until publish', async () => {
    const v1Draft: PageDefinition = {
      schemaVersion: 1,
      id: createdPageId,
      version: 1,
      route: '/device-monitor',
      root: {
        id: 'root',
        type: 'stack',
        props: { direction: 'vertical' },
        children: [
          {
            id: 'title',
            type: 'text',
            props: { value: 'Version 1 Title', variant: 'h1' },
          },
        ],
      },
    };

    await pagesService.updatePage(tenantId, createdPageId, { draft: v1Draft });

    const publishedPage = await pagesService.publishPage(tenantId, createdPageId);
    expect(publishedPage.hasPublished).toBe(true);
    expect(publishedPage.published?.root.children?.[0].props.value).toBe('Version 1 Title');

    const v2Draft: PageDefinition = {
      ...v1Draft,
      root: {
        ...v1Draft.root,
        children: [
          {
            id: 'title',
            type: 'text',
            props: { value: 'Version 2 Draft Title', variant: 'h1' },
          },
        ],
      },
    };

    await pagesService.updatePage(tenantId, createdPageId, { draft: v2Draft });

    const pageAfterDraftEdit = await pagesService.getPage(tenantId, createdPageId);
    expect(pageAfterDraftEdit.draft.root.children?.[0].props.value).toBe('Version 2 Draft Title');
    expect(pageAfterDraftEdit.published?.root.children?.[0].props.value).toBe('Version 1 Title');

    const pageAfterPublish = await pagesService.publishPage(tenantId, createdPageId);
    expect(pageAfterPublish.published?.root.children?.[0].props.value).toBe('Version 2 Draft Title');
  });

  it('publishes via HTTP POST /pages/:id/publish even when Content-Type application/json is sent with empty body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pages/${createdPageId}/publish`,
      headers: auth.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.hasPublished).toBe(true);
  });

  it('answers a stale save with 409 and an invalid draft with 422 (with the reason), not a 500', async () => {
    const current = await pagesService.getPage(tenantId, createdPageId);
    const stale = await server.inject({
      method: 'PUT',
      url: `/api/pages/${createdPageId}`,
      headers: auth.headers,
      payload: { draft: current.draft, expectedVersion: current.version - 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(JSON.parse(stale.body).message).toMatch(/Version conflict/);

    const invalid = await server.inject({
      method: 'PUT',
      url: `/api/pages/${createdPageId}`,
      headers: auth.headers,
      payload: { draft: { ...current.draft, root: { id: 'r', type: 'not-a-component' } }, expectedVersion: current.version },
    });
    expect(invalid.statusCode).toBe(422);
    expect(JSON.parse(invalid.body).message).toMatch(/Invalid page definition/);

    // Two saves sent with the same version: exactly one applies, the other conflicts
    const both = await Promise.all([0, 1].map(() => server.inject({
      method: 'PUT',
      url: `/api/pages/${createdPageId}`,
      headers: auth.headers,
      payload: { draft: current.draft, expectedVersion: current.version },
    })));
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('enforces Allowed Roles once published: restricted roles cannot list, navigate to or open the page', async () => {
    const draft = (roles?: string[]) => ({
      schemaVersion: 2, id: 'p_restricted', version: 1, route: '/restricted-report',
      ...(roles ? { allowedRoles: roles } : {}),
      root: { id: 'root', type: 'stack', props: {}, children: [] },
    }) as PageDefinition;
    const page = await pagesService.createPage(tenantId, { name: 'Restricted Report', route: '/restricted-report', draft: draft() });
    await pagesService.publishPage(tenantId, page.id);

    const viewer = await createTestSession(tenantId, 'viewer', 'page_viewer_roles');
    const editor = await createTestSession(tenantId, 'editor', 'page_editor_roles');
    const sees = async (session: TestSession) => {
      const get = (url: string) => server.inject({ method: 'GET', url, headers: session.headers });
      const list = JSON.parse((await get('/api/pages')).body).some((p: any) => p.id === page.id);
      const published = JSON.parse((await get('/api/pages/published')).body).some((p: any) => p.route === '/restricted-report');
      const nav = JSON.parse((await get('/api/pages/navigation')).body).pages.some((p: any) => p.id === page.id);
      const open = (await get(`/api/pages/${page.id}`)).statusCode;
      return { list, published, nav, open };
    };
    try {
      // No restriction: everyone signed in sees it
      expect(await sees(viewer)).toEqual({ list: true, published: true, nav: true, open: 200 });

      // Restrict to editors; the saved draft keeps the setting (it used to be stripped on save)
      const current = await pagesService.getPage(tenantId, page.id);
      const saved = await pagesService.updatePage(tenantId, page.id, { draft: draft(['editor']), expectedVersion: current.version });
      expect(saved.draft.allowedRoles).toEqual(['editor']);
      // Not live until published
      expect((await sees(viewer)).open).toBe(200);

      await pagesService.publishPage(tenantId, page.id);
      expect(await sees(viewer)).toEqual({ list: false, published: false, nav: false, open: 403 });
      expect(await sees(editor)).toEqual({ list: true, published: true, nav: true, open: 200 });
      // Builders and above always see every page
      expect((await sees(auth)).open).toBe(200);

      // Removing the restriction and publishing opens it again
      const restricted = await pagesService.getPage(tenantId, page.id);
      await pagesService.updatePage(tenantId, page.id, { draft: draft(), expectedVersion: restricted.version });
      await pagesService.publishPage(tenantId, page.id);
      expect((await sees(viewer)).open).toBe(200);

      // Only real roles are accepted
      const latest = await pagesService.getPage(tenantId, page.id);
      await expect(pagesService.updatePage(tenantId, page.id, { draft: draft(['superuser']), expectedVersion: latest.version }))
        .rejects.toThrow(/Invalid page definition/);
    } finally {
      await cleanupTestUser(viewer.userId);
      await cleanupTestUser(editor.userId);
      await pagesService.deletePage(tenantId, page.id);
    }
  });

  it('keeps nested page routes and published JSON in sync when groups are renamed or pages move', async () => {
    const sales = await pagesService.createFolder(tenantId, { name: 'Sales' });
    const orders = await pagesService.createFolder(tenantId, { name: 'Orders', parentId: sales.id });
    const nestedPage = await pagesService.createPage(tenantId, {
      name: 'Order List',
      route: '/sales/orders/list',
      folderId: orders.id,
    });
    await pagesService.publishPage(tenantId, nestedPage.id);
    const rootCollision = await pagesService.createPage(tenantId, {
      name: 'Orders Root',
      route: '/list',
    });

    await expect(pagesService.movePage(tenantId, nestedPage.id, null)).rejects.toThrow(/already in use/);
    expect((await pagesService.getPage(tenantId, nestedPage.id)).route).toBe('/sales/orders/list');

    await pagesService.updateFolder(tenantId, sales.id, { name: 'Revenue' });
    const renamed = await pagesService.getPage(tenantId, nestedPage.id);
    expect(renamed.route).toBe('/revenue/orders/list');
    expect(renamed.draft.route).toBe('/revenue/orders/list');
    expect(renamed.published?.route).toBe('/revenue/orders/list');

    await pagesService.deletePage(tenantId, rootCollision.id);
    await pagesService.movePage(tenantId, nestedPage.id, null);
    expect((await pagesService.getPage(tenantId, nestedPage.id)).route).toBe('/list');
    await pagesService.deleteFolder(tenantId, orders.id);
    await pagesService.deleteFolder(tenantId, sales.id);
    await pagesService.deletePage(tenantId, nestedPage.id);
  });

  it('updates page settings (name, slug, group, width, icon) on draft and published without republishing', async () => {
    const group = await pagesService.createFolder(tenantId, { name: 'Ops', icon: 'Factory' });
    expect(group.icon).toBe('Factory');
    const page = await pagesService.createPage(tenantId, { name: 'Line View', route: '/line-view', width: 'full', icon: 'Gauge' });
    expect(page.draft.width).toBe('full');
    expect(page.draft.icon).toBe('Gauge');
    await pagesService.publishPage(tenantId, page.id);

    const res = await server.inject({
      method: 'PUT',
      url: `/api/pages/${page.id}/settings`,
      headers: auth.headers,
      payload: { name: 'Line Overview', slug: 'line-overview', folderId: group.id, width: 'theme', icon: 'Activity' },
    });
    expect(res.statusCode).toBe(200);
    const summary = JSON.parse(res.body);
    expect(summary).toMatchObject({ name: 'Line Overview', route: '/ops/line-overview', folderId: group.id, icon: 'Activity', width: null });

    const detail = await pagesService.getPage(tenantId, page.id);
    for (const def of [detail.draft, detail.published!]) {
      expect(def.route).toBe('/ops/line-overview');
      expect(def.width).toBeUndefined();
      expect(def.icon).toBe('Activity');
    }

    // null icon clears the override; omitted fields stay as they are
    await pagesService.updatePageSettings(tenantId, page.id, { icon: null });
    const cleared = await pagesService.getPage(tenantId, page.id);
    expect(cleared.published?.icon).toBeUndefined();
    expect(cleared.name).toBe('Line Overview');
    expect(cleared.route).toBe('/ops/line-overview');

    await expect(pagesService.updatePageSettings(tenantId, page.id, { slug: 'Bad Slug' })).rejects.toThrow(/URL slug/);
    await expect(pagesService.updatePageSettings(tenantId, page.id, { icon: 'NotAnIcon' })).rejects.toThrow(/not an allowed icon/);
    await expect(pagesService.updatePageSettings(tenantId, page.id, { width: 'wide' as any })).rejects.toThrow(/Width/);

    const updatedGroup = await pagesService.updateFolder(tenantId, group.id, { icon: null });
    expect(updatedGroup.icon).toBeNull();
    expect((await pagesService.updateFolder(tenantId, group.id, { name: 'Operations' })).icon).toBeNull();

    await pagesService.deletePage(tenantId, page.id);
    await pagesService.deleteFolder(tenantId, group.id);
  });

  it('deletes a page definition', async () => {
    const res = await pagesService.deletePage(tenantId, createdPageId);
    expect(res.success).toBe(true);
  });
});
