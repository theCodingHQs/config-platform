/**
 * Draws a visual: the floor grid, then each element in depth order (further back first). Used by
 * pages (read only) and by the editor, which adds selection and dragging through `renderOverlay`
 * and `elementProps`.
 */
import React, { useId, useMemo } from "react";
import { ISO, isoPoint, screenToIso, type ExpressionScope, type VisualDefinition, type VisualElement } from "@config-platform/schema";
import { shapeOf } from "./shapes";
import { isoFrame } from "./shapes/iso-draw";
import { resolveElement, type ResolvedElement } from "./resolve-props";
import "./visuals.css";

export interface VisualSceneProps {
  definition: VisualDefinition;
  /** null: show the set values only (bindings not worked out) */
  scope: ExpressionScope | null;
  className?: string;
  style?: React.CSSProperties;
  svgRef?: React.Ref<SVGSVGElement>;
  /** Extra attributes for each element's group (the editor's pointer handlers) */
  elementProps?: (el: VisualElement) => React.SVGProps<SVGGElement>;
  /** Drawn above everything, in drawing coordinates */
  renderOverlay?: (resolved: Map<string, ResolvedElement>) => React.ReactNode;
  ariaLabel?: string;
}

/** Order elements are drawn in: by layer, then from the back of the floor to the front */
export function drawOrder(elements: VisualElement[]): VisualElement[] {
  const depth = (el: VisualElement) => {
    const shape = shapeOf(el.type);
    const { u, v } = screenToIso(el.x, el.y);
    const fp = shape ? shape.footprint(Object.fromEntries(shape.props.map((p) => [p.name, el.props[p.name] ?? p.default])) as any) : { a: 1, b: 1 };
    const [du, dv] = el.flip ? [fp.b, fp.a] : [fp.a, fp.b];
    return u + v + ((du + dv) / 2) * el.scale;
  };
  const layerOf = (el: VisualElement) => el.layer ?? shapeOf(el.type)?.layer ?? 0;
  return [...elements].sort((x, y) => layerOf(x) - layerOf(y) || depth(x) - depth(y));
}

function FloorGrid({ width, height }: { width: number; height: number }) {
  // Lines along u and v through every tile, covering the whole canvas
  const lines: React.ReactNode[] = [];
  const span = Math.ceil((width / ISO.tileW + height / ISO.tileH) * 1.2) + 2;
  for (let i = -span; i <= span; i++) {
    const a = isoPoint(i, -span);
    const b = isoPoint(i, span);
    const c = isoPoint(-span, i);
    const d = isoPoint(span, i);
    lines.push(<line key={`u${i}`} className="vis-grid-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />, <line key={`v${i}`} className="vis-grid-line" x1={c.x} y1={c.y} x2={d.x} y2={d.y} />);
  }
  return <g>{lines}</g>;
}

export function VisualScene({ definition, scope, className, style, svgRef, elementProps, renderOverlay, ariaLabel }: VisualSceneProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ordered = useMemo(() => drawOrder(definition.elements), [definition.elements]);
  const resolved = useMemo(() => {
    const map = new Map<string, ResolvedElement>();
    for (const el of definition.elements) {
      const shape = shapeOf(el.type);
      if (shape) map.set(el.id, resolveElement(shape, el, scope));
    }
    return map;
  }, [definition.elements, scope]);

  return (
    <svg
      ref={svgRef}
      className={`vis-scene${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${definition.width} ${definition.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      style={style}
    >
      <rect x={0} y={0} width={definition.width} height={definition.height} style={{ fill: "var(--vis-floor)" }} />
      {definition.grid === "isometric" && (
        <svg x={0} y={0} width={definition.width} height={definition.height} overflow="hidden">
          <FloorGrid width={definition.width} height={definition.height} />
        </svg>
      )}
      {ordered.map((el) => {
        const shape = shapeOf(el.type);
        const r = resolved.get(el.id);
        if (!shape || !r) return null;
        const turned = el.flip && !shape.noTurn;
        return (
          <g key={el.id} data-element-id={el.id} transform={`translate(${el.x},${el.y}) scale(${el.scale})`} {...elementProps?.(el)}>
            <shape.Render p={r.props} g={isoFrame(turned)} uid={`${uid}-${el.id.replace(/[^a-zA-Z0-9_-]/g, "")}`} />
          </g>
        );
      })}
      {renderOverlay?.(resolved)}
    </svg>
  );
}
