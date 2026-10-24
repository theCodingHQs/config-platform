/** Live connection settings (Studio → Live) and the socket's address. */
import type { LiveConnection, LiveRule, LiveRuleRun, TagValueType } from "@config-platform/schema";
import { API_BASE_URL } from "../config";
import { apiFetch, handleResponse } from "../api/client";

export interface LiveTagInfo {
  tag: string;
  type: TagValueType;
  unit?: string;
  label?: string;
  connectionId: string;
  connectionName: string;
}

export interface LoggedLiveMessage {
  at: string;
  topic?: string;
  raw: string;
  message?: unknown;
  decodeError?: string;
  ruleErrors?: Array<{ tag: string; error: string }>;
}

const BASE = `${API_BASE_URL}/live`;
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const liveApi = {
  connections: async () => handleResponse<LiveConnection[]>(await apiFetch(`${BASE}/connections`)),
  tags: async () => handleResponse<LiveTagInfo[]>(await apiFetch(`${BASE}/tags`)),
  messages: async (id: string) => handleResponse<LoggedLiveMessage[]>(await apiFetch(`${BASE}/connections/${id}/messages`)),
  create: async (input: unknown) => handleResponse<LiveConnection>(await apiFetch(`${BASE}/connections`, { method: "POST", ...json(input) })),
  update: async (id: string, input: unknown) =>
    handleResponse<LiveConnection>(await apiFetch(`${BASE}/connections/${id}`, { method: "PUT", ...json(input) })),
  remove: async (id: string) => {
    const res = await apiFetch(`${BASE}/connections/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};

export const liveRulesApi = {
  list: async () => handleResponse<LiveRule[]>(await apiFetch(`${BASE}/rules`)),
  runs: async (id: string) => handleResponse<LiveRuleRun[]>(await apiFetch(`${BASE}/rules/${id}/runs`)),
  create: async (input: unknown) => handleResponse<LiveRule>(await apiFetch(`${BASE}/rules`, { method: "POST", ...json(input) })),
  update: async (id: string, input: unknown) => handleResponse<LiveRule>(await apiFetch(`${BASE}/rules/${id}`, { method: "PUT", ...json(input) })),
  remove: async (id: string) => {
    const res = await apiFetch(`${BASE}/rules/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};

/** ws(s)://…/api/live/socket, on the API's host (the page's own host when the API is on it) */
export function liveSocketUrl(location: Pick<Location, "protocol" | "host"> = window.location): string {
  const base = /^https?:\/\//i.test(API_BASE_URL) ? new URL(API_BASE_URL) : null;
  const secure = (base?.protocol ?? location.protocol) === "https:";
  const host = base?.host ?? location.host;
  const path = base ? base.pathname.replace(/\/$/, "") : API_BASE_URL;
  return `${secure ? "wss" : "ws"}://${host}${path}/live/socket`;
}
