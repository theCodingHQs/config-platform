import React, { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SHAPES, SHAPE_CATEGORIES, type ShapeDef } from "../../visuals/shapes";
import { isoFrame } from "../../visuals/shapes/iso-draw";
import { defaultProps } from "../../visuals/resolve-props";
import "../../visuals/visuals.css";

export const SHAPE_DRAG_TYPE = "application/x-visual-shape";

/** A shape drawn small with its default settings, standing still */
function ShapeThumb({ shape }: { shape: ShapeDef }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const props = useMemo(() => {
    const p = defaultProps(shape);
    // Keep thumbnails compact: long shapes shown short
    for (const key of ["length", "width"]) if (typeof p[key] === "number") p[key] = Math.min(Number(p[key]), 2.5);
    return p;
  }, [shape]);
  const ref = useRef<SVGGElement>(null);
  const [viewBox, setViewBox] = useState("-90 -110 180 150");
  useLayoutEffect(() => {
    const b = ref.current?.getBBox?.();
    if (b && b.width > 0) setViewBox(`${b.x - 6} ${b.y - 6} ${b.width + 12} ${b.height + 12}`);
  }, [shape]);
  return (
    <svg viewBox={viewBox} className="vis-scene vis-paused" aria-hidden="true" style={{ width: "100%", height: "3.25rem" }}>
      <g ref={ref}>
        <shape.Render p={props} g={isoFrame(false)} uid={`thumb-${uid}`} />
      </g>
    </svg>
  );
}

/** The shapes to add: click one to drop it in the middle, or drag it onto the drawing */
export function ShapePalette({ onAdd }: { onAdd: (shape: ShapeDef) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }} aria-label="Shapes">
      {SHAPE_CATEGORIES.map((category) => {
        const shapes = SHAPES.filter((s) => s.category === category);
        if (!shapes.length) return null;
        return (
          <section key={category}>
            <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "var(--space-1)" }}>
              {category}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-1)" }}>
              {shapes.map((shape) => (
                <button
                  key={shape.type}
                  type="button"
                  className="btn btn-ghost"
                  title={shape.description}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SHAPE_DRAG_TYPE, shape.type);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onAdd(shape)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "var(--space-1)",
                    padding: "var(--space-1)",
                    height: "auto",
                    border: "var(--border-width-sm) solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    background: "var(--vis-floor)",
                  }}
                >
                  <ShapeThumb shape={shape} />
                  <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--text)", textAlign: "center" }}>{shape.label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
