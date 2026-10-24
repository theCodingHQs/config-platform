import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { LiveConnection, PageRole } from "@config-platform/schema";
import { liveApi } from "../../live/live-api";
import { useStatusNotify } from "../../context/app-bar-context";
import { draftFromConnection, draftToInput, KIND_LABELS, newTagRule, type ConnectionDraft } from "./connection-draft";
import { suggestTagName, type MessagePath } from "./message-paths";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { Field } from "./Field";
import { Section } from "./Section";
import { TagRulesEditor } from "./TagRulesEditor";
import { RecentMessages } from "./RecentMessages";
import { LiveValues } from "./LiveValues";
import { WebSocketSettingsFields } from "./settings/WebSocketSettingsFields";
import { MqttSettingsFields } from "./settings/MqttSettingsFields";
import { SimulatorSettingsFields } from "./settings/SimulatorSettingsFields";

export const LIVE_CONNECTIONS_KEY = ["live-connections"];
const ROLES: Array<{ role: PageRole; label: string }> = [
  { role: "builder", label: "Builders" },
  { role: "editor", label: "Editors" },
  { role: "viewer", label: "Viewers" },
];

/** Settings of one connection: where it connects, its tags, who sees them; live checks once saved */
export function ConnectionEditor({
  connection,
  initial,
  canEdit,
  onSaved,
  onClose,
}: {
  /** The saved connection (undefined while creating) */
  connection?: LiveConnection;
  initial: ConnectionDraft;
  canEdit: boolean;
  onSaved: (saved: LiveConnection) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const set = (patch: Partial<ConnectionDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: () => (draft.id ? liveApi.update(draft.id, draftToInput(draft)) : liveApi.create(draftToInput(draft))),
    onSuccess: (saved) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: LIVE_CONNECTIONS_KEY });
      setDraft(draftFromConnection(saved));
      notify("success", `${saved.name} saved.`);
      onSaved(saved);
    },
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: () => liveApi.remove(draft.id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LIVE_CONNECTIONS_KEY });
      notify("success", `${draft.name} deleted.`);
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const addTagFromPath = (path: MessagePath, topic?: string) => {
    const prefix = newTagRule(draft).tag.split(".")[0];
    const tag = suggestTagName(path.expression, prefix);
    if (draft.tags.some((t) => t.tag === tag)) return;
    set({ tags: [...draft.tags, { tag, value: path.expression, type: path.type, ...(draft.kind === "mqtt" && topic ? { topic } : {}) }] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 18rem" }}>
          <Field label={`${KIND_LABELS[draft.kind]} connection name`} htmlFor="lc-name">
            <input id="lc-name" className="form-input" value={draft.name} disabled={!canEdit} placeholder="Line 1 gateway" onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
          <input type="checkbox" checked={draft.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} /> Connect
        </label>
        {connection && <ConnectionStatusBadge status={connection.status} />}
      </div>
      {connection?.status?.error && (
        <p role="note" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {connection.status.error}
        </p>
      )}

      <Section title="Connection">
        {draft.kind === "websocket" && <WebSocketSettingsFields value={draft.websocket} disabled={!canEdit} onChange={(websocket) => set({ websocket })} />}
        {draft.kind === "mqtt" && <MqttSettingsFields value={draft.mqtt} disabled={!canEdit} onChange={(mqtt) => set({ mqtt })} />}
        {draft.kind === "simulator" && <SimulatorSettingsFields value={draft.simulator} disabled={!canEdit} onChange={(simulator) => set({ simulator })} />}
      </Section>

      <Section title="Tags" intro="Named live values pages can show, such as line1.speed. Each says where its value is in a message.">
        <TagRulesEditor
          rules={draft.tags}
          showTopic={draft.kind === "mqtt"}
          disabled={!canEdit}
          onChange={(tags) => set({ tags })}
          onAdd={() => set({ tags: [...draft.tags, newTagRule(draft)] })}
        />
      </Section>

      {connection && (
        <>
          <Section title="Live values" intro="What pages see right now (after saving).">
            <LiveValues rules={connection.tags} />
          </Section>
          <Section title="Recent messages" intro="The last messages received, as sent by the source.">
            <RecentMessages connectionId={connection.id} canEdit={canEdit} onUsePath={addTagFromPath} />
          </Section>
        </>
      )}

      <Section title="Who can see this data" intro="Admins and owners always can. Leave all unticked for everyone in the workspace.">
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: "var(--font-size-sm)" }}>
          {ROLES.map(({ role, label }) => (
            <label key={role} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={draft.viewRoles.includes(role)}
                onChange={(e) => set({ viewRoles: e.target.checked ? [...draft.viewRoles, role] : draft.viewRoles.filter((r) => r !== role) })}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {error}
        </p>
      )}
      {canEdit ? (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : draft.id ? "Save changes" : "Create connection"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {draft.id ? "Close" : "Cancel"}
          </button>
          {draft.id && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: "var(--danger)", marginLeft: "auto" }}
              disabled={remove.isPending}
              onClick={() => confirm(`Delete "${draft.name}"? Pages using its tags will show nothing.`) && remove.mutate()}
            >
              <Trash2 size="1em" /> Delete
            </button>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Only admins and owners can change connections.</p>
      )}
    </div>
  );
}

