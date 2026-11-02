/** In the status bar: a star that adds the page being viewed (with its values) to the person's favorites, or removes it */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useInRouterContext, useLocation } from "react-router-dom";
import { Star } from "lucide-react";
import { useOptionalAuth } from "../context/auth-context";
import { fetchPublishedPages } from "../api/client";
import { sameFavorite } from "./favorites-api";
import { useFavorites } from "./use-favorites";

function StarButton() {
  const user = useOptionalAuth();
  const location = useLocation();
  const { favorites, add, remove } = useFavorites();
  // Shares the app's own list of published pages, so this costs no extra request
  const { data: pages = [] } = useQuery({
    queryKey: ["published-pages", user?.tenantId],
    queryFn: () => fetchPublishedPages(user?.tenantId),
    enabled: Boolean(user),
  });

  const page = pages.find((candidate) => candidate.route === location.pathname);
  if (!page) return null;

  const current = { pageId: page.id as string, params: Object.fromEntries(new URLSearchParams(location.search)) };
  const saved = favorites.find((favorite) => sameFavorite(favorite, current));
  const label = saved ? "Remove from favorites" : "Add to favorites";

  return (
    <button
      type="button"
      className={`app-status-indicator app-favorite-toggle${saved ? " is-saved" : ""}`}
      aria-label={label}
      aria-pressed={Boolean(saved)}
      title={label}
      disabled={add.isPending || remove.isPending}
      onClick={() => (saved ? remove.mutate(saved.id) : add.mutate(current))}
    >
      <Star size="1.15em" aria-hidden="true" />
    </button>
  );
}

export function FavoriteToggle() {
  // The star needs to know which page is open, so it only shows inside the app's router
  return useInRouterContext() ? <StarButton /> : null;
}
