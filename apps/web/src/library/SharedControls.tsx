/** Small pieces shown with any shared item: where it's shared, its release, and the owners' buttons */
import React from "react";
import { Globe, Undo2 } from "lucide-react";
import type { SharedItemSummary } from "@config-platform/schema";
import type { SharedChange } from "./use-shared";

export const whereShared = (s: SharedItemSummary) => (s.everywhere ? "Every workspace" : s.own ? "This workspace" : `Only in ${s.workspace}`);

/** A small label: "v3", "Every workspace" */
export const Badge = ({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" }) => (
  <span
    style={{
      fontSize: "var(--font-size-xs)",
      fontWeight: 600,
      padding: "0 var(--space-2)",
      borderRadius: "var(--radius-pill)",
      border: "var(--border-width-sm) solid var(--border)",
      color: tone === "accent" ? "var(--accent)" : "var(--text-muted)",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

export function SharedBadges({ item }: { item: SharedItemSummary }) {
  return (
    <>
      <Badge tone={item.everywhere ? "accent" : "muted"}>{whereShared(item)}</Badge>
      <Badge>v{item.version}</Badge>
      {!item.own && item.everywhere && <Badge>From {item.workspace}</Badge>}
    </>
  );
}

export function EverywhereButton({ item, change, small }: { item: SharedItemSummary; change: SharedChange; small?: boolean }) {
  return (
    <button type="button" className={small ? "btn btn-ghost btn-sm" : "btn btn-secondary"} disabled={change.everywhere.isPending} onClick={() => change.everywhere.mutate({ id: item.id, on: !item.everywhere })}>
      <Globe size="1em" /> {item.everywhere ? "Stop sharing with every workspace" : "Share with every workspace"}
    </button>
  );
}

export function StopSharingButton({ item, change, small, onStopped }: { item: SharedItemSummary; change: SharedChange; small?: boolean; onStopped?: () => void }) {
  return (
    <button
      type="button"
      className={small ? "btn btn-ghost btn-sm" : "btn btn-ghost"}
      style={{ color: "var(--danger)" }}
      disabled={change.unpublish.isPending}
      onClick={() => {
        if (window.confirm(`Stop sharing "${item.name}"? What it was shared from stays as it is.`)) change.unpublish.mutate(item.id, { onSuccess: onStopped });
      }}
    >
      <Undo2 size="1em" /> Stop sharing
    </button>
  );
}
