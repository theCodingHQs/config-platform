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
  padding,
  background,
  border,
  borderRadius,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
  children,
}) => {
  const gapValue = typeof gap === "number" ? `${gap}px` : gap;
  const paddingValue =
    typeof padding === "number" ? `${padding}px` : padding;
  const radiusValue =
    typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius;
  const widthValue =
    width !== undefined
      ? (typeof width === "number" ? `${width}px` : width)
      : (flex !== undefined ? undefined : "100%");
  const minWidthValue =
    typeof minWidth === "number" ? `${minWidth}px` : minWidth;
  const maxWidthValue =
    typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;

  return (
    <div
      className="layout-stack"
      data-testid="layout-stack"
      data-direction={direction}
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: gapValue,
        alignItems: align,
        justifyContent: justify,
        padding: paddingValue,
        backgroundColor:
          background && background !== "transparent"
            ? `var(--${background})`
            : undefined,
        border: border ? "1px solid var(--border)" : undefined,
        borderRadius: radiusValue,
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidthValue,
        maxWidth: maxWidthValue,
        alignSelf,
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};
