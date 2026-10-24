/**
 * The connection form's values, and conversion to and from what the server stores. The parts
 * that differ by kind (settings) come from that kind's file in ./kinds.
 */
import type { LiveConnection, LiveConnectionKind, PageRole, TagRule } from "@config-platform/schema";
import { KIND_UI } from "./kinds";

export interface ConnectionDraft {
  id?: string;
  name: string;
  kind: LiveConnectionKind;
  enabled: boolean;
  viewRoles: PageRole[];
  tags: TagRule[];
  /** Runs on this edge agent; null = the app server */
  agentId: string | null;
  /** The kind's own form values (see its KindUi) */
  settings: any;
}

export function emptyDraft(kind: LiveConnectionKind): ConnectionDraft {
  return { name: "", kind, enabled: true, viewRoles: [], tags: [], agentId: null, settings: KIND_UI[kind].empty() };
}

export function draftFromConnection(c: LiveConnection): ConnectionDraft {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    enabled: c.enabled,
    viewRoles: c.viewRoles,
    tags: c.tags,
    agentId: c.agentId ?? null,
    settings: KIND_UI[c.kind].fromSaved(c.settings ?? {}),
  };
}

const optional = (text: string) => (text.trim() ? text.trim() : undefined);

/** What the server expects (LiveConnectionInputSchema); empty secrets are left out to keep them */
export function draftToInput(d: ConnectionDraft): Record<string, unknown> {
  const tags = d.tags.map((t) => ({
    ...t,
    when: optional(t.when ?? ""),
    topic: optional(t.topic ?? ""),
    unit: optional(t.unit ?? ""),
    label: optional(t.label ?? ""),
  }));
  return {
    name: d.name.trim(),
    kind: d.kind,
    enabled: d.enabled,
    viewRoles: d.viewRoles,
    tags,
    // HTTP push is received by the app itself
    agentId: d.kind === "http-push" ? null : d.agentId,
    settings: KIND_UI[d.kind].toInput(d.settings),
  };
}

/** A new tag rule, guessing a name from the connection's ("Line 1 gateway" → line_1_gateway.value) */
export function newTagRule(d: ConnectionDraft): TagRule {
  const prefix = d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tag";
  const safe = /^[a-z_]/.test(prefix) ? prefix : `_${prefix}`;
  return { tag: `${safe}.value_${d.tags.length + 1}`, value: "message.", type: "number" };
}
