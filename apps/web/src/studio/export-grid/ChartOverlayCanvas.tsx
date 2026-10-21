import React, { useEffect, useRef, useSyncExternalStore } from 'react';
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

/**
 * Live chart data keyed by chart id. Cards subscribe to it, so range charts re-render as the cells
 * they read change (e.g. a checkbox click) without remounting Univer float DOMs.
 */
export interface ChartDataStore {
  get: (chartId: string) => ChartRenderData | undefined;
  set: (data: Map<string, ChartRenderData>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createChartDataStore(): ChartDataStore {
  let current = new Map<string, ChartRenderData>();
  const listeners = new Set<() => void>();
  return {
    get: (chartId) => current.get(chartId),
    set: (data) => {
      current = data;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const noopSubscribe = () => () => {};

export interface SpreadsheetGridMetrics {
  scrollX: number;
  scrollY: number;
  gridLeft?: number;
  gridTop?: number;
  gridWidth?: number;
  gridHeight?: number;
  getCellCoordinates?: (row: number, col: number) => { x: number; y: number };
}

export interface ChartOverlayCanvasProps {
  charts: GridChartDefinition[];
  activeSheetId: string;
  viewMode: 'design' | 'preview';
  onEditChart: (chart: GridChartDefinition) => void;
  onDeleteChart: (chartId: string) => void;
  themeTokens?: Record<string, string>;
  previewDataMap?: Map<string, ChartRenderData>;
  dataStore?: ChartDataStore;
  gridMetrics?: SpreadsheetGridMetrics;
  onForwardWheel?: (e: React.WheelEvent) => void;
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
  const renderedChartRef = useRef<GridChartDefinition | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }

    const option = buildEChartsOption(chart, data, themeTokens);
    option.animation = true;
    // Replace the option when the chart definition changes; merge when only data changed so
    // live updates (e.g. ticking a checkbox) animate instead of redrawing from scratch.
    const definitionChanged = renderedChartRef.current !== chart;
    chartRef.current.setOption(option, definitionChanged ? { notMerge: true } : { replaceMerge: ['series'] });
    renderedChartRef.current = chart;

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
  dataStore,
  gridMetrics,
  onForwardWheel,
}: ChartOverlayCanvasProps) {
  const visibleCharts = charts.filter(
    (c) => c.anchor.sheetId === activeSheetId || !c.anchor.sheetId
  );

  if (visibleCharts.length === 0) return null;

  const {
    scrollX = 0,
    scrollY = 0,
    gridLeft = 48,
    gridTop = 52,
    gridWidth,
    gridHeight,
    getCellCoordinates,
  } = gridMetrics || {};

  return (
    <div
      data-testid="chart-overlay-canvas"
      onWheel={onForwardWheel}
      style={{
        position: 'absolute',
        left: `${gridLeft}px`,
        top: `${gridTop}px`,
        width: gridWidth !== undefined && gridWidth > 0 ? `${gridWidth}px` : `calc(100% - ${gridLeft}px)`,
        height: gridHeight !== undefined && gridHeight > 0 ? `${gridHeight}px` : `calc(100% - ${gridTop}px)`,
        pointerEvents: 'none',
        zIndex: 4,
        overflow: 'hidden',
      }}
    >
      {visibleCharts.map((chart) => {
        let startX: number;
        let startY: number;
        let endX: number;
        let endY: number;

        if (getCellCoordinates) {
          const start = getCellCoordinates(chart.anchor.startRow, chart.anchor.startCol);
          const end = getCellCoordinates(chart.anchor.endRow + 1, chart.anchor.endCol + 1);
          startX = start.x;
          startY = start.y;
          endX = end.x;
          endY = end.y;
        } else {
          startX = chart.anchor.startCol * 75;
          startY = chart.anchor.startRow * 24;
          endX = (chart.anchor.endCol + 1) * 75;
          endY = (chart.anchor.endRow + 1) * 24;
        }

        const widthPx = Math.max(260, endX - startX);
        const heightPx = Math.max(180, endY - startY);

        // Position relative to the scrolled viewport within the grid visible boundary
        const leftPx = startX - scrollX;
        const topPx = startY - scrollY;

        // Skip rendering if completely offscreen outside the visible grid boundary
        if (gridWidth !== undefined && gridWidth > 0 && leftPx + widthPx < 0) {
          return null;
        }
        if (gridHeight !== undefined && gridHeight > 0 && topPx + heightPx < 0) {
          return null;
        }
        if (gridWidth !== undefined && gridWidth > 0 && leftPx > gridWidth) {
          return null;
        }
        if (gridHeight !== undefined && gridHeight > 0 && topPx > gridHeight) {
          return null;
        }

        return (
          <GridChartCardContent
            key={chart.id}
            chart={chart}
            viewMode={viewMode}
            onEditChart={onEditChart}
            onDeleteChart={onDeleteChart}
            themeTokens={themeTokens}
            previewDataMap={previewDataMap}
            dataStore={dataStore}
            style={{
              position: 'absolute',
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
            }}
          />
        );
      })}
    </div>
  );
}

export function GridChartCardContent({
  chart,
  viewMode = 'design',
  onEditChart,
  onDeleteChart,
  themeTokens,
  previewDataMap,
  dataStore,
  style,
}: {
  chart: GridChartDefinition;
  viewMode?: 'design' | 'preview';
  onEditChart?: (chart: GridChartDefinition) => void;
  onDeleteChart?: (chartId: string) => void;
  themeTokens?: Record<string, string>;
  previewDataMap?: Map<string, ChartRenderData>;
  dataStore?: ChartDataStore;
  style?: React.CSSProperties;
}) {
  const liveData = useSyncExternalStore(dataStore?.subscribe ?? noopSubscribe, () => dataStore?.get(chart.id));
  const chartData: ChartRenderData = liveData || previewDataMap?.get(chart.id) || {
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
      data-testid={`chart-overlay-${chart.id}`}
      style={{
        width: '100%',
        height: '100%',
        minWidth: '260px',
        minHeight: '180px',
        backgroundColor: 'var(--surface)',
        border: viewMode === 'design' ? '2px dashed var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-control)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s ease',
        ...style,
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
              onClick={() => onEditChart?.(chart)}
              title="Edit Chart"
              data-testid={`edit-chart-${chart.id}`}
              style={{ padding: 'var(--space-1)', height: 'auto' }}
            >
              <Edit2 size={12} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onDeleteChart?.(chart.id)}
              title="Delete Chart"
              data-testid={`delete-chart-${chart.id}`}
              style={{ color: 'var(--danger)', padding: 'var(--space-1)', height: 'auto' }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Chart Body: opaque background ensures spreadsheet cells never bleed through */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: 'var(--surface)',
        }}
      >
        <LiveChartInstance chart={chart} data={chartData} themeTokens={themeTokens} />
      </div>
    </div>
  );
}

export function GridChartFloatDomCard(props: any) {
  const data = props?.data || props;
  if (!data?.chart) return null;
  return (
    <GridChartCardContent
      chart={data.chart}
      viewMode={data.viewMode}
      onEditChart={data.onEditChart}
      onDeleteChart={data.onDeleteChart}
      themeTokens={data.themeTokens}
      previewDataMap={data.previewDataMap}
      dataStore={data.dataStore}
    />
  );
}
