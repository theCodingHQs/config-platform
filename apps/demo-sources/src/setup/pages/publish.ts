/**
 * Puts the demo pages in their menu folders ("Machine Monitoring" unless a page says otherwise):
 * new pages are created, pages already there (same route) get the new draft, and all are published.
 */
import type { ApiClient } from '../api-client.js';
import type { PageContext, PageSpec } from './context.js';
import { plantOverviewPage } from './plant-overview.js';
import { connectionsShowcasePage } from './connections-showcase.js';
import { machineDetailPage } from './machine-detail.js';
import { orderDeskPage } from './order-desk-page.js';
import { processPage } from './process-page.js';

const FOLDER = { name: 'Machine Monitoring', icon: 'Factory' };

export function monitoringPages(ctx: PageContext): PageSpec[] {
  return [plantOverviewPage(ctx), machineDetailPage(ctx), connectionsShowcasePage(ctx), processPage(ctx), orderDeskPage(ctx)];
}

export async function publishPages(api: ApiClient, specs: PageSpec[], log: (line: string) => void): Promise<void> {
  const nav = await api.get<{ folders: Array<{ id: string; name: string }>; pages: Array<{ id: string; route: string }> }>('/pages/navigation');
  const folderIds = new Map(nav.folders.map((f) => [f.name, f.id]));
  for (const spec of specs) {
    const folder = spec.folder ?? FOLDER;
    let folderId = folderIds.get(folder.name);
    if (!folderId) {
      folderId = (await api.post<{ id: string }>('/pages/navigation/folders', folder)).id;
      folderIds.set(folder.name, folderId);
    }
    const existing = nav.pages.find((p) => p.route === spec.route);
    let id: string;
    if (existing) {
      id = existing.id;
      await api.put(`/pages/${id}`, { draft: { ...spec.draft, id } });
      log(`~ page ${spec.name}`);
    } else {
      id = (await api.post<{ id: string }>('/pages', { name: spec.name, route: spec.route, folderId, icon: spec.icon, draft: spec.draft })).id;
      log(`+ page ${spec.name}`);
    }
    await api.put(`/pages/${id}/settings`, { icon: spec.icon });
    await api.post(`/pages/${id}/publish`);
  }
}
