import React from "react";
import type { StackProps } from "@config-platform/schema";

export interface StackComponentProps extends StackProps {
  children?: React.ReactNode;
}

export const StackComponent: React.FC<StackComponentProps> = ({
  direction = "vertical",
  gap = 16,
  align,
  justify,
  wrap = false,
  children,
}) => {
  const gapValue = typeof gap === "number" ? `${gap}px` : gap;

  return (
    <div
      className="layout-stack"
      data-testid="layout-stack"
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: gapValue,
        alignItems: align,
        justifyContent: justify,
        width: "100%",
      }}
    >
      {children}
    </div>
  );
};
