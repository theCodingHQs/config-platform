import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RadioTower } from "lucide-react";
import type { LiveConnection, LiveConnectionKind } from "@config-platform/schema";
import { liveApi } from "../../live/live-api";
import { useAuth } from "../../context/auth-context";
import { ConnectionEditor, LIVE_CONNECTIONS_KEY } from "./ConnectionEditor";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { NewConnectionPicker } from "./NewConnectionPicker";
import { draftFromConnection, emptyDraft, KIND_LABELS } from "./connection-draft";

type View = { mode: "list" } | { mode: "pick" } | { mode: "new"; kind: LiveConnectionKind } | { mode: "edit"; id: string };

/** Studio → Live: the workspace's live data sources and their tags */
export function LiveStudio() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "admin";
  const [view, setView] = useState<View>({ mode: "list" });
  const { data: connections = [], isLoading, error } = useQuery({
    queryKey: LIVE_CONNECTIONS_KEY,
    queryFn: liveApi.connections,
    // Status (connected, last message) changes on its own
    refetchInterval: 5000,
  });
  const editing = view.mode === "edit" ? connections.find((c) => c.id === view.id) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: "72rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <RadioTower size="1em" style={{ color: "var(--accent)" }} /> Live data
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
            Connect machines and systems; their values become tags pages can show live, e.g. {"{{ live.line1.speed }}"}.
          </p>
        </div>
        {canEdit && view.mode === "list" && (
          <button type="button" className="btn btn-primary" onClick={() => setView({ mode: "pick" })}>
            <Plus size="1em" /> New connection
          </button>
        )}
      </div>

      {view.mode === "pick" && <NewConnectionPicker onPick={(kind) => setView({ mode: "new", kind })} onCancel={() => setView({ mode: "list" })} />}
      {view.mode === "new" && (
        <ConnectionEditor key="new" initial={emptyDraft(view.kind)} canEdit={canEdit} onSaved={(saved) => setView({ mode: "edit", id: saved.id })} onClose={() => setView({ mode: "list" })} />
      )}
      {view.mode === "edit" && editing && (
        <ConnectionEditor key={editing.id} connection={editing} initial={draftFromConnection(editing)} canEdit={canEdit} onSaved={() => undefined} onClose={() => setView({ mode: "list" })} />
      )}

      {view.mode === "list" && (
        <ConnectionList connections={connections} loading={isLoading} error={error as Error | null} onOpen={(id) => setView({ mode: "edit", id })} />
      )}
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
              <td data-label="Kind">{KIND_LABELS[c.kind]}</td>
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
