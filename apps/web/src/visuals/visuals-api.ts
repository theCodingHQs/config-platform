/** Saved visuals (Studio → Visuals) */
import type { Visual, VisualInput, VisualSummary } from "@config-platform/schema";
import { API_BASE_URL } from "../config";
import { apiFetch, handleResponse } from "../api/client";

const BASE = `${API_BASE_URL}/visuals`;
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const VISUALS_KEY = ["visuals"] as const;
export const visualKey = (id: string) => ["visuals", id] as const;

export const visualsApi = {
  list: async () => handleResponse<VisualSummary[]>(await apiFetch(BASE)),
  get: async (id: string) => handleResponse<Visual>(await apiFetch(`${BASE}/${id}`)),
  create: async (input: VisualInput) => handleResponse<Visual>(await apiFetch(BASE, { method: "POST", ...json(input) })),
  update: async (id: string, input: Omit<VisualInput, "kind"> & { expectedVersion: number }) =>
    handleResponse<Visual>(await apiFetch(`${BASE}/${id}`, { method: "PUT", ...json(input) })),
  remove: async (id: string) => {
    const res = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};
