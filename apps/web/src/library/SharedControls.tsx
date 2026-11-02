/** Small pieces shown with any shared item: its release, and stopping sharing */
import React from "react";
import { Undo2 } from "lucide-react";
import type { SharedItemSummary } from "@config-platform/schema";
import type { SharedChange } from "./use-shared";

/** A small label: "v3", "Built-in" */
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

/** Which release it is */
export const SharedBadges = ({ item }: { item: SharedItemSummary }) => <Badge>v{item.version}</Badge>;

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
