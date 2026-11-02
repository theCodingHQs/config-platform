/** The signed-in person's favorites, kept in step with the server */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalAuth } from "../context/auth-context";
import { useStatusNotify } from "../context/app-bar-context";
import { favoritesApi, type Favorite } from "./favorites-api";

export function useFavorites() {
  const user = useOptionalAuth();
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const key = ["favorites", user?.tenantId];
  const { data: favorites = [] } = useQuery({ queryKey: key, queryFn: favoritesApi.list, enabled: Boolean(user) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onError = (err: Error) => notify("error", err.message);

  const add = useMutation({ mutationFn: favoritesApi.add, onSuccess: () => { refresh(); notify("success", "Added to favorites"); }, onError });
  const remove = useMutation({ mutationFn: favoritesApi.remove, onSuccess: refresh, onError });
  const rename = useMutation({ mutationFn: ({ id, label }: { id: string; label: string }) => favoritesApi.rename(id, label), onSuccess: refresh, onError });

  return { favorites: favorites as Favorite[], add, remove, rename };
}
