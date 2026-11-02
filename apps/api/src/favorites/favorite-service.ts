/** Favorite pages: what may be saved (a published page, a few short values, a short name) and the limit per person */
import { LiveSettingsError } from '../live/live-errors.js';
import { favoriteRepository, type Favorite } from './favorite-repository.js';

export const MAX_FAVORITES = 10;
const MAX_PARAMS = 10;

function parseParams(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new LiveSettingsError('params must be an object of values');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PARAMS) throw new LiveSettingsError(`A favorite can keep at most ${MAX_PARAMS} values`);
  for (const [key, value] of entries) {
    if (!key || key.length > 64 || typeof value !== 'string' || value.length > 200) {
      throw new LiveSettingsError('Each value needs a name up to 64 characters and text up to 200 characters');
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new LiveSettingsError('label must be text');
  const label = raw.trim();
  if (label.length > 128) throw new LiveSettingsError('A favorite name can be at most 128 characters');
  return label || null;
}

export const favoriteService = {
  list: (tenantId: string, userId: string): Promise<Favorite[]> => favoriteRepository.list(tenantId, userId),

  async add(tenantId: string, userId: string, body: unknown): Promise<{ favorite: Favorite; created: boolean }> {
    const { pageId, params, label } = (body ?? {}) as Record<string, unknown>;
    if (typeof pageId !== 'string' || !pageId) throw new LiveSettingsError('pageId is required');
    const input = { pageId, params: parseParams(params), label: parseLabel(label) };
    if (!(await favoriteRepository.pageIsPublished(tenantId, pageId))) throw new LiveSettingsError('Page not found', 404);
    const result = await favoriteRepository.add(tenantId, userId, input, MAX_FAVORITES);
    if ('full' in result) throw new LiveSettingsError(`You can keep up to ${MAX_FAVORITES} favorites. Remove one to add another.`, 409);
    return result;
  },

  async rename(tenantId: string, userId: string, id: string, body: unknown): Promise<Favorite> {
    const label = parseLabel((body as { label?: unknown } | null)?.label);
    return (await favoriteRepository.rename(tenantId, userId, id, label)) ?? Promise.reject(new LiveSettingsError('Favorite not found', 404));
  },

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    if (!(await favoriteRepository.remove(tenantId, userId, id))) throw new LiveSettingsError('Favorite not found', 404);
  },
};
