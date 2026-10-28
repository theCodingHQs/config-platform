import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { LiveConnection } from "@config-platform/schema";
import { liveApi } from "../../live/live-api";
import { ConnectionEditor, LIVE_CONNECTIONS_KEY } from "./ConnectionEditor";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { NewConnectionPicker } from "./NewConnectionPicker";
import { draftFromConnection, emptyDraft } from "./connection-draft";
import { KIND_UI } from "./kinds";
import { livePath, useLiveRoute } from "./live-route";

/** Studio → Live → Connections: where live data comes from, and its tags */
export function ConnectionsPanel({ canEdit }: { canEdit: boolean }) {
  const { view: route, go } = useLiveRoute();
  const view = route.tab === "connections" ? route : ({ tab: "connections", screen: "list" } as const);
  const toList = () => go(livePath.tab("connections"));
  /** An HTTP push token from creating a connection, carried into its editor (shown once) */
  const [createdToken, setCreatedToken] = useState<{ id: string; token: string } | null>(null);
  const { data: connections = [], isLoading, error } = useQuery({
    queryKey: LIVE_CONNECTIONS_KEY,
    queryFn: liveApi.connections,
    // Status (connected, last message) changes on its own
    refetchInterval: 5000,
  });
  const editing = view.screen === "edit" ? connections.find((c) => c.id === view.id) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {canEdit && view.screen === "list" && (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => go(livePath.newConnection())}>
            <Plus size="1em" /> New connection
          </button>
        </div>
      )}
      {view.screen === "pick" && <NewConnectionPicker onPick={(kind) => go(livePath.newConnection(kind), { replace: true })} onCancel={toList} />}
      {view.screen === "new" && (
        <ConnectionEditor key={`new-${view.kind}`} initial={emptyDraft(view.kind)} canEdit={canEdit} onSaved={(saved) => {
            if (saved.pushToken) setCreatedToken({ id: saved.id, token: saved.pushToken });
            // The saved connection takes the new form's place, so Back doesn't return to an empty form
            go(livePath.connection(saved.id), { replace: true });
          }} onClose={toList} />
      )}
      {view.screen === "edit" && !editing && !isLoading && (
        <NotFound what="connection" onBack={toList} />
      )}
      {view.screen === "edit" && editing && (
        <ConnectionEditor
          key={editing.id}
          connection={editing}
          initial={draftFromConnection(editing)}
          canEdit={canEdit}
          justCreatedToken={createdToken?.id === editing.id ? createdToken.token : undefined}
          onSaved={() => undefined}
          onClose={() => {
            setCreatedToken(null);
            toList();
          }}
        />
      )}
      {view.screen === "list" && (
        <ConnectionList connections={connections} loading={isLoading} error={error as Error | null} onOpen={(id) => go(livePath.connection(id))} />
      )}
    </div>
  );
}

/** An address for something that's gone (deleted, or a link from another workspace) */
export function NotFound({ what, onBack }: { what: string; onBack: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-2)" }}>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>This {what} doesn't exist any more, or isn't in this workspace.</p>
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        Back to the list
      </button>
    </div>
  );
}

function ConnectionList({ connections, loading, error, onOpen }: { connections: LiveConnection[]; loading: boolean; error: Error | null; onOpen: (id: string) => void }) {
  if (loading) return <p style={{ color: "var(--text-muted)" }}>Loading connections…</p>;
  if (error) return <p style={{ color: "var(--danger)" }}>{error.message}</p>;
  if (connections.length === 0) {
    return (
      <div style={{ padding: "var(--space-8) var(--space-4)", textAlign: "center", border: "var(--border-width) dashed var(--border)", borderRadius: "var(--radius-surface)", color: "var(--text-muted)" }}>
        No connections yet. Start with a <strong>Simulator</strong> to build pages before machines are connected.
      </div>
    );
  }
  return (
    <div className="table-container">
      <table className="data-table responsive-cards">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Kind</th>
            <th>Tags</th>
            <th>Status</th>
            <th>Last message</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id} className="table-row-clickable" style={{ cursor: "pointer" }} onClick={() => onOpen(c.id)}>
              <td data-label="Connection" style={{ fontWeight: 600 }}>
                <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontWeight: 600, fontSize: "inherit" }} onClick={() => onOpen(c.id)}>
                  {c.name}
                </button>
              </td>
              <td data-label="Kind">{KIND_UI[c.kind].label}</td>
              <td data-label="Tags">{c.tags.length}</td>
              <td data-label="Status">
                <ConnectionStatusBadge status={c.status ?? (c.enabled ? undefined : { state: "disabled", messagesReceived: 0 })} />
              </td>
              <td data-label="Last message" style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                {c.status?.lastMessageAt ? new Date(c.status.lastMessageAt).toLocaleTimeString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
