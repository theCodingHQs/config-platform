import type React from "react";
import { DEFAULT_CONTENT_GAP, type ContentLayoutProps } from "@config-platform/schema";

const toCss = (value: number | string) => (typeof value === "number" ? `${value}px` : value);

/**
 * Flex layout for a container's children (card body, modal body). Mirrors the stack:
 * vertical by default with DEFAULT_CONTENT_GAP between children.
 *
 * The class keeps vertically stacked children at their natural height (see
 * `.content-layout-vertical` in index.css), so a height-limited, scrolling container such
 * as a modal body scrolls instead of squashing its content.
 */
export function contentLayout({
  direction = "vertical",
  gap = DEFAULT_CONTENT_GAP,
  align,
  justify,
  wrap = false,
}: ContentLayoutProps): { className: string; style: React.CSSProperties } {
  return {
    className: direction === "horizontal" ? "content-layout-horizontal" : "content-layout-vertical",
    style: {
      display: "flex",
      flexDirection: direction === "horizontal" ? "row" : "column",
      flexWrap: wrap ? "wrap" : "nowrap",
      gap: toCss(gap),
      alignItems: align,
      justifyContent: justify,
    },
  };
}
