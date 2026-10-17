import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import {
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  Layers,
  Edit2,
  Trash2,
  Move,
} from 'lucide-react';
import {
  type GridChartDefinition,
  type ChartRenderData,
  buildEChartsOption,
} from '@config-platform/schema';

export interface ChartOverlayCanvasProps {
  charts: GridChartDefinition[];
  activeSheetId: string;
  viewMode: 'design' | 'preview';
  onEditChart: (chart: GridChartDefinition) => void;
  onDeleteChart: (chartId: string) => void;
  themeTokens?: Record<string, string>;
  previewDataMap?: Map<string, ChartRenderData>;
}

function ChartTypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  switch (type) {
    case 'line':
      return <LineChart size={size} />;
    case 'area':
      return <AreaChart size={size} />;
    case 'pie':
    case 'donut':
      return <PieChart size={size} />;
    case 'combo':
      return <Layers size={size} />;
    default:
      return <BarChart3 size={size} />;
  }
}

function LiveChartInstance({
  chart,
  data,
  themeTokens,
}: {
  chart: GridChartDefinition;
  data: ChartRenderData;
  themeTokens?: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }

    const option = buildEChartsOption(chart, data, themeTokens);
    option.animation = true;
    chartRef.current.setOption(option, true);

    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [chart, data, themeTokens]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

export function ChartOverlayCanvas({
  charts,
  activeSheetId,
  viewMode,
  onEditChart,
  onDeleteChart,
  themeTokens,
  previewDataMap,
}: ChartOverlayCanvasProps) {
  const visibleCharts = charts.filter(
    (c) => c.anchor.sheetId === activeSheetId || !c.anchor.sheetId
  );

  if (visibleCharts.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 4,
        overflow: 'hidden',
      }}
    >
      {visibleCharts.map((chart) => {
        // Approximate standard row and column widths for grid positioning
        const leftPx = 50 + chart.anchor.startCol * 75;
        const topPx = 28 + chart.anchor.startRow * 24;
        const widthPx = Math.max(260, (chart.anchor.endCol - chart.anchor.startCol + 1) * 75);
        const heightPx = Math.max(180, (chart.anchor.endRow - chart.anchor.startRow + 1) * 24);

        const chartData: ChartRenderData = previewDataMap?.get(chart.id) || {
          categories: ['Cat A', 'Cat B', 'Cat C', 'Cat D'],
          series: chart.source.series.map((s, idx) => ({
            name: s.name || `Series ${idx + 1}`,
            data: [120 + idx * 25, 200 + idx * 30, 150 + idx * 20, 80 + idx * 10],
            color: s.color,
            type: s.type,
          })),
        };

        return (
          <div
            key={chart.id}
            data-testid={`chart-overlay-${chart.id}`}
            style={{
              position: 'absolute',
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              backgroundColor: 'var(--surface)',
              border: viewMode === 'design' ? '2px dashed var(--accent)' : '1px solid var(--border)',
              borderRadius: 'var(--radius-control)',
              boxShadow: 'var(--shadow-md)',
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'auto',
              overflow: 'hidden',
              transition: 'box-shadow 0.15s ease',
            }}
          >
            {/* Header bar on chart card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-1) var(--space-2)',
                backgroundColor: 'var(--surface-subtle)',
                borderBottom: 'var(--border-width) solid var(--border)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', overflow: 'hidden' }}>
                <span style={{ color: 'var(--accent)' }}>
                  <ChartTypeIcon type={chart.type} size={13} />
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}
                  title={chart.title}
                >
                  {chart.title}
                </span>
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-control)',
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                  }}
                >
                  {chart.type}
                </span>
              </div>

              {viewMode === 'design' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onEditChart(chart)}
                    title="Edit Chart"
                    data-testid={`edit-chart-${chart.id}`}
                    style={{ padding: 'var(--space-1)', height: 'auto' }}
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onDeleteChart(chart.id)}
                    title="Delete Chart"
                    data-testid={`delete-chart-${chart.id}`}
                    style={{ color: 'var(--danger)', padding: 'var(--space-1)', height: 'auto' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Chart Body */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <LiveChartInstance chart={chart} data={chartData} themeTokens={themeTokens} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
