import React, { useRef, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  neutralLightPalette,
  buildEChartsOption,
  DEFAULT_CHART_APPEARANCE,
  TEXT_SIZE_DEFAULT,
  isAllowedIcon,
  normalizePlainDate,
  formatDateFieldValue,
  type ChartAppearance,
  type ChartProps,
} from "@config-platform/schema";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
import { useTheme } from "../context/theme-context";
import { fetchAggregateGroups } from "../api/client";
import { BrokenBinding } from "../renderer/broken-binding";
import { loadECharts } from "./echarts-loader";
import { defaultChartAxisTitles } from "./chart-axis-titles";
import { DynamicIcon } from "./dynamic-icon";
import { useDateDisplayPrefs } from "../context/date-display-context";
import type { EChartsType } from "echarts/core";

/** Reads the live theme tokens so charts follow light/dark mode and the workspace theme. */
function readThemeAppearance(): { appearance: ChartAppearance; accent: string; surface: string; border: string } {
  const css = window.getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const text = token("--text", neutralLightPalette.text);
  const muted = token("--text-muted", neutralLightPalette.muted);
  const border = token("--border", neutralLightPalette.border);
  const surface = token("--surface", neutralLightPalette.surface);
  // Chart text follows the theme Text Size: --font-size-sm is the body size (14px by default)
  const rootPx = Number.parseFloat(css.fontSize) || 16;
  const bodyToken = token("--font-size-sm", "");
  const bodyPx = bodyToken.endsWith("rem") ? Number.parseFloat(bodyToken) * rootPx : Number.parseFloat(bodyToken);
  const fontScale = Number.isFinite(bodyPx) && bodyPx > 0 ? bodyPx / TEXT_SIZE_DEFAULT : 1;
  return {
    appearance: {
      title: text,
      text,
      legendText: muted,
      mutedText: muted,
      axisLine: border,
      splitLine: token("--border-subtle", border),
      background: surface,
      fontFamily: token("--font-sans", DEFAULT_CHART_APPEARANCE.fontFamily ?? "sans-serif"),
      fontScale,
    },
    accent: token("--accent", neutralLightPalette.accent),
    surface,
    border,
  };
}

export const ChartComponent: React.FC<ChartProps> = ({
  entityId,
  source,
  type = "bar",
  groupByFieldId,
  aggregateOp = "count",
  aggregateFieldId,
  title,
  icon,
  showAxisTitles = true,
  xAxisTitle,
  yAxisTitle,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();
  const datePrefs = useDateDisplayPrefs();
  const { resolvedTheme } = useTheme();
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => {
      setThemeVersion((v) => v + 1);
    };
    window.addEventListener("theme-changed", handleThemeChange);
    return () => window.removeEventListener("theme-changed", handleThemeChange);
  }, []);

  const chartElRef = useRef<HTMLDivElement | null>(null);

  const groupFieldDef = resolveField(groupByFieldId);
  const aggFieldDef = aggregateFieldId
    ? resolveField(aggregateFieldId)
    : undefined;

  // 1. Totals per group, calculated by the server over every matching record. A chart bound
  //    to a page data source uses that source's entity and filters (all its records, not just
  //    the page of rows a table shows); otherwise it reads its own entity.
  const dsState = source && runtime ? runtime.dataSources[source] : undefined;
  const queryEntityId = source ? dsState?.entityId : entityId;
  const queryFilter = source ? dsState?.filter : undefined;
  const aggregateField = aggregateOp === "count" ? undefined : aggFieldDef?.name;

  const { data: aggregate, isLoading, refetch } = useQuery({
    queryKey: ["chart-aggregate", tenantId, queryEntityId, aggregateOp, aggregateField, groupFieldDef?.name, queryFilter],
    queryFn: () =>
      fetchAggregateGroups(queryEntityId!, {
        op: aggregateOp,
        field: aggregateField,
        groupBy: groupFieldDef!.name,
        filter: queryFilter,
      }),
    enabled: Boolean(tenantId && queryEntityId && groupFieldDef && (aggregateOp === "count" || aggregateField)),
  });

  // When the data source reloads (e.g. a record was saved), the totals are recalculated too
  const sourceData = dsState?.data;
  const sourceLoadedRef = useRef(false);
  useEffect(() => {
    if (!source || sourceData === undefined) return;
    if (!sourceLoadedRef.current) {
      sourceLoadedRef.current = true;
      return;
    }
    refetch();
  }, [source, sourceData, refetch]);

  // 2. Chart categories and values
  const chartData = useMemo(() => {
    if (!groupFieldDef || !aggregate) return { labels: [] as string[], values: [] as number[] };
    const isDateGroup = groupFieldDef.type === "date";
    const isInstantGroup = isDateGroup && Boolean(groupFieldDef.config?.includeTime);
    const rows = aggregate.groups.map((group) => {
      const raw = group.key;
      // Sort key: the calendar date (or the instant) in ISO form, which orders chronologically
      const key = raw === null || raw === undefined
        ? "Unknown"
        : !isDateGroup ? String(raw)
        : isInstantGroup ? new Date(String(raw)).toISOString()
        : normalizePlainDate(raw) ?? String(raw);
      return { raw, key, value: group.value === null ? 0 : Math.round(group.value * 100) / 100 };
    });
    // Dates read left to right in time order, labelled in the viewer's date format
    if (isDateGroup) rows.sort((a, b) => (a.key === "Unknown" ? 1 : b.key === "Unknown" ? -1 : a.key.localeCompare(b.key)));
    return {
      labels: rows.map((r) => (isDateGroup && r.key !== "Unknown" ? formatDateFieldValue(r.raw, groupFieldDef.config, datePrefs) : r.key)),
      values: rows.map((r) => r.value),
    };
  }, [groupFieldDef, aggregate, datePrefs]);
  const groupsTruncated = Boolean(aggregate?.groupsTruncated);

  const seriesName = title || aggregateOp.toUpperCase();

  // Axis titles: custom text, or derived from the fields; hidden when turned off
  const autoTitles = defaultChartAxisTitles(groupFieldDef?.label, aggregateOp, aggFieldDef?.label);
  const xTitle = showAxisTitles ? xAxisTitle?.trim() || autoTitles.x : undefined;
  const yTitle = showAxisTitles ? yAxisTitle?.trim() || autoTitles.y : undefined;

  // Rendered size of the plot; the builder uses it so axis titles fit (shortened if needed)
  const [plotSize, setPlotSize] = useState<{ width: number; height: number } | null>(null);
  const hasData = chartData.labels.length > 0;

  // 3. ECharts option from the shared builder (same one used by grid charts and exports),
  //    rebuilt when the data, the theme or the plot size changes
  const option = useMemo(() => {
    if (!hasData || typeof window === "undefined") return null;
    const { appearance, accent, surface, border } = readThemeAppearance();
    const built = buildEChartsOption(
      // The card renders the title; lines keep their light area fill
      {
        type: type === "line" ? "line" : "bar",
        title: "",
        options: { legend: false, area: type === "line", xAxisTitle: xTitle, yAxisTitle: yTitle },
      },
      { categories: chartData.labels, series: [{ name: seriesName, data: chartData.values, color: accent }] },
      undefined,
      appearance,
      plotSize ?? undefined,
    );
    // Live charts are interactive: tooltips and a short entry animation
    built.animation = true;
    built.tooltip = {
      trigger: "axis",
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: appearance.text, fontFamily: appearance.fontFamily, fontSize: Math.round(12 * (appearance.fontScale ?? 1)) },
    };
    return built;
    // resolvedTheme/themeVersion: re-read the CSS tokens after a theme switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, chartData, seriesName, xTitle, yTitle, plotSize, resolvedTheme, themeVersion]);

  // 4. One ECharts instance (SVG renderer) for the plot's lifetime; it follows the card's size
  const instanceRef = useRef<EChartsType | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    const el = chartElRef.current;
    if (!el || !hasData) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      if (width > 0 && height > 0) {
        setPlotSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }
    };

    loadECharts()
      .then((echarts) => {
        if (disposed) return;
        const chart = echarts.init(el, undefined, { renderer: "svg" });
        instanceRef.current = chart;
        if (optionRef.current) chart.setOption(optionRef.current, { notMerge: true });
        measure();
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => {
            chart.resize();
            measure();
          });
          observer.observe(el);
        }
      })
      .catch((err) => console.warn("Chart failed to render:", err));

    return () => {
      disposed = true;
      observer?.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [hasData]);

  // Apply option changes (data, theme, size) to the existing instance. Merging (rather than
  // notMerge) updates in place, so a resize doesn't replay the entry animation.
  useEffect(() => {
    if (option) instanceRef.current?.setOption(option, { replaceMerge: ["series"] });
  }, [option]);

  if (!groupFieldDef && groupByFieldId) {
    return <BrokenBinding type="field" id={groupByFieldId} />;
  }
  if (!aggFieldDef && aggregateFieldId) {
    return <BrokenBinding type="field" id={aggregateFieldId} />;
  }

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className="chart-container"
      data-testid="chart-container"
      style={{
        // Contains the absolutely positioned screen-reader table; without it the table is
        // placed relative to the page and stretches the document (second scrollbar)
        position: "relative",
        padding: "var(--spacing-5)",
        backgroundColor: "var(--surface)",
        border: "var(--border-width-sm) solid var(--border)",
        borderRadius: "var(--radius-surface)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        // 0 by default: the drawn chart has a fixed pixel width, which must not stop the card
        // from shrinking with the window (the chart then redraws at the new width)
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : 0,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
        minHeight: "320px",
      }}
    >
      {(title || icon) && (
        <div
          data-testid="chart-title"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-2)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          {icon && isAllowedIcon(icon) && (
            <DynamicIcon name={icon} size="1.15em" style={{ color: "var(--accent)", flexShrink: 0 }} />
          )}
          {title}
        </div>
      )}

      {chartData.labels.length === 0 ? (
        <div
          style={{
            margin: "auto",
            color: "var(--text-muted)",
            fontSize: "var(--font-size-xs)",
          }}
        >
          {isLoading ? "Loading…" : "No data available"}
        </div>
      ) : (
        <>
          <div
            ref={chartElRef}
            data-testid="chart-plot"
            role="img"
            aria-label={`${title || "Chart"}: ${chartData.labels.length} ${chartData.labels.length === 1 ? "category" : "categories"}`}
            // overflow hidden: until the redraw, the previous (wider) drawing is clipped, not
            // pushing the page sideways
            style={{ position: "relative", width: "100%", minWidth: 0, height: "280px", overflow: "hidden" }}
          />
          {groupsTruncated && (
            <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
              Showing the first {chartData.labels.length} groups. Add a filter to narrow the chart.
            </p>
          )}
          {/* Screen-reader equivalent of the chart */}
          <table className="sr-only" data-testid="chart-data-table">
            <caption>{title || seriesName}</caption>
            <thead>
              <tr>
                <th scope="col">{groupFieldDef?.label ?? groupFieldDef?.name ?? "Category"}</th>
                <th scope="col">{seriesName}</th>
              </tr>
            </thead>
            <tbody>
              {chartData.labels.map((label, i) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{chartData.values[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
