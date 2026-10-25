/**
 * A drawing's gradients and shared filters. Ids are prefixed per drawing on screen, so two visuals
 * on one page (or a symbol inside a drawing) never pick up each other's gradients.
 */
import React from "react";
import type { VisualPaint } from "@config-platform/schema";
import { safeColor } from "./coerce";

/** `url(#body)` → `url(#<prefix>-body)`; other colours unchanged */
export const paintRef = (value: unknown, prefix: string): string | undefined => {
  if (typeof value !== "string" || value === "") return undefined;
  const m = /^url\(#([a-zA-Z][a-zA-Z0-9_-]*)\)$/.exec(value);
  return m ? `url(#${prefix}-${m[1]})` : value;
};

export const shadowFilterId = (prefix: string) => `${prefix}--shadow`;

export function PaintDefs({ paints = [], prefix }: { paints?: readonly VisualPaint[]; prefix: string }) {
  return (
    <defs>
      <filter id={shadowFilterId(prefix)} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" style={{ floodColor: "var(--vis-shade)", floodOpacity: 0.2 }} />
      </filter>
      {paints.map((p) => {
        const stops = p.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={safeColor(s.color) ?? undefined} stopOpacity={s.opacity} />);
        const id = `${prefix}-${p.id}`;
        return p.type === "linear" ? (
          <linearGradient key={p.id} id={id} x1={p.x1 ?? 0} y1={p.y1 ?? 0} x2={p.x2 ?? 0} y2={p.y2 ?? 1}>
            {stops}
          </linearGradient>
        ) : (
          <radialGradient key={p.id} id={id} cx={p.cx ?? 0.5} cy={p.cy ?? 0.5} r={p.r ?? 0.5}>
            {stops}
          </radialGradient>
        );
      })}
    </defs>
  );
}
