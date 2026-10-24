/**
 * Saving live connections: validation, storage and (re)starting them in the hub. What the
 * settings screen gets back never includes a secret.
 */
import { LiveConnectionInputSchema, type LiveConnection } from '@config-platform/schema';
import { connectionRepository, type StoredConnection } from './connection-repository.js';
import { redactSettings } from './connection-secrets.js';
import { liveHub } from './live-hub.js';
import { checkTagRules } from './tag-mapper.js';
import { LiveSettingsError } from './live-errors.js';
import { newPushToken } from './adapters/http-push-adapter.js';

function toView(stored: StoredConnection): LiveConnection {
  const status = liveHub.statusOf(stored.tenantId)[stored.id];
  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind,
    enabled: stored.enabled,
    settings: redactSettings(stored.kind, stored.settings),
    tags: stored.tags,
    viewRoles: stored.viewRoles as LiveConnection['viewRoles'],
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...(status ? { status: { state: status.state, error: status.error, warning: status.warning, lastMessageAt: status.lastMessageAt, messagesReceived: status.messagesReceived } } : {}),
  };
}

function parse(body: unknown) {
  const parsed = LiveConnectionInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new LiveSettingsError(parsed.error.issues.map((i) => `${i.path.join('.') || 'connection'}: ${i.message}`).join('; '));
  }
  const problems = checkTagRules(parsed.data.tags);
  if (problems.length) throw new LiveSettingsError(problems.join('; '));
  return parsed.data;
}

/** Another connection already produces one of these tags: two sources would overwrite each other */
async function checkTagsAreFree(tenantId: string, tags: string[], exceptId?: string): Promise<void> {
  const taken = new Map<string, string>();
  for (const other of await connectionRepository.list(tenantId)) {
    if (other.id === exceptId) continue;
    for (const rule of other.tags) taken.set(rule.tag, other.name);
  }
  const clash = tags.find((tag) => taken.has(tag));
  if (clash) throw new LiveSettingsError(`Tag "${clash}" already comes from "${taken.get(clash)}". Give it a different name.`, 409);
}

export const liveConnectionService = {
  async list(tenantId: string): Promise<LiveConnection[]> {
    return (await connectionRepository.list(tenantId)).map(toView);
  },

  async create(tenantId: string, userId: string, body: unknown): Promise<LiveConnection> {
    const input = parse(body);
    await checkTagsAreFree(tenantId, input.tags.map((t) => t.tag));
    // HTTP push: the token is made here and shown once; only its hash is stored
    const push = input.kind === 'http-push' ? newPushToken() : null;
    const saved = await connectionRepository.create(tenantId, userId, input, push ? { tokenHash: push.tokenHash } : {});
    liveHub.apply(saved);
    return { ...toView(saved), ...(push ? { pushToken: push.token } : {}) };
  },

  /** A new HTTP push token (the old one stops working); shown once */
  async newPushToken(tenantId: string, id: string): Promise<{ pushToken: string }> {
    const previous = await connectionRepository.get(tenantId, id);
    if (!previous || previous.kind !== 'http-push') throw new LiveSettingsError('HTTP push connection not found', 404);
    const { token, tokenHash } = newPushToken();
    const saved = await connectionRepository.mergeServerSettings(tenantId, id, { tokenHash });
    liveHub.apply(saved!);
    return { pushToken: token };
  },

  async update(tenantId: string, id: string, body: unknown): Promise<{ before: LiveConnection; after: LiveConnection }> {
    const previous = await connectionRepository.get(tenantId, id);
    if (!previous) throw new LiveSettingsError('Connection not found', 404);
    const input = parse(body);
    if (input.kind !== previous.kind) throw new LiveSettingsError("A connection's kind can't be changed. Create a new connection instead.");
    await checkTagsAreFree(tenantId, input.tags.map((t) => t.tag), id);
    const saved = await connectionRepository.update(tenantId, previous, input);
    liveHub.apply(saved);
    return { before: toView(previous), after: toView(saved) };
  },

  async remove(tenantId: string, id: string): Promise<LiveConnection> {
    const previous = await connectionRepository.get(tenantId, id);
    if (!previous || !(await connectionRepository.remove(tenantId, id))) throw new LiveSettingsError('Connection not found', 404);
    await liveHub.remove(tenantId, id);
    return toView(previous);
  },

  /** Every tag the workspace's connections produce, for pickers in the page builder */
  async tags(tenantId: string) {
    return (await connectionRepository.list(tenantId)).flatMap((c) =>
      c.tags.map((rule) => ({ tag: rule.tag, type: rule.type, unit: rule.unit, label: rule.label, connectionId: c.id, connectionName: c.name })),
    );
  },
};
