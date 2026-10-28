/** What gets published for each kind of shared item, from the workspace's own item it's shared from */
import { isSharedRef, sharedRef, symbolRefs, type PublishInput, type SharedKind, type TemplateContent } from '@config-platform/schema';
import { isBuiltinRef } from '@config-platform/schema/visual-library';
import { LiveSettingsError } from '../live/live-errors.js';
import { pagesService } from '../pages/pages-service.js';
import { exportTemplateService } from '../records/export/export-template-service.js';
import { visualRepository } from '../visuals/visual-repository.js';
import { buildSolution } from './solution-bundle.js';
import { entitiesUsedBy } from './template-entities.js';

export interface Published {
  name: string;
  content: unknown;
}

/** `publishedId`: the item's id when it was shared before */
type Publisher = (tenantId: string, input: PublishInput, publishedId?: string) => Promise<Published>;

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

/** A missing source is a 404, whichever service reports it */
async function found<T>(load: () => Promise<T | null>, what: string): Promise<T> {
  const item = await load().catch(() => null);
  if (!item) throw new LiveSettingsError(`${what} not found`, 404);
  return item;
}

const symbol: Publisher = async (tenantId, { sourceId }, publishedId) => {
  const visual = await found(() => visualRepository.get(tenantId, sourceId), 'Symbol');
  if (visual.kind !== 'symbol') throw new LiveSettingsError('Only symbols can be shared');
  // Everyone using it must be able to load what it places: built-in and shared symbols only
  const refs = symbolRefs(visual.definition.nodes);
  const local = refs.filter((r) => !isBuiltinRef(r) && !isSharedRef(r));
  if (local.length) {
    const names = await Promise.all(local.map(async (r) => (await visualRepository.get(tenantId, r))?.name ?? r));
    throw new LiveSettingsError(`It places ${quoted(names)}, which ${names.length === 1 ? "isn't" : "aren't"} shared. Share ${names.length === 1 ? 'that symbol' : 'those symbols'} first and place the shared ${names.length === 1 ? 'one' : 'ones'} instead.`);
  }
  if (publishedId && refs.includes(sharedRef(publishedId))) throw new LiveSettingsError("A symbol can't contain itself");
  return { name: visual.name, content: visual.definition };
};

/** A page's saved draft: its layout, components and data sources */
const pageTemplate: Publisher = async (tenantId, { sourceId }) => {
  const page = await found(() => pagesService.getPage(tenantId, sourceId), 'Page');
  if (!page.draft) throw new LiveSettingsError('Save the page before sharing it as a template');
  const content: TemplateContent = { definition: page.draft, entities: await entitiesUsedBy(tenantId, page.draft) };
  return { name: page.name, content };
};

/** An export template's saved draft, and the entity it exports */
const exportTemplate: Publisher = async (tenantId, { sourceId }) => {
  const template = await found(() => exportTemplateService.getTemplate(tenantId, sourceId), 'Export template');
  const content: TemplateContent = { definition: template.draft, entities: await entitiesUsedBy(tenantId, template.draft, template.entityId), entityId: template.entityId };
  return { name: template.name, content };
};

/** Chosen entities (and what they link to), with the pages and exports built on them */
const solution: Publisher = async (tenantId, { name, entityIds }) => {
  if (!name) throw new LiveSettingsError('Give the solution a name');
  return { name, content: await buildSolution(tenantId, entityIds ?? []) };
};

export const PUBLISHERS: Record<SharedKind, Publisher> = { symbol, 'page-template': pageTemplate, 'export-template': exportTemplate, solution };
