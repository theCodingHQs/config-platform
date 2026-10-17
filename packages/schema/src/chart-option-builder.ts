import type { GridChartDefinition } from './chart-spec.js';

export interface ChartSeriesData {
  name: string;
  data: (number | null)[];
  color?: string;
  type?: 'bar' | 'line' | 'area';
}

export interface ChartRenderData {
  categories: string[];
  series: ChartSeriesData[];
}

export const DEFAULT_CHART_PALETTE = [
  '#0ea5e9', // Sky / Accent
  '#8b5cf6', // Violet
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
];

export const THEME_TOKEN_COLORS: Record<string, string> = {
  accent: '#0ea5e9',
  primary: '#3b82f6',
  secondary: '#64748b',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  muted: '#94a3b8',
  neutral: '#64748b',
  purple: '#8b5cf6',
  pink: '#ec4899',
  emerald: '#10b981',
  amber: '#f59e0b',
  teal: '#14b8a6',
};

/**
 * Escapes user-supplied text for SVG output, stripping any potential script injection.
 */
export function escapeChartText(text?: string): string {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim();
}

/**
 * Resolves a color string (hex or theme token) to a concrete hex color.
 */
export function resolveChartColor(color?: string, fallbackIndex = 0, themeTokens?: Record<string, string>): string {
  if (!color) {
    return DEFAULT_CHART_PALETTE[fallbackIndex % DEFAULT_CHART_PALETTE.length];
  }
  const clean = color.trim();
  if (clean.startsWith('#')) return clean;
  if (themeTokens && themeTokens[clean]) return themeTokens[clean];
  if (THEME_TOKEN_COLORS[clean]) return THEME_TOKEN_COLORS[clean];
  return DEFAULT_CHART_PALETTE[fallbackIndex % DEFAULT_CHART_PALETTE.length];
}

/**
 * Builds a deterministic Apache ECharts option configuration object.
 * Used identically by the server SSR exporter and client preview renderer.
 */
export function buildEChartsOption(
  chart: GridChartDefinition,
  data: ChartRenderData,
  themeTokens?: Record<string, string>
): Record<string, any> {
  const isPieOrDonut = chart.type === 'pie' || chart.type === 'donut';
  const titleText = escapeChartText(chart.title);
  const showLegend = chart.options?.legend !== false;
  const isStacked = Boolean(chart.options?.stacked);
  const isSmooth = Boolean(chart.options?.smooth);
  const isArea = Boolean(chart.options?.area);

  const sanitizedCategories = (data.categories || []).map((cat) => escapeChartText(cat));
  const rawSeries = data.series || [];

  // Determine series colors
  const seriesColors = rawSeries.map((s, idx) => resolveChartColor(s.color, idx, themeTokens));

  const option: Record<string, any> = {
    animation: false, // SSR renders instantly
    color: seriesColors.length > 0 ? seriesColors : DEFAULT_CHART_PALETTE,
  };

  if (titleText) {
    option.title = {
      text: titleText,
      left: 'center',
      top: 10,
      textStyle: {
        fontSize: 14,
        fontWeight: 600,
        color: '#1e293b',
      },
    };
  }

  if (showLegend && rawSeries.length > 0) {
    option.legend = {
      show: true,
      bottom: 8,
      textStyle: {
        fontSize: 11,
        color: '#475569',
      },
      itemWidth: 14,
      itemHeight: 10,
    };
  } else {
    option.legend = { show: false };
  }

  if (isPieOrDonut) {
    const primarySeries = rawSeries[0];
    const pieData = sanitizedCategories.map((cat, idx) => ({
      name: cat,
      value: primarySeries?.data?.[idx] ?? 0,
      itemStyle: {
        color: resolveChartColor(undefined, idx, themeTokens),
      },
    }));

    option.series = [
      {
        name: escapeChartText(primarySeries?.name || chart.title || 'Data'),
        type: 'pie',
        radius: chart.type === 'donut' ? ['40%', '68%'] : '65%',
        center: ['50%', titleText ? '55%' : '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: chart.type === 'donut' ? 4 : 0,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: '{b}: {c}',
          fontSize: 11,
          color: '#334155',
        },
        data: pieData,
      },
    ];
  } else {
    // Cartesian Chart (bar, line, area, combo)
    option.grid = {
      top: titleText ? 45 : 25,
      bottom: showLegend ? 45 : 25,
      left: 45,
      right: 25,
      containLabel: true,
    };

    option.xAxis = {
      type: 'category',
      data: sanitizedCategories,
      name: chart.options?.xAxisTitle ? escapeChartText(chart.options.xAxisTitle) : undefined,
      nameLocation: 'middle',
      nameGap: 24,
      axisLabel: {
        fontSize: 10,
        color: '#64748b',
      },
      axisLine: {
        lineStyle: { color: '#cbd5e1' },
      },
    };

    option.yAxis = {
      type: 'value',
      name: chart.options?.yAxisTitle ? escapeChartText(chart.options.yAxisTitle) : undefined,
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: {
        fontSize: 10,
        color: '#64748b',
      },
      splitLine: {
        lineStyle: {
          color: '#f1f5f9',
          type: 'dashed',
        },
      },
    };

    option.series = rawSeries.map((s, idx) => {
      let seriesType: 'bar' | 'line' = 'bar';
      let hasArea = false;

      if (chart.type === 'line') {
        seriesType = 'line';
      } else if (chart.type === 'area') {
        seriesType = 'line';
        hasArea = true;
      } else if (chart.type === 'combo') {
        if (s.type === 'line') seriesType = 'line';
        else if (s.type === 'area') {
          seriesType = 'line';
          hasArea = true;
        } else {
          seriesType = 'bar';
        }
      }

      if (isArea) hasArea = true;

      const seriesObj: Record<string, any> = {
        name: escapeChartText(s.name || `Series ${idx + 1}`),
        type: seriesType,
        data: s.data.map((val) => (val !== null && isFinite(val) ? val : 0)),
        itemStyle: {
          color: resolveChartColor(s.color, idx, themeTokens),
        },
      };

      if (seriesType === 'bar' && isStacked) {
        seriesObj.stack = 'total';
      }

      if (seriesType === 'line') {
        seriesObj.smooth = isSmooth;
        if (hasArea) {
          seriesObj.areaStyle = {
            opacity: 0.25,
          };
        }
      }

      return seriesObj;
    });
  }

  return option;
}
