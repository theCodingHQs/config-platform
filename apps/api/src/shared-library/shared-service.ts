/** Publishing to the shared library: what may be published, and not pulling an item out from under the drawings using it */
import { PublishInputSchema, SHARED_KINDS, isSharedRef, sharedRef, symbolRefs, type SharedItem, type SharedItemSummary, type SharedKind } from '@config-platform/schema';
import { isBuiltinRef } from '@config-platform/schema/visual-library';
import { LiveSettingsError } from '../live/live-errors.js';
import { visualRepository } from '../visuals/visual-repository.js';
import { sharedRepository } from './shared-repository.js';

const notFound = () => new LiveSettingsError('Shared item not found', 404);

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

function parseKind(raw: unknown): SharedKind {
  const kind = String(raw ?? 'symbol');
  if (!(SHARED_KINDS as readonly string[]).includes(kind)) throw new LiveSettingsError(`Unknown kind "${kind}"`);
  return kind as SharedKind;
}

/** "used by …" for a refusal; null when nothing uses it */
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

  /** Publishes a symbol: its first release, or the next one */
  async publish(tenantId: string, userId: string, body: unknown): Promise<SharedItem> {
    const parsed = PublishInputSchema.safeParse(body);
    if (!parsed.success) throw new LiveSettingsError(parsed.error.issues.map((i) => i.message).join('; '));
    const { sourceId, description } = parsed.data;
    const symbol = await visualRepository.get(tenantId, sourceId);
    if (!symbol) throw new LiveSettingsError('Symbol not found', 404);
    if (symbol.kind !== 'symbol') throw new LiveSettingsError('Only symbols can be shared');

    // Everyone using it must be able to load what it places: built-in and shared symbols only
    const refs = symbolRefs(symbol.definition.nodes);
    const local = refs.filter((r) => !isBuiltinRef(r) && !isSharedRef(r));
    if (local.length) {
      const names = await Promise.all(local.map(async (r) => (await visualRepository.get(tenantId, r))?.name ?? r));
      throw new LiveSettingsError(`It places ${quoted(names)}, which ${names.length === 1 ? "isn't" : "aren't"} shared. Share ${names.length === 1 ? 'that symbol' : 'those symbols'} first and place the shared ${names.length === 1 ? 'one' : 'ones'} instead.`);
    }
    const published = (await sharedRepository.list(tenantId, 'symbol')).find((s) => s.own && s.sourceId === sourceId);
    if (published && refs.includes(sharedRef(published.id))) throw new LiveSettingsError("A symbol can't contain itself");

    const id = await sharedRepository.publish(tenantId, userId, { kind: 'symbol', sourceId, name: symbol.name, description, content: symbol.definition });
    return this.get(tenantId, id);
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
