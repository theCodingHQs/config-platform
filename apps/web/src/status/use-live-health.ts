/**
 * The live data link (the browser's one socket) and how the workspace's live connections are
 * doing. Keeps the socket open while it's used, so the states stay current on every screen.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ConnectionState } from "@config-platform/schema";
import { liveSocketClient, type LiveSocketClient, type SocketState } from "../live/live-socket-client";

export interface LiveHealth {
  socket: SocketState;
  /** The connections this person can see, by state (switched-off ones aside) */
  counts: Record<Exclude<ConnectionState, "disabled">, number>;
  total: number;
  /** Those not connected, with why */
  problems: Array<{ id: string; name: string; state: ConnectionState; error?: string }>;
}

export function useLiveHealth(enabled: boolean, client: LiveSocketClient = liveSocketClient): LiveHealth {
  useEffect(() => {
    if (!enabled) return;
    // No tags: just the link, and the connection states the server sends over it
    return client.register([]);
  }, [enabled, client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);

  return useMemo(() => {
    const counts = { connected: 0, connecting: 0, disconnected: 0, error: 0 };
    const problems: LiveHealth["problems"] = [];
    for (const [id, c] of Object.entries(snapshot.connections)) {
      if (c.state === "disabled") continue;
      counts[c.state] += 1;
      if (c.state !== "connected") problems.push({ id, name: c.name, state: c.state, error: c.error });
    }
    problems.sort((a, b) => a.name.localeCompare(b.name));
    return { socket: snapshot.socket, counts, total: counts.connected + counts.connecting + counts.disconnected + counts.error, problems };
  }, [snapshot.socket, snapshot.connections]);
}
