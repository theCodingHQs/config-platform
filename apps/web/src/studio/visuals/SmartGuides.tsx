/** Draws the smart guides while a shape is moved or resized: alignment lines and size matches */
import React from "react";
import type { Guide, SizeMatch } from "./smart-guides";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A small × where a guide meets what it lines up with */
function Cross({ x, y, size }: { x: number; y: number; size: number }) {
  return <path className="vis-guide" d={`M${x - size} ${y - size}L${x + size} ${y + size}M${x - size} ${y + size}L${x + size} ${y - size}`} />;
}

export function SmartGuides({ guides, sizes, unit }: { guides: readonly Guide[]; sizes: readonly SizeMatch[]; unit: number }) {
  if (!guides.length && !sizes.length) return null;
  const tick = 4 * unit;
  return (
    <g className="vis-guides" aria-hidden="true">
      {guides.map((g, i) => {
        const [a, b] = g.axis === "x" ? [{ x: g.at, y: g.from }, { x: g.at, y: g.to }] : [{ x: g.from, y: g.at }, { x: g.to, y: g.at }];
        return (
          <g key={`g${i}`}>
            <line className="vis-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <Cross x={a.x} y={a.y} size={3 * unit} />
            <Cross x={b.x} y={b.y} size={3 * unit} />
          </g>
        );
      })}
      {/* The same width (or height): a measure under (or beside) each shape that has it */}
      {sizes.flatMap((s, i) =>
        s.boxes.map((b, j) => {
          const label = String(r1(s.size));
          if (s.axis === "x") {
            const y = b.y + b.height + 8 * unit;
            return (
              <g key={`s${i}-${j}`}>
                <line className="vis-guide" x1={b.x} y1={y} x2={b.x + b.width} y2={y} />
                <line className="vis-guide" x1={b.x} y1={y - tick} x2={b.x} y2={y + tick} />
                <line className="vis-guide" x1={b.x + b.width} y1={y - tick} x2={b.x + b.width} y2={y + tick} />
                <text className="vis-guide-label" x={b.x + b.width / 2} y={y + 14 * unit} fontSize={11 * unit} textAnchor="middle">{label}</text>
              </g>
            );
          }
          const x = b.x + b.width + 8 * unit;
          return (
            <g key={`s${i}-${j}`}>
              <line className="vis-guide" x1={x} y1={b.y} x2={x} y2={b.y + b.height} />
              <line className="vis-guide" x1={x - tick} y1={b.y} x2={x + tick} y2={b.y} />
              <line className="vis-guide" x1={x - tick} y1={b.y + b.height} x2={x + tick} y2={b.y + b.height} />
              <text className="vis-guide-label" x={x + 6 * unit} y={b.y + b.height / 2 + 4 * unit} fontSize={11 * unit}>{label}</text>
            </g>
          );
        }),
      )}
    </g>
  );
}
