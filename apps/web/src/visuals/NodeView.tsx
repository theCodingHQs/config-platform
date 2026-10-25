/**
 * Draws one node and (for groups) its children: works out its attributes against live data, then
 * places it, runs its animations and draws its shape, part or symbol.
 */
import React, { createContext, useContext, useMemo, useRef } from "react";
import type { ExpressionScope, VisualDefinition, VisualNode } from "@config-platform/schema";
import { shapeOf } from "./shapes";
import { isoFrame } from "./shapes/iso-draw";
import { resolveNode, type ActiveEffect } from "./resolve-props";
import { specsFor } from "./node-specs";
import { placeTransform, pivotTransform } from "./node-transform";
import { lookAttrs, Primitive } from "./primitives";
import { PaintDefs, shadowFilterId } from "./paints";
import { useSmooth } from "./use-smooth";
import { usePathPoint } from "./use-path-point";

export interface RenderEnv {
  /** null: set values only, no live data */
  scope: ExpressionScope | null;
  /** Id prefix for this drawing's gradients */
  prefix: string;
  isometric: boolean;
  /** Symbols placed in the drawing, by id */
  symbols?: ReadonlyMap<string, VisualDefinition>;
  /** Extra attributes on each node's outer group */
  nodeProps?: (node: VisualNode) => React.SVGProps<SVGGElement> | undefined;
  /** Draw nodes hidden in the editor */
  showHidden?: boolean;
  /** Symbols inside symbols, to stop a symbol that contains itself */
  depth: number;
  /** Node names → ids, for settings that point at another node by name (the path to follow) */
  names?: ReadonlyMap<string, string>;
}

export const RenderEnvContext = createContext<RenderEnv>({ scope: null, prefix: "v", isometric: false, depth: 0 });

const FX_CLASS: Record<ActiveEffect["type"], string> = { blink: "vis-fx-blink", pulse: "vis-fx-pulse", spin: "vis-fx-spin", flow: "vis-fx-flow", shake: "vis-fx-shake" };

/** Sum of a dash pattern, so flowing dashes loop seamlessly */
const dashCycle = (dash: unknown) => {
  const parts = String(dash ?? "").split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
  const sum = parts.reduce((a, b) => a + b, 0);
  return parts.length % 2 === 1 ? sum * 2 : sum || 12;
};

function withEffects(effects: ActiveEffect[], dash: unknown, content: React.ReactNode): React.ReactNode {
  return effects.reduceRight<React.ReactNode>(
    (inner, fx) => (
      <g className={FX_CLASS[fx.type]} style={{ ["--vis-speed" as string]: fx.speed, ["--vis-dash" as string]: dashCycle(dash) }}>
        {inner}
      </g>
    ),
    content,
  );
}

function SymbolBody({ node, inputs }: { node: VisualNode; inputs: Record<string, unknown> }) {
  const env = useContext(RenderEnvContext);
  const symbol = node.ref ? env.symbols?.get(node.ref) : undefined;
  const inner = useMemo<RenderEnv | null>(
    () => (symbol ? { ...env, scope: { ...(env.scope ?? {}), inputs }, prefix: `${env.prefix}-${node.id}`, nodeProps: undefined, showHidden: false, depth: env.depth + 1 } : null),
    [env, symbol, inputs, node.id],
  );
  if (!symbol || !inner || env.depth > 4) return <rect width={60} height={40} fill="none" stroke="var(--vis-alarm)" strokeDasharray="4 3" />;
  return (
    <RenderEnvContext.Provider value={inner}>
      {/* Marks where a symbol's own shapes start, so the editor selects the placed copy, not its insides */}
      <g data-symbol-body="">
        <PaintDefs paints={symbol.paints} prefix={inner.prefix} />
        {symbol.nodes.map((child) => (
          <NodeView key={child.id} node={child} />
        ))}
      </g>
    </RenderEnvContext.Provider>
  );
}

export const NodeView = React.memo(function NodeView({ node }: { node: VisualNode }) {
  const env = useContext(RenderEnvContext);
  const symbolInputs = node.kind === "symbol" && node.ref ? env.symbols?.get(node.ref)?.inputs : undefined;
  const specs = useMemo(() => specsFor(node, symbolInputs), [node, symbolInputs]);
  const resolved = useMemo(() => resolveNode(node, specs, env.scope), [node, specs, env.scope]);
  const a = useSmooth(resolved.attrs, node.smooth);
  const outer = useRef<SVGGElement>(null);
  const follow = typeof a.followPath === "string" && a.followPath ? (env.names?.get(a.followPath) ?? a.followPath) : undefined;
  const along = usePathPoint(outer, follow, Number(a.progress) || 0);
  if (a.visible === false || (node.hidden && !env.showHidden)) return null;

  const pivot = pivotTransform(a);
  let body: React.ReactNode;
  if (node.kind === "group") {
    body = (
      <g {...(lookAttrs(a, env.prefix) as React.SVGProps<SVGGElement>)}>
        {node.children?.map((child) => (
          <NodeView key={child.id} node={child} />
        ))}
      </g>
    );
  } else if (node.kind === "preset") {
    const part = node.ref ? shapeOf(node.ref) : undefined;
    body = part ? <part.Render p={a} g={isoFrame(Boolean(a.turned) && !part.noTurn)} uid={`${env.prefix}-${node.id}`} /> : null;
  } else if (node.kind === "symbol") {
    body = <SymbolBody node={node} inputs={a} />;
  } else {
    body = <Primitive kind={node.kind} a={a} prefix={env.prefix} />;
  }

  const opacity = typeof a.opacity === "number" && a.opacity !== 1 ? a.opacity : undefined;
  return (
    <g
      ref={outer}
      data-node-id={node.id}
      transform={placeTransform(a, env.isometric, along)}
      opacity={opacity}
      filter={a.shadow ? `url(#${shadowFilterId(env.prefix)})` : undefined}
      className={resolved.effects.length && env.scope === null ? "vis-paused" : undefined}
      {...env.nodeProps?.(node)}
    >
      {withEffects(
        resolved.effects,
        a.strokeDasharray,
        <g transform={pivot.transform} style={pivot.style} data-node-body="">
          {body}
        </g>,
      )}
    </g>
  );
});
