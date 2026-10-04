import React, { useRef, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChartProps } from "@config-platform/schema";
import { useMetadata } from "../context/metadata-context";
import { usePageRuntime } from "../context/page-runtime-context";
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
}) => {
  const { tenantId, resolveEntity, resolveField } = useMetadata();
  const runtime = usePageRuntime();
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
  }, [rawRecords, groupFieldDef, aggFieldDef, aggregateOp]);

  // 3. Render with Chart.js if canvas 2D is available
  useEffect(() => {
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
                  type === "line"
                    ? "rgba(79, 70, 229, 0.2)"
                    : "rgba(79, 70, 229, 0.65)",
                borderColor: "#4f46e5",
                borderWidth: 2,
                borderRadius: 4,
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
            },
            scales: {
              y: {
                beginAtZero: true,
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
  }, [type, chartData, title, aggregateOp]);

  if (!groupFieldDef && groupByFieldId) {
    return <BrokenBinding type="field" id={groupByFieldId} />;
  }
  if (!aggFieldDef && aggregateFieldId) {
    return <BrokenBinding type="field" id={aggregateFieldId} />;
  }

  const maxVal = Math.max(...chartData.values, 1);

  return (
    <div
      className="chart-container"
      data-testid="chart-container"
      style={{
        padding: "1.25rem",
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius, 8px)",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        width: "100%",
        minHeight: "260px",
      }}
    >
      {title && (
        <div
          style={{
            fontSize: "0.9375rem",
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
            color: "var(--text-muted, #6b7280)",
            fontSize: "0.8125rem",
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
                      fill="#4f46e5"
                      rx="3"
                      opacity="0.8"
                    />
                    <text
                      x={x + barWidth / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#374151"
                    >
                      {chartData.values[i]}
                    </text>
                    <text
                      x={x + barWidth / 2}
                      y={160}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#6b7280"
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
