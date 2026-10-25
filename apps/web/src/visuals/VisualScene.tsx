/**
 * Draws a visual: its background (and the floor grid in isometric drawings), its gradients, then
 * every node in order (later nodes draw on top). Used by pages (read only) and by the editor, which
 * adds its grid and selection through `renderOverlay`.
 */
import React, { useId, useMemo } from "react";
import { ISO, isoPoint, type ExpressionScope, type VisualDefinition, type VisualNode } from "@config-platform/schema";
import { NodeView, RenderEnvContext, type RenderEnv } from "./NodeView";
import { PaintDefs } from "./paints";
import { safeColor } from "./coerce";
import "./visuals.css";

export interface VisualSceneProps {
  definition: VisualDefinition;
  /** null: show the set values only (bindings not worked out) */
  scope: ExpressionScope | null;
  symbols?: ReadonlyMap<string, VisualDefinition>;
  className?: string;
  style?: React.CSSProperties;
  svgRef?: React.Ref<SVGSVGElement>;
  nodeProps?: (node: VisualNode) => React.SVGProps<SVGGElement> | undefined;
  /** Show the square grid of flat drawings (the editor) */
  showGrid?: boolean;
  showHidden?: boolean;
  /** Drawn above everything, in drawing coordinates */
  renderOverlay?: () => React.ReactNode;
  /** Drawn under the nodes, above the background */
  renderUnderlay?: () => React.ReactNode;
  ariaLabel?: string;
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

function SquareGrid({ width, height, size, prefix }: { width: number; height: number; size: number; prefix: string }) {
  // Faint lines every step, stronger every 5
  const id = `${prefix}--grid`;
  return (
    <>
      <defs>
        <pattern id={`${id}-s`} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M${size} 0H0V${size}`} fill="none" className="vis-grid-line vis-grid-fine" />
        </pattern>
        <pattern id={id} width={size * 5} height={size * 5} patternUnits="userSpaceOnUse">
          <rect width={size * 5} height={size * 5} fill={`url(#${id}-s)`} />
          <path d={`M${size * 5} 0H0V${size * 5}`} fill="none" className="vis-grid-line" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${id})`} pointerEvents="none" />
    </>
  );
}

export function VisualScene({ definition, scope, symbols, className, style, svgRef, nodeProps, showGrid, showHidden, renderOverlay, renderUnderlay, ariaLabel }: VisualSceneProps) {
  const prefix = `v${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const isometric = definition.mode === "isometric";
  const env = useMemo<RenderEnv>(() => ({ scope, prefix, isometric, symbols, nodeProps, showHidden, depth: 0 }), [scope, prefix, isometric, symbols, nodeProps, showHidden]);

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
      <PaintDefs paints={definition.paints} prefix={prefix} />
      <rect x={0} y={0} width={definition.width} height={definition.height} style={{ fill: (definition.background && safeColor(definition.background)) || "var(--vis-floor)" }} data-background="" />
      {isometric && definition.grid && (
        <svg x={0} y={0} width={definition.width} height={definition.height} overflow="hidden" pointerEvents="none">
          <FloorGrid width={definition.width} height={definition.height} />
        </svg>
      )}
      {!isometric && showGrid && definition.grid && <SquareGrid width={definition.width} height={definition.height} size={definition.gridSize} prefix={prefix} />}
      {renderUnderlay?.()}
      <RenderEnvContext.Provider value={env}>
        {definition.nodes.map((node) => (
          <NodeView key={node.id} node={node} />
        ))}
      </RenderEnvContext.Provider>
      {renderOverlay?.()}
    </svg>
  );
}
