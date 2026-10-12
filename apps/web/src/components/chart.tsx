import React, { useRef, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChartProps } from "@config-platform/schema";
import { neutralLightPalette, defaultSharedTokens } from "@config-platform/schema";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
import { useTheme } from "../context/theme-context";
import { fetchRecords } from "../api/client";
import { BrokenBinding } from "../renderer/broken-binding";

export const ChartComponent: React.FC<ChartProps> = ({
  entityId,
  source,
  type = "bar",
  groupByFieldId,
  aggregateOp = "count",
  aggregateFieldId,
  title,
  flex,
  width,
  minWidth,
  maxWidth,
  alignSelf,
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();
  const { resolvedTheme } = useTheme();
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => {
      setThemeVersion((v) => v + 1);
    };
    window.addEventListener("theme-changed", handleThemeChange);
    return () => window.removeEventListener("theme-changed", handleThemeChange);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<any>(null);
  const [chartReady, setChartReady] = useState(false);
  const [chartFailed, setChartFailed] = useState(false);

  const isCanvasSupported = useMemo(() => {
    if (typeof document === "undefined") return false;
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.toLowerCase().includes("jsdom")
    ) {
      return false;
    }
    try {
      const testCanvas = document.createElement("canvas");
      return Boolean(testCanvas.getContext && testCanvas.getContext("2d"));
    } catch {
      return false;
    }
  }, []);

  const groupFieldDef = resolveField(groupByFieldId);
  const aggFieldDef = aggregateFieldId
    ? resolveField(aggregateFieldId)
    : undefined;

  // 1. Data retrieval: from data source or direct query
  const isDataSourceMode = Boolean(source && runtime);
  const dsState = source && runtime ? runtime.dataSources[source] : undefined;

  const { data: queryRecords } = useQuery({
    queryKey: ["chart-records", tenantId, entityId],
    queryFn: () =>
      fetchRecords(tenantId, entityId!, { limit: 100 }).then((r) => r.data),
    enabled: Boolean(!isDataSourceMode && tenantId && entityId),
  });

  const rawRecords = isDataSourceMode
    ? dsState?.data || []
    : queryRecords || [];

  // 2. Compute group-by aggregation
  const chartData = useMemo(() => {
    if (!groupFieldDef || rawRecords.length === 0) {
      return { labels: [], values: [] };
    }

    const groupFieldName = groupFieldDef.name;
    const aggFieldName = aggFieldDef ? aggFieldDef.name : "id";

    const groups = new Map<string, number[]>();

    for (const row of rawRecords) {
      const rawKey = row[groupFieldName];
      const key =
        rawKey === null || rawKey === undefined ? "Unknown" : String(rawKey);

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      const val = row[aggFieldName];
      const numVal = typeof val === "number" ? val : Number(val) || 0;
      groups.get(key)!.push(numVal);
    }

    const labels: string[] = [];
    const values: number[] = [];

    for (const [key, vals] of groups.entries()) {
      labels.push(key);
      let calculated = 0;
      switch (aggregateOp) {
        case "count":
          calculated = vals.length;
          break;
        case "sum":
          calculated = vals.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          calculated =
            vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          break;
        case "min":
          calculated = vals.length > 0 ? Math.min(...vals) : 0;
          break;
        case "max":
          calculated = vals.length > 0 ? Math.max(...vals) : 0;
          break;
      }
      values.push(Math.round(calculated * 100) / 100);
    }

    return { labels, values };
  }, [groupFieldDef, aggFieldDef, rawRecords, aggregateOp]);

  // 3. Initialize or Re-render Chart.js reading token values from computed styles
  useEffect(() => {
    if (!isCanvasSupported || chartData.labels.length === 0) {
      return;
    }

    let isCancelled = false;

    async function initChart() {
      if (!isCanvasSupported || !canvasRef.current) return;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvasRef.current.getContext("2d");
      } catch {
        ctx = null;
      }
      if (!ctx) {
        setChartFailed(true);
        return;
      }

      // Read design token values from computed styles
      const computed = window.getComputedStyle(document.documentElement);
      const accent = computed.getPropertyValue("--accent").trim() || neutralLightPalette.accent;
      const accentSubtle =
        computed.getPropertyValue("--accent-subtle").trim() || neutralLightPalette["accent-subtle"];
      const textColor = computed.getPropertyValue("--text").trim() || neutralLightPalette.text;
      const textMuted =
        computed.getPropertyValue("--text-muted").trim() || neutralLightPalette.muted;
      const borderColor =
        computed.getPropertyValue("--border").trim() || neutralLightPalette.border;

      try {
        const { Chart, registerables } = await import("chart.js");
        if (registerables) {
          Chart.register(...registerables);
        }

        if (chartInstanceRef.current) {
          chartInstanceRef.current.destroy();
          chartInstanceRef.current = null;
        }

        if (isCancelled) return;

        chartInstanceRef.current = new Chart(ctx, {
          type: type === "line" ? "line" : "bar",
          data: {
            labels: chartData.labels,
            datasets: [
              {
                label: title || `${aggregateOp.toUpperCase()}`,
                data: chartData.values,
                backgroundColor:
                  type === "line" ? accentSubtle : accent,
                borderColor: accent,
                borderWidth: parseInt(defaultSharedTokens.borderWidth.md, 10),
                borderRadius: parseInt(defaultSharedTokens.radius.sm, 10),
                tension: 0.2,
                fill: type === "line",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false,
              },
              tooltip: {
                backgroundColor: computed.getPropertyValue("--surface").trim() || neutralLightPalette.surface,
                titleColor: textColor,
                bodyColor: textColor,
                borderColor: borderColor,
                borderWidth: parseInt(defaultSharedTokens.borderWidth.sm, 10),
              },
            },
            scales: {
              x: {
                ticks: {
                  color: textMuted,
                  font: { family: computed.getPropertyValue("--font-sans").trim() || defaultSharedTokens.fontStack.sans },
                },
                grid: {
                  color: borderColor,
                },
              },
              y: {
                beginAtZero: true,
                ticks: {
                  color: textMuted,
                  font: { family: computed.getPropertyValue("--font-sans").trim() || "sans-serif" },
                },
                grid: {
                  color: borderColor,
                },
              },
            },
          },
        });

        if (!isCancelled) {
          setChartReady(true);
          setChartFailed(false);
        }
      } catch (err) {
        // Fallback to SVG gracefully
        console.warn("Chart.js init fallback:", err);
        if (!isCancelled) {
          setChartReady(false);
          setChartFailed(true);
        }
      }
    }

    initChart();

    return () => {
      isCancelled = true;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      setChartReady(false);
    };
  }, [type, chartData, title, aggregateOp, resolvedTheme, themeVersion, isCanvasSupported]);

  if (!groupFieldDef && groupByFieldId) {
    return <BrokenBinding type="field" id={groupByFieldId} />;
  }
  if (!aggFieldDef && aggregateFieldId) {
    return <BrokenBinding type="field" id={aggregateFieldId} />;
  }

  const maxVal = Math.max(...chartData.values, 1);

  const widthValue =
    width !== undefined
      ? (typeof width === 'number' ? `${width}px` : width)
      : (flex !== undefined ? undefined : '100%');

  return (
    <div
      className="chart-container"
      data-testid="chart-container"
      style={{
        padding: "var(--spacing-5)",
        backgroundColor: "var(--surface)",
        border: "var(--border-width-sm) solid var(--border)",
        borderRadius: "var(--radius-surface)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
        flex: flex !== undefined ? flex : undefined,
        width: widthValue,
        minWidth: minWidth !== undefined ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined,
        maxWidth: maxWidth !== undefined ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined,
        alignSelf,
        minHeight: "260px",
      }}
    >
      {title && (
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
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
          No data available
        </div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: "220px" }}>
          {/* Canvas for Chart.js */}
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />

          {/* SVG Fallback if canvas is not supported (e.g. standard JSDOM in tests) */}
          {(!isCanvasSupported || chartFailed) && (
            <svg
              data-testid="chart-svg-fallback"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
              viewBox="0 0 400 180"
            >
              {chartData.labels.map((lbl, i) => {
                const count = chartData.labels.length;
                const barWidth = Math.max(16, Math.min(40, 300 / count - 10));
                const x = 40 + i * (320 / count);
                const height = (chartData.values[i] / maxVal) * 120;
                const y = 140 - height;

                return (
                  <g key={lbl}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      fill="var(--accent)"
                      rx="3"
                      opacity="0.85"
                    />
                    <text
                      x={x + barWidth / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--text)"
                    >
                      {chartData.values[i]}
                    </text>
                    <text
                      x={x + barWidth / 2}
                      y={160}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--text-muted)"
                    >
                      {lbl}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      )}
    </div>
  );
};
