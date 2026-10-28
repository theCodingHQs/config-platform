/** Publishing to the shared library, using shared templates, and not pulling a symbol out from under the drawings using it */
import { PublishInputSchema, SHARED_KINDS, TEMPLATE_KINDS, UseTemplateInputSchema, sharedRef, type SharedItem, type SharedItemSummary, type SharedKind, type SolutionContent, type TemplateContent, type UsedTemplate, type InstallPlan, type InstallResult } from '@config-platform/schema';
import type { SessionPayload } from '../auth/auth-types.js';
import { LiveSettingsError } from '../live/live-errors.js';
import { PUBLISHERS } from './publishers.js';
import { sharedRepository } from './shared-repository.js';
import { installPlan, installSolution } from './solution-installer.js';
import { remapTemplate } from './template-entities.js';

const notFound = () => new LiveSettingsError('Shared item not found', 404);

async function solutionContent(loading: Promise<SharedItem>): Promise<SolutionContent> {
  const item = await loading;
  if (item.kind !== 'solution') throw new LiveSettingsError('Only solutions are installed');
  return item.content as SolutionContent;
}

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

const problems = (issues: Array<{ message: string }>) => new LiveSettingsError(issues.map((i) => i.message).join('; '));

function parseKind(raw: unknown): SharedKind {
  const kind = String(raw ?? 'symbol');
  if (!(SHARED_KINDS as readonly string[]).includes(kind)) throw new LiveSettingsError(`Unknown kind "${kind}"`);
  return kind as SharedKind;
}

/** "used by …" for a refusal; null when nothing uses it (templates are copied when used, so never) */
async function inUse(tenantId: string, id: string): Promise<string | null> {
  const { here, elsewhere } = await sharedRepository.usage(tenantId, sharedRef(id));
  const parts = [
    ...(here.length ? [quoted(here)] : []),
    ...(elsewhere ? [`${elsewhere} ${elsewhere === 1 ? 'visual' : 'visuals'} in other workspaces`] : []),
  ];
  return parts.length ? parts.join(' and ') : null;
}

export const sharedService = {
  /** `everyWorkspace`: platform owners see every workspace's items, to choose which to share everywhere */
  list: (tenantId: string, kind: unknown, everyWorkspace = false): Promise<SharedItemSummary[]> => sharedRepository.list(tenantId, parseKind(kind), everyWorkspace),

  async get(tenantId: string, id: string): Promise<SharedItem> {
    return (await sharedRepository.get(tenantId, id)) ?? Promise.reject(notFound());
  },

  /** Publishes the first release of one of the workspace's own items, or the next one */
  async publish(tenantId: string, userId: string, body: unknown): Promise<SharedItem> {
    const parsed = PublishInputSchema.safeParse(body);
    if (!parsed.success) throw problems(parsed.error.issues);
    const { kind, sourceId, description } = parsed.data;
    const published = (await sharedRepository.list(tenantId, kind)).find((s) => s.own && s.sourceId === sourceId);
    const { name, content } = await PUBLISHERS[kind](tenantId, parsed.data, published?.id);
    const id = await sharedRepository.publish(tenantId, userId, { kind, sourceId, name, description, content });
    return this.get(tenantId, id);
  },

  /** A page or export template's layout, pointed at this workspace's entities */
  async use(tenantId: string, id: string, body: unknown): Promise<UsedTemplate> {
    const parsed = UseTemplateInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw problems(parsed.error.issues);
    const item = await this.get(tenantId, id);
    if (!TEMPLATE_KINDS.includes(item.kind)) throw new LiveSettingsError('Only page and export templates are used this way');
    const content = item.content as TemplateContent;
    return remapTemplate(tenantId, content, parsed.data.entityMap, content.entityId);
  },

  /** What installing a solution would do: which of its entities clash with the workspace's, and how */
  async installPlan(tenantId: string, id: string): Promise<InstallPlan> {
    return installPlan(tenantId, await solutionContent(this.get(tenantId, id)));
  },

  async install(tenantId: string, id: string, body: unknown, session?: SessionPayload): Promise<InstallResult> {
    return installSolution(tenantId, await solutionContent(this.get(tenantId, id)), body, session);
  },

  /** Platform owners: share with every workspace, or stop (not while other workspaces use it) */
  async setEverywhere(id: string, everywhere: boolean): Promise<{ id: string; everywhere: boolean }> {
    const owner = await sharedRepository.ownerOf(id);
    if (!owner) throw notFound();
    if (!everywhere) {
      const users = (await sharedRepository.usage(owner, sharedRef(id))).elsewhere;
      if (users) throw new LiveSettingsError(`${users} ${users === 1 ? 'visual' : 'visuals'} in other workspaces use it. They need to stop using it before it can stop being shared everywhere.`, 409);
    }
    await sharedRepository.setEverywhere(id, everywhere);
    return { id, everywhere };
  },

  /** The publishing workspace takes it out of the library (not while anything uses it) */
  async unpublish(tenantId: string, id: string): Promise<SharedItem> {
    const before = await this.get(tenantId, id);
    if (!before.own) throw new LiveSettingsError('Only the workspace that shared it can stop sharing it', 403);
    const users = await inUse(tenantId, id);
    if (users) throw new LiveSettingsError(`It's used by ${users}. Remove it from there first.`, 409);
    await sharedRepository.remove(tenantId, id);
    return before;
  },
};
