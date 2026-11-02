/** The workspace's shared library: items it published for its people to reuse (see @config-platform/schema shared-library) */
import type { InstallPlan, InstallResult, InstallSolutionInput, PublishInput, SharedItem, SharedItemSummary, SharedKind, UseTemplateInput, UsedTemplate } from "@config-platform/schema";
import { API_BASE_URL } from "../config";
import { apiFetch, handleResponse } from "../api/client";

const BASE = `${API_BASE_URL}/shared`;
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const SHARED_KEY = ["shared"] as const;
export const sharedListKey = (kind: SharedKind) => ["shared", "list", kind] as const;

export const sharedApi = {
  list: async (kind: SharedKind) => handleResponse<SharedItemSummary[]>(await apiFetch(`${BASE}?kind=${kind}`)),
  get: async (id: string) => handleResponse<SharedItem>(await apiFetch(`${BASE}/${id}`)),
  publish: async (input: PublishInput) => handleResponse<SharedItem>(await apiFetch(BASE, { method: "POST", ...json(input) })),
  /** A page or export template's layout, pointed at this workspace's entities */
  use: async (id: string, input: UseTemplateInput) => handleResponse<UsedTemplate>(await apiFetch(`${BASE}/${id}/use`, { method: "POST", ...json(input) })),
  /** What installing a solution would do, then installing it with the person's choices for clashing entities */
  installPlan: async (id: string) => handleResponse<InstallPlan>(await apiFetch(`${BASE}/${id}/install-plan`)),
  install: async (id: string, input: InstallSolutionInput) => handleResponse<InstallResult>(await apiFetch(`${BASE}/${id}/install`, { method: "POST", ...json(input) })),
  unpublish: async (id: string) => {
    const res = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};
