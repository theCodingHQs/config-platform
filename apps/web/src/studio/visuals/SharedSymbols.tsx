/**
 * Shared symbols in Studio → Visuals: cards in the list, and a read-only page for one, from which
 * sharing can be stopped.
 */
import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { sharedItemId, sharedRef, type Visual } from "@config-platform/schema";
import { SharedBadges, StopSharingButton } from "../../library/SharedControls";
import { useSharedChange, useSharedItems } from "../../library/use-shared";
import { visualKey } from "../../visuals/visuals-api";
import { SymbolCard } from "./BuiltinSymbols";
import { SymbolPreview, muted } from "./SymbolPreview";

const Problem = ({ text }: { text: string | null }) =>
  text ? <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{text}</p> : null;

export function SharedSymbolCards({ grid }: { grid: React.CSSProperties }) {
  const { data = [] } = useSharedItems("symbol");
  const change = useSharedChange();
  if (!data.length) {
    return (
      <p style={{ ...muted, margin: 0 }}>
        None yet. Open one of your symbols and choose Share to publish it for everyone in the workspace to place.
      </p>
    );
  }
  return (
    <>
      <Problem text={change.problem} />
      <ul style={grid}>
        {data.map((s) => (
          <li key={s.id} className="card" style={{ padding: "var(--space-3)" }}>
            <SymbolCard to={`/studio/visuals/${sharedRef(s.id)}`} thumbId={sharedRef(s.id)} name={s.name} description={s.description} badges={<SharedBadges item={s} />} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function SharedSymbolView({ visual }: { visual: Visual }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data = [] } = useSharedItems("symbol");
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
            A shared symbol, release {visual.version}. It can't be changed here; edit the symbol it was shared from and share it again to publish a new release. Place it
            from the Symbols palette, or make your own copy to change it.
          </>
        }
        actions={
          item && (
            <StopSharingButton
              item={item}
              change={change}
              onStopped={() => {
                queryClient.removeQueries({ queryKey: visualKey(visual.id) });
                navigate("/studio/visuals");
              }}
            />
          )
        }
      />
    </>
  );
}
