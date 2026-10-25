/** Saving visuals: validation, safe saving (versions), and not deleting one a page still shows. */
import { VisualInputSchema, symbolRefs, type Visual, type VisualInput, type VisualSummary } from '@config-platform/schema';
import { LiveSettingsError } from '../live/live-errors.js';
import { visualRepository } from './visual-repository.js';

function parse(body: unknown): VisualInput {
  const parsed = VisualInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new LiveSettingsError(parsed.error.issues.map((i) => `${i.path.join('.') || 'visual'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

const notFound = () => new LiveSettingsError('Visual not found', 404);

export const visualService = {
  list: (tenantId: string): Promise<VisualSummary[]> => visualRepository.list(tenantId),

  async get(tenantId: string, id: string): Promise<Visual> {
    return (await visualRepository.get(tenantId, id)) ?? Promise.reject(notFound());
  },

  create: (tenantId: string, userId: string, body: unknown): Promise<Visual> => visualRepository.create(tenantId, userId, parse(body)),

  async update(tenantId: string, id: string, body: unknown): Promise<{ before: Visual; after: Visual }> {
    const expectedVersion = Number((body as { expectedVersion?: unknown } | null)?.expectedVersion);
    if (!Number.isInteger(expectedVersion)) throw new LiveSettingsError('expectedVersion is required');
    const input = parse(body);
    const before = await this.get(tenantId, id);
    if (symbolRefs(input.definition.nodes).includes(id)) throw new LiveSettingsError("A symbol can't contain itself");
    const after = await visualRepository.update(tenantId, id, input, expectedVersion);
    if (!after) throw new LiveSettingsError('Someone else saved this visual since you opened it. Reload it to see their changes.', 409);
    return { before, after };
  },

  async remove(tenantId: string, id: string): Promise<Visual> {
    const before = await this.get(tenantId, id);
    const pages = await visualRepository.pagesUsing(tenantId, id);
    const visuals = before.kind === 'symbol' ? await visualRepository.visualsUsing(tenantId, id) : [];
    if (visuals.length) {
      throw new LiveSettingsError(`This symbol is placed in ${visuals.map((v) => `"${v}"`).join(', ')}. Remove it from there first.`, 409);
    }
    if (pages.length) {
      throw new LiveSettingsError(`This visual is shown on ${pages.length === 1 ? 'the page' : 'pages'} ${pages.map((p) => `"${p}"`).join(', ')}. Remove it from there first.`, 409);
    }
    await visualRepository.remove(tenantId, id);
    return before;
  },
};
