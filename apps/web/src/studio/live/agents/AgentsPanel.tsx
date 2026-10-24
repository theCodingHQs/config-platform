import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import type { LiveAgent } from "@config-platform/schema";
import { liveAgentsApi } from "../../../live/live-api";
import { useStatusNotify } from "../../../context/app-bar-context";
import { AgentInstall } from "./AgentInstall";

export const LIVE_AGENTS_KEY = ["live-agents"];

/** Studio → Live → Edge agents: programs inside the factory network that run connections there */
export function AgentsPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  /** A token just made (on creation or "New token"), shown once */
  const [shown, setShown] = useState<{ agentId: string; token: string } | null>(null);
  const { data: agents = [], isLoading } = useQuery({ queryKey: LIVE_AGENTS_KEY, queryFn: liveAgentsApi.list, refetchInterval: 5000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: LIVE_AGENTS_KEY });

  const create = useMutation({
    mutationFn: () => liveAgentsApi.create(name.trim()),
    onSuccess: (agent) => {
      setShown({ agentId: agent.id, token: agent.token });
      setName("");
      setAdding(false);
      refresh();
    },
    onError: (err: Error) => notify("error", err.message),
  });
  const newToken = useMutation({
    mutationFn: (agent: LiveAgent) => liveAgentsApi.newToken(agent.id).then((r) => ({ agentId: agent.id, token: r.token })),
    onSuccess: (r) => setShown(r),
    onError: (err: Error) => notify("error", err.message),
  });
  const remove = useMutation({
    mutationFn: (agent: LiveAgent) => liveAgentsApi.remove(agent.id),
    onSuccess: () => refresh(),
    onError: (err: Error) => notify("error", err.message),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)", maxWidth: "48rem" }}>
        When the machines are on the factory network and the app isn't, an edge agent runs there and connects out to the app. Set a
        connection's <strong>Runs on</strong> to the agent.
      </p>
      {canEdit &&
        (adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}
          >
            <input className="form-input" style={{ flex: "1 1 18rem", width: "auto" }} aria-label="Agent name" placeholder="Plant 2 gateway PC" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create agent"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size="1em" /> New agent
            </button>
          </div>
        ))}

      {shown && <AgentInstall token={shown.token} />}

      {isLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading agents…</p>
      ) : agents.length === 0 ? (
        <div style={{ padding: "var(--space-8) var(--space-4)", textAlign: "center", border: "var(--border-width) dashed var(--border)", borderRadius: "var(--radius-surface)", color: "var(--text-muted)" }}>
          No edge agents. You only need one when the app can't reach the machines directly.
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>Running on</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td data-label="Agent" style={{ fontWeight: 600 }}>{a.name}</td>
                  <td data-label="Status">
                    <span className={a.online ? "badge badge-success" : "badge"}>{a.online ? "Online" : "Offline"}</span>
                  </td>
                  <td data-label="Last seen" style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                    {a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : "Never"}
                  </td>
                  <td data-label="Running on" style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                    {a.hostname ? `${a.hostname}${a.version ? ` · v${a.version}` : ""}` : "—"}
                  </td>
                  <td data-label="">
                    {canEdit && (
                      <div style={{ display: "flex", gap: "var(--space-1)", justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => confirm(`Make a new token for "${a.name}"? The running agent is disconnected until it gets the new one.`) && newToken.mutate(a)}>
                          <KeyRound size="1em" /> New token
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: "var(--danger)" }} aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete "${a.name}"?`) && remove.mutate(a)}>
                          <Trash2 size="1em" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
