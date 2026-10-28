/**
 * Shared symbols in Studio → Visuals: cards in the list, and a read-only page for one. The
 * workspace that shared a symbol can stop sharing it; platform owners also see every workspace's
 * shared symbols and choose which every workspace gets.
 */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Globe, Undo2 } from "lucide-react";
import { sharedItemId, sharedRef, type SharedItemSummary, type Visual } from "@config-platform/schema";
import { useAuth } from "../../context/auth-context";
import { SHARED_KEY, sharedApi, sharedListKey, usable } from "../../library/shared-api";
import { visualKey } from "../../visuals/visuals-api";
import { SymbolCard } from "./BuiltinSymbols";
import { Badge, SymbolPreview, muted } from "./SymbolPreview";

/** The shared symbols to show: platform owners see every workspace's */
export function useSharedSymbols() {
  const everyWorkspace = Boolean(useAuth().user?.isPlatformAdmin);
  const query = useQuery({ queryKey: sharedListKey("symbol", everyWorkspace), queryFn: () => sharedApi.list("symbol", everyWorkspace) });
  return { ...query, everyWorkspace };
}

export const whereShared = (s: SharedItemSummary) => (s.everywhere ? "Every workspace" : s.own ? "This workspace" : `Only in ${s.workspace}`);

function badges(s: SharedItemSummary) {
  return (
    <>
      <Badge tone={s.everywhere ? "accent" : "muted"}>{whereShared(s)}</Badge>
      <Badge>v{s.version}</Badge>
      {!s.own && s.everywhere && <Badge>From {s.workspace}</Badge>}
    </>
  );
}

function useSharedChange() {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const onSettled = () => queryClient.invalidateQueries({ queryKey: SHARED_KEY });
  const everywhere = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => sharedApi.setEverywhere(id, on),
    onMutate: () => setProblem(null),
    onError: (err: Error) => setProblem(err.message),
    onSettled,
  });
  const unpublish = useMutation({
    mutationFn: (id: string) => sharedApi.unpublish(id),
    onMutate: () => setProblem(null),
    onError: (err: Error) => setProblem(err.message),
    onSettled,
  });
  return { everywhere, unpublish, problem };
}

function EverywhereButton({ item, change }: { item: SharedItemSummary; change: ReturnType<typeof useSharedChange> }) {
  return (
    <button type="button" className="btn btn-secondary" disabled={change.everywhere.isPending} onClick={() => change.everywhere.mutate({ id: item.id, on: !item.everywhere })}>
      <Globe size="1em" /> {item.everywhere ? "Stop sharing with every workspace" : "Share with every workspace"}
    </button>
  );
}

export function SharedSymbolCards({ grid }: { grid: React.CSSProperties }) {
  const { data = [], everyWorkspace } = useSharedSymbols();
  const change = useSharedChange();
  if (!data.length) {
    return (
      <p style={{ ...muted, margin: 0 }}>
        None yet. Open one of your symbols and choose Share to publish it for everyone in the workspace to place{everyWorkspace ? "; you can then share it with every workspace" : ""}.
      </p>
    );
  }
  return (
    <>
      {change.problem && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{change.problem}</p>}
      <ul style={grid}>
        {data.map((s) => (
          <li key={s.id} className="card" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {/* Another workspace's item that isn't shared everywhere can't be opened here; a platform owner can still share it */}
            <SymbolCard to={usable(s) ? `/studio/visuals/${sharedRef(s.id)}` : undefined} thumbId={usable(s) ? sharedRef(s.id) : undefined} name={s.name} description={s.description} badges={badges(s)} />
            {!usable(s) && everyWorkspace && <EverywhereButton item={s} change={change} />}
          </li>
        ))}
      </ul>
    </>
  );
}

export function SharedSymbolView({ visual }: { visual: Visual }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data = [], everyWorkspace } = useSharedSymbols();
  const change = useSharedChange();
  const item = data.find((s) => s.id === sharedItemId(visual.id));
  const unpublish = () => {
    if (!item || !window.confirm(`Stop sharing "${item.name}"? Your own symbol stays as it is.`)) return;
    change.unpublish.mutate(item.id, {
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: visualKey(visual.id) });
        navigate("/studio/visuals");
      },
    });
  };
  return (
    <>
      {change.problem && <p role="alert" style={{ margin: "0 0 var(--space-3)", color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{change.problem}</p>}
      <SymbolPreview
        visual={visual}
        badges={item && badges(item)}
        about={
          <>
            {item?.description ? `${item.description}. ` : ""}
            A shared symbol, release {visual.version}. It can't be changed here
            {item?.own ? "; edit your own symbol and share it again to publish a new release" : ""}. Place it from the Symbols palette, or make your own copy to change it.
          </>
        }
        actions={
          item && (
            <>
              {everyWorkspace && <EverywhereButton item={item} change={change} />}
              {item.own && (
                <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)" }} disabled={change.unpublish.isPending} onClick={unpublish}>
                  <Undo2 size="1em" /> Stop sharing
                </button>
              )}
            </>
          )
        }
      />
    </>
  );
}
