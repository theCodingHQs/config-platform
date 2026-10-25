/** The SVG element for each plain shape kind, from its worked-out attributes */
import React from "react";
import type { VisualNodeKind } from "@config-platform/schema";
import type { ResolvedProps } from "./shapes";
import { paintRef } from "./paints";
import { safeImageHref } from "./coerce";

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Fill and outline as SVG attributes. Unset colours and default numbers are left off, so a shape
 * picks up its group's fill and outline.
 */
export function lookAttrs(a: ResolvedProps, prefix: string): React.SVGProps<SVGElement> {
  const out: React.SVGProps<SVGElement> = {};
  const fill = paintRef(a.fill, prefix);
  const stroke = paintRef(a.stroke, prefix);
  if (fill) out.fill = fill;
  if (stroke) out.stroke = stroke;
  if (n(a.fillOpacity, 1) !== 1) out.fillOpacity = n(a.fillOpacity, 1);
  if (n(a.strokeOpacity, 1) !== 1) out.strokeOpacity = n(a.strokeOpacity, 1);
  if (a.strokeWidth !== undefined && n(a.strokeWidth, 1) !== 1) out.strokeWidth = n(a.strokeWidth, 1);
  if (s(a.strokeDasharray)) out.strokeDasharray = String(a.strokeDasharray);
  if (a.strokeLinecap && a.strokeLinecap !== "butt") out.strokeLinecap = a.strokeLinecap as "round" | "square";
  if (a.strokeLinejoin && a.strokeLinejoin !== "miter") out.strokeLinejoin = a.strokeLinejoin as "round" | "bevel";
  return out;
}

const BASELINES: Record<string, string | undefined> = { auto: undefined, middle: "central", hanging: "hanging" };
const FITS: Record<string, string> = { contain: "xMidYMid meet", cover: "xMidYMid slice", stretch: "none" };

export function Primitive({ kind, a, prefix }: { kind: VisualNodeKind; a: ResolvedProps; prefix: string }) {
  const look = lookAttrs(a, prefix) as Record<string, unknown>;
  switch (kind) {
    case "rect":
      return <rect x={0} y={0} width={Math.max(0, n(a.width))} height={Math.max(0, n(a.height))} rx={n(a.rx) || undefined} {...look} />;
    case "ellipse":
      return <ellipse cx={0} cy={0} rx={Math.max(0, n(a.rx))} ry={Math.max(0, n(a.ry))} {...look} />;
    case "line":
      return <line x1={n(a.x1)} y1={n(a.y1)} x2={n(a.x2)} y2={n(a.y2)} {...look} />;
    case "polyline":
      return <polyline points={String(a.points ?? "")} {...look} />;
    case "polygon":
      return <polygon points={String(a.points ?? "")} {...look} />;
    case "path":
      return <path d={String(a.d ?? "")} {...look} />;
    case "text":
      return (
        <text
          x={0}
          y={0}
          fontSize={n(a.fontSize, 14)}
          fontWeight={a.fontWeight !== "400" ? String(a.fontWeight) : undefined}
          fontFamily={a.fontFamily !== "inherit" ? String(a.fontFamily) : undefined}
          textAnchor={a.textAnchor !== "start" ? (String(a.textAnchor) as "middle" | "end") : undefined}
          dominantBaseline={BASELINES[String(a.baseline)] as "central" | "hanging" | undefined}
          {...look}
        >
          {String(a.text ?? "")}
        </text>
      );
    case "image": {
      const href = String(a.href ?? "");
      const w = Math.max(0, n(a.width));
      const h = Math.max(0, n(a.height));
      return safeImageHref(href) ? (
        <image href={href} x={0} y={0} width={w} height={h} preserveAspectRatio={FITS[String(a.fit)] ?? FITS.contain} />
      ) : (
        <g>
          <rect x={0} y={0} width={w} height={h} fill="var(--vis-white)" stroke="var(--vis-steel)" strokeDasharray="4 3" />
          <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--vis-label)">
            Picture
          </text>
        </g>
      );
    }
    default:
      return null;
  }
}
