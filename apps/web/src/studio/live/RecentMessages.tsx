import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { liveApi } from "../../live/live-api";
import { messagePaths, type MessagePath } from "./message-paths";

/**
 * What the source has sent recently. Each value in the newest message can become a tag in one
 * click, so nobody has to guess the message's shape.
 */
export function RecentMessages({ connectionId, onUsePath, canEdit }: { connectionId: string; onUsePath: (path: MessagePath, topic?: string) => void; canEdit: boolean }) {
  const { data: messages = [] } = useQuery({
    queryKey: ["live-messages", connectionId],
    queryFn: () => liveApi.messages(connectionId),
    refetchInterval: 2000,
  });
  const latest = messages.find((m) => m.message !== undefined);
  const paths = latest ? messagePaths(latest.message) : [];

  if (messages.length === 0) {
    return <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>Nothing received yet. Messages appear here as soon as the source sends them.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {paths.length > 0 && (
        <div>
          <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
            Values in the latest message{latest?.topic ? ` (topic ${latest.topic})` : ""}{canEdit ? ": click + to make one a tag" : ""}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
            {paths.map((p) => (
              <span key={p.expression} className="badge" style={{ fontFamily: "var(--font-mono)", gap: "var(--space-1)", display: "inline-flex", alignItems: "center" }}>
                {p.expression} = {String(p.value)}
                {canEdit && (
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ padding: 0, minHeight: 0 }} aria-label={`Make ${p.expression} a tag`} onClick={() => onUsePath(p, latest?.topic)}>
                    <Plus size="1em" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: "14rem", overflowY: "auto" }}>
        {messages.map((m, i) => (
          <li key={`${m.at}-${i}`} style={{ fontSize: "var(--font-size-xs)", borderBottom: "var(--border-width-sm) solid var(--border-subtle)", paddingBottom: "var(--space-1)" }}>
            <span style={{ color: "var(--text-muted)" }}>{new Date(m.at).toLocaleTimeString()}</span>
            {m.topic && <span style={{ color: "var(--text-muted)" }}> · {m.topic}</span>}
            <code style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.raw}</code>
            {m.decodeError && <span style={{ color: "var(--danger)" }}>{m.decodeError}</span>}
            {m.ruleErrors?.map((e) => (
              <span key={e.tag} style={{ display: "block", color: "var(--danger)" }}>
                {e.tag}: {e.error}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
