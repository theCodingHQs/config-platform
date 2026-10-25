import React from "react";

/** Approximate text width (the drawing has no layout pass): good enough for a plate behind it */
export const textWidth = (text: string, size: number) => text.length * size * 0.58;

/** A small name plate floating above a shape; (x, y) is its bottom centre */
export function FloatingLabel({ x, y, text, size = 11 }: { x: number; y: number; text: string; size?: number }) {
  const w = textWidth(text, size) + 12;
  const h = size + 8;
  return (
    <g pointerEvents="none">
      <rect className="vis-plate" x={x - w / 2} y={y - h} width={w} height={h} rx={4} />
      <text className="vis-text-strong" x={x} y={y - h / 2} textAnchor="middle" dominantBaseline="central" fontSize={size}>
        {text}
      </text>
    </g>
  );
}
