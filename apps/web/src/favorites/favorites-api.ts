/** Favorite pages: each person's own shortcuts (a page plus the values it was opened with) */
import { API_BASE_URL } from "../config";
import { apiFetch, handleResponse } from "../api/client";

export interface Favorite {
  id: string;
  pageId: string;
  /** Values the page was opened with, read there as `{{ params.name }}` */
  params: Record<string, string>;
  /** The person's own name for it; null = the page's name */
  label: string | null;
}

/** Keep in step with MAX_FAVORITES on the server */
export const MAX_FAVORITES = 10;

const json = { "Content-Type": "application/json" };

export const favoritesApi = {
  list: async (): Promise<Favorite[]> => handleResponse<Favorite[]>(await apiFetch(`${API_BASE_URL}/favorites`)),

  add: async (data: { pageId: string; params: Record<string, string> }): Promise<Favorite> =>
    handleResponse<Favorite>(await apiFetch(`${API_BASE_URL}/favorites`, { method: "POST", headers: json, body: JSON.stringify(data) })),

  rename: async (id: string, label: string): Promise<Favorite> =>
    handleResponse<Favorite>(await apiFetch(`${API_BASE_URL}/favorites/${id}`, { method: "PUT", headers: json, body: JSON.stringify({ label }) })),

  remove: async (id: string): Promise<void> => {
    const res = await apiFetch(`${API_BASE_URL}/favorites/${id}`, { method: "DELETE" });
    if (!res.ok) await handleResponse(res);
  },
};

/** The same page with the same values */
export const sameFavorite = (a: { pageId: string; params: Record<string, string> }, b: { pageId: string; params: Record<string, string> }): boolean => {
  const keys = Object.keys(a.params);
  return a.pageId === b.pageId && keys.length === Object.keys(b.params).length && keys.every((key) => a.params[key] === b.params[key]);
};
