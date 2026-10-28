/** The shared library: items workspaces published for reuse (see @config-platform/schema shared-library) */
import type { PublishInput, SharedItem, SharedItemSummary, SharedKind } from "@config-platform/schema";
import { API_BASE_URL } from "../config";
import { apiFetch, handleResponse } from "../api/client";

const BASE = `${API_BASE_URL}/shared`;
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const SHARED_KEY = ["shared"] as const;
export const sharedListKey = (kind: SharedKind, everyWorkspace = false) => ["shared", "list", kind, everyWorkspace] as const;

export const sharedApi = {
  /** `everyWorkspace`: platform owners also see items not yet shared with every workspace */
  list: async (kind: SharedKind, everyWorkspace = false) => handleResponse<SharedItemSummary[]>(await apiFetch(`${BASE}?kind=${kind}${everyWorkspace ? "&all=true" : ""}`)),
  get: async (id: string) => handleResponse<SharedItem>(await apiFetch(`${BASE}/${id}`)),
  publish: async (input: PublishInput) => handleResponse<SharedItem>(await apiFetch(BASE, { method: "POST", ...json(input) })),
  setEverywhere: async (id: string, everywhere: boolean) => handleResponse<{ id: string; everywhere: boolean }>(await apiFetch(`${BASE}/${id}/everywhere`, { method: "PUT", ...json({ everywhere }) })),
  unpublish: async (id: string) => {
    const res = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};

/** Usable here: published by this workspace, or shared with every workspace */
export const usable = (s: SharedItemSummary) => s.own || s.everywhere;
