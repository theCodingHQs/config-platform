/** The sidebar's Favorites section: the person's starred pages, each opening with the values it was saved with */
import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Star, X } from "lucide-react";
import { type Favorite } from "./favorites-api";
import { useFavorites } from "./use-favorites";

export interface FavoritePageInfo {
  route: string;
  name: string;
  icon: React.ReactNode;
}

const search = (params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : "";
};

/** "Machine Detail · M12": the page's name, then the values it was saved with */
const defaultLabel = (favorite: Favorite, name: string) => {
  const values = Object.values(favorite.params).filter(Boolean);
  return values.length ? `${name} · ${values.join(", ")}` : name;
};

function FavoriteItem({ favorite, info, onNavigate }: { favorite: Favorite; info: FavoritePageInfo; onNavigate: () => void }) {
  const location = useLocation();
  const { remove, rename } = useFavorites();
  const [editing, setEditing] = useState(false);
  const title = favorite.label ?? defaultLabel(favorite, info.name);
  const active = location.pathname === info.route && location.search === search(favorite.params);

  if (editing) {
    return (
      <input
        className="app-sidebar-favorite-edit"
        aria-label="Favorite name"
        autoFocus
        defaultValue={title}
        maxLength={128}
        onBlur={(e) => {
          setEditing(false);
          const next = e.target.value.trim();
          if (next !== title) rename.mutate({ id: favorite.id, label: next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = title;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <div className="app-sidebar-favorite">
      <NavLink
        to={`${info.route}${search(favorite.params)}`}
        title={`${title} (double-click to rename)`}
        // A favorite is the page with its values, so it is only current when both match
        className={() => `app-sidebar-item ${active ? "active" : ""}`}
        onClick={onNavigate}
        onDoubleClick={(e) => {
          e.preventDefault();
          setEditing(true);
        }}
      >
        <span className="app-sidebar-icon">{info.icon}</span>
        <span className="app-sidebar-item-title">{title}</span>
      </NavLink>
      <button
        type="button"
        className="app-sidebar-favorite-remove"
        aria-label={`Remove ${title} from favorites`}
        title="Remove from favorites"
        onClick={() => remove.mutate(favorite.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function SidebarFavorites({ resolve, onNavigate }: { resolve: (pageId: string) => FavoritePageInfo | undefined; onNavigate: () => void }) {
  const { favorites } = useFavorites();
  // A favorite whose page was unpublished or is no longer open to this person is left out
  const shown = favorites.flatMap((favorite) => {
    const info = resolve(favorite.pageId);
    return info ? [{ favorite, info }] : [];
  });
  if (!shown.length) return null;
  return (
    <section className="app-sidebar-favorites" aria-label="Favorites">
      <div className="app-sidebar-favorites-title">
        <Star size={12} aria-hidden="true" />
        <span className="app-sidebar-item-title">Favorites</span>
      </div>
      {shown.map(({ favorite, info }) => (
        <FavoriteItem key={favorite.id} favorite={favorite} info={info} onNavigate={onNavigate} />
      ))}
    </section>
  );
}
