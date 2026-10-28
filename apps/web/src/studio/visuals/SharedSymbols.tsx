/**
 * Shared symbols in Studio → Visuals: cards in the list, and a read-only page for one. The
 * workspace that shared a symbol can stop sharing it; platform owners also see every workspace's
 * shared symbols and choose which every workspace gets.
 */
import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { sharedItemId, sharedRef, type Visual } from "@config-platform/schema";
import { usable } from "../../library/shared-api";
import { EverywhereButton, SharedBadges, StopSharingButton } from "../../library/SharedControls";
import { useSharedChange, useSharedItems } from "../../library/use-shared";
import { visualKey } from "../../visuals/visuals-api";
import { SymbolCard } from "./BuiltinSymbols";
import { SymbolPreview, muted } from "./SymbolPreview";

const Problem = ({ text }: { text: string | null }) =>
  text ? <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{text}</p> : null;

export function SharedSymbolCards({ grid }: { grid: React.CSSProperties }) {
  const { data = [], everyWorkspace } = useSharedItems("symbol");
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
      <Problem text={change.problem} />
      <ul style={grid}>
        {data.map((s) => (
          <li key={s.id} className="card" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {/* Another workspace's item that isn't shared everywhere can't be opened here; a platform owner can still share it */}
            <SymbolCard to={usable(s) ? `/studio/visuals/${sharedRef(s.id)}` : undefined} thumbId={usable(s) ? sharedRef(s.id) : undefined} name={s.name} description={s.description} badges={<SharedBadges item={s} />} />
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
  const { data = [], everyWorkspace } = useSharedItems("symbol");
  const change = useSharedChange();
  const item = data.find((s) => s.id === sharedItemId(visual.id));
  return (
    <>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <Problem text={change.problem} />
      </div>
      <SymbolPreview
        visual={visual}
        badges={item && <SharedBadges item={item} />}
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
                <StopSharingButton
                  item={item}
                  change={change}
                  onStopped={() => {
                    queryClient.removeQueries({ queryKey: visualKey(visual.id) });
                    navigate("/studio/visuals");
                  }}
                />
              )}
            </>
          )
        }
      />
    </>
  );
}
