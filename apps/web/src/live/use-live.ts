/**
 * React access to live data. Pages don't call these directly: the page runtime finds the tags a
 * page uses ({{ live.line1.speed }}) and puts them in its expression scope as `live` (values)
 * and `liveInfo` (quality, time, connection states).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { liveTagRefs, nestTagValues, type TagValue } from "@config-platform/schema";
import { liveSocketClient, type LiveSnapshot, type LiveSocketClient } from "./live-socket-client";

/** Live values of `tags` (names or groups); nothing is opened when the list is empty */
export function useLiveSnapshot(tags: string[], client: LiveSocketClient = liveSocketClient): LiveSnapshot {
  const key = [...tags].sort().join("|");
  useEffect(() => {
    if (!key) return;
    return client.register(key.split("|"));
  }, [key, client]);
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}

export interface LiveScope {
  /** {{ live.line1.speed }} */
  live: Record<string, any>;
  /** {{ liveInfo.tags["line1.speed"].quality }}, {{ liveInfo.connected }} */
  liveInfo: {
    connected: boolean;
    tags: Record<string, TagValue>;
    connections: LiveSnapshot["connections"];
  };
}

const EMPTY_SCOPE: LiveScope = { live: {}, liveInfo: { connected: false, tags: {}, connections: {} } };

/** The `live` part of a page's expression scope, for the tags its definition mentions */
export function useLiveScope(definition: unknown, client?: LiveSocketClient): LiveScope {
  const refs = useMemo(() => (definition ? liveTagRefs(JSON.stringify(definition)) : []), [definition]);
  const snapshot = useLiveSnapshot(refs, client);
  return useMemo(() => {
    if (refs.length === 0) return EMPTY_SCOPE;
    return {
      live: nestTagValues(snapshot.values),
      liveInfo: { connected: snapshot.socket === "open", tags: snapshot.values, connections: snapshot.connections },
    };
  }, [refs.length, snapshot]);
}
