import React from "react";
import type { LiveConnectionStatus } from "@config-platform/schema";

const LOOK: Record<LiveConnectionStatus["state"], { label: string; className: string }> = {
  connected: { label: "Connected", className: "badge badge-success" },
  connecting: { label: "Connecting…", className: "badge" },
  disconnected: { label: "Reconnecting", className: "badge badge-warning" },
  error: { label: "Not connected", className: "badge badge-danger" },
  disabled: { label: "Off", className: "badge" },
};

/** Connected / Reconnecting / Not connected / Off, with the reason on hover */
export function ConnectionStatusBadge({ status }: { status?: LiveConnectionStatus }) {
  const look = LOOK[status?.state ?? "connecting"];
  return (
    <span className={look.className} title={status?.error}>
      {look.label}
    </span>
  );
}
