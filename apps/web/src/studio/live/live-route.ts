/**
 * Studio → Live's screens each have their own address, so the browser's Back goes to the screen
 * before (a connection back to the list) rather than out of Live:
 *   /studio/live                         connections
 *   /studio/live/connections/new         choosing a kind (?kind=mqtt: the new connection's form)
 *   /studio/live/connections/<id>        one connection
 *   /studio/live/rules, …/rules/new, …/rules/<id>
 *   /studio/live/agents
 */
import { useCallback } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { LiveConnectionKind } from "@config-platform/schema";

export type LiveTab = "connections" | "rules" | "agents";

export type LiveView =
  | { tab: "connections"; screen: "list" }
  | { tab: "connections"; screen: "pick" }
  | { tab: "connections"; screen: "new"; kind: LiveConnectionKind }
  | { tab: "connections"; screen: "edit"; id: string }
  | { tab: "rules"; screen: "list" }
  | { tab: "rules"; screen: "new" }
  | { tab: "rules"; screen: "edit"; id: string }
  | { tab: "agents"; screen: "list" };

const BASE = "/studio/live";

export const livePath = {
  tab: (tab: LiveTab) => (tab === "connections" ? BASE : `${BASE}/${tab}`),
  newConnection: (kind?: LiveConnectionKind) => `${BASE}/connections/new${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`,
  connection: (id: string) => `${BASE}/connections/${encodeURIComponent(id)}`,
  newRule: () => `${BASE}/rules/new`,
  rule: (id: string) => `${BASE}/rules/${encodeURIComponent(id)}`,
};

export function parseLivePath(rest: string, kind: string | null): LiveView {
  const [section, id] = rest.split("/").filter(Boolean);
  if (section === "rules") {
    if (!id) return { tab: "rules", screen: "list" };
    return id === "new" ? { tab: "rules", screen: "new" } : { tab: "rules", screen: "edit", id: decodeURIComponent(id) };
  }
  if (section === "agents") return { tab: "agents", screen: "list" };
  if (section === "connections" && id) {
    if (id !== "new") return { tab: "connections", screen: "edit", id: decodeURIComponent(id) };
    return kind ? { tab: "connections", screen: "new", kind: kind as LiveConnectionKind } : { tab: "connections", screen: "pick" };
  }
  return { tab: "connections", screen: "list" };
}

/** The screen the address shows, and going to another (`replace`: instead of adding a step to Back) */
export function useLiveRoute() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const view = parseLivePath(params["*"] ?? "", search.get("kind"));
  const go = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      if (path !== location.pathname + location.search) navigate(path, options);
    },
    [navigate, location.pathname, location.search],
  );
  return { view, go };
}
