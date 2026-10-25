import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { VisualProps } from "@config-platform/schema";
import { usePageRuntime } from "../context/page-runtime-context";
import { useLiveScope } from "../live/use-live";
import { VisualScene } from "../visuals/VisualScene";
import { visualKey, visualsApi } from "../visuals/visuals-api";
import { useSymbols } from "../visuals/use-symbols";
import { BrokenBinding } from "../renderer/broken-binding";

const css = (v: number | string | undefined) => (typeof v === "number" ? `${v}px` : v);

/** Page component: a visual from Studio → Visuals, moving with live data and the page's own values */
export const VisualComponent: React.FC<VisualProps> = ({ visualId, height, title, flex, width, minWidth, maxWidth, alignSelf }) => {
  const runtime = usePageRuntime();
  const { data: visual, isLoading, error } = useQuery({
    queryKey: visualKey(visualId ?? ""),
    queryFn: () => visualsApi.get(visualId!),
    enabled: Boolean(visualId),
    retry: (count, err: any) => err?.statusCode !== 404 && count < 2,
  });
  const symbols = useSymbols(visual?.definition);
  // Tags used inside placed symbols count too
  const watched = useMemo(() => (visual ? [visual.definition, ...symbols.values()] : undefined), [visual, symbols]);
  const live = useLiveScope(watched);
  const scope = useMemo(() => ({ ...(runtime?.scope ?? {}), ...live }), [runtime?.scope, live]);

  const box: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
    flex,
    width: css(width) ?? (flex !== undefined ? undefined : "100%"),
    minWidth: css(minWidth),
    maxWidth: css(maxWidth),
    alignSelf,
  };

  if (!visualId) {
    return (
      <div style={{ ...box, padding: "var(--space-6)", border: "var(--border-width-sm) dashed var(--border)", borderRadius: "var(--radius-surface)", color: "var(--text-muted)", textAlign: "center" }}>
        Choose a visual to show (Studio → Visuals)
      </div>
    );
  }
  if (error && (error as any).statusCode === 404) return <BrokenBinding type="visual" id={visualId} />;

  const ratio = visual ? `${visual.definition.width} / ${visual.definition.height}` : "16 / 9";
  return (
    <div style={box} data-testid="visual-component">
      {title && <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{title}</div>}
      <div
        style={{
          width: "100%",
          height: height ? `${height}px` : undefined,
          aspectRatio: height ? undefined : ratio,
          borderRadius: "var(--radius-surface)",
          overflow: "hidden",
          border: "var(--border-width-sm) solid var(--border)",
          background: "var(--vis-floor)",
        }}
      >
        {visual ? (
          <VisualScene definition={visual.definition} scope={scope} symbols={symbols} ariaLabel={visual.name} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
            {isLoading ? "Loading…" : "This visual couldn't be loaded"}
          </div>
        )}
      </div>
    </div>
  );
};
