/** Saved visuals (Studio → Visuals) */
import { isSharedRef, sharedItemId, type Visual, type VisualDefinition, type VisualInput, type VisualSummary } from "@config-platform/schema";
import { builtinSymbol, isBuiltinRef } from "@config-platform/schema/visual-library";
import { API_BASE_URL } from "../config";
import { ApiError, apiFetch, handleResponse } from "../api/client";
import { sharedApi } from "../library/shared-api";

const BASE = `${API_BASE_URL}/visuals`;
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const VISUALS_KEY = ["visuals"] as const;
export const visualKey = (id: string) => ["visuals", id] as const;

/** Built-in symbols come with the app; there's nothing to fetch */
async function getBuiltin(id: string): Promise<Visual> {
  const visual = builtinSymbol(id);
  if (!visual) throw new ApiError(404, "This built-in symbol isn't in this version of the app");
  return visual;
}

/** A shared symbol's latest release, as a (read-only) visual */
async function getShared(ref: string): Promise<Visual> {
  const item = await sharedApi.get(sharedItemId(ref));
  const definition = item.content as VisualDefinition;
  return { id: ref, name: item.name, kind: "symbol", definition, elementCount: definition.nodes.length, version: item.version, createdAt: item.publishedAt, updatedAt: item.publishedAt };
}

export const visualsApi = {
  list: async () => handleResponse<VisualSummary[]>(await apiFetch(BASE)),
  get: async (id: string) => {
    if (isBuiltinRef(id)) return getBuiltin(id);
    if (isSharedRef(id)) return getShared(id);
    return handleResponse<Visual>(await apiFetch(`${BASE}/${id}`));
  },
  create: async (input: VisualInput) => handleResponse<Visual>(await apiFetch(BASE, { method: "POST", ...json(input) })),
  update: async (id: string, input: Omit<VisualInput, "kind"> & { expectedVersion: number }) =>
    handleResponse<Visual>(await apiFetch(`${BASE}/${id}`, { method: "PUT", ...json(input) })),
  remove: async (id: string) => {
    const res = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
  /** A workspace symbol of one's own, starting as a copy of a built-in (or any) symbol */
  copySymbol: async (source: Visual, name = `${source.name} (my copy)`) => visualsApi.create({ name, kind: "symbol", definition: source.definition }),
};
