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

const AXIS_LABEL_FONT_SIZE = 10;
const AXIS_NAME_FONT_SIZE = 11;
/** Category labels longer than this are truncated with an ellipsis. */
const AXIS_LABEL_MAX_WIDTH = 100;
/** Gap between an axis title and the axis labels. */
const AXIS_NAME_MARGIN = 8;
/** Axis title lengths when the chart size is unknown (sized for typical 280–360px charts). */
const AXIS_TITLE_MAX_WIDTH_Y = 180;
const AXIS_TITLE_MAX_WIDTH_X = 360;
/** Below this height (px) axis titles are omitted: there's no room beside the labels. */
export const AXIS_TITLES_MIN_HEIGHT = 240;

/** The parts of a chart definition the option builder reads (grid charts satisfy it). */
export type ChartRenderSpec = Pick<GridChartDefinition, 'type' | 'title'> & {
  options?: GridChartDefinition['options'];
};

/**
 * Neutral colours for text, axes and grid lines. Defaults suit a light background
 * (server-rendered export images); live UI charts pass theme values so dark mode works.
 */
export interface ChartAppearance {
  title: string;
  text: string;
  legendText: string;
  mutedText: string;
  axisLine: string;
  splitLine: string;
  /** Slice separator colour for pie/donut; should match the chart background. */
  background: string;
  fontFamily?: string;
  /**
   * Multiplies every chart font size (and the spacing that holds the text), so live charts
   * follow the theme's Text Size. 1 = the export sizes (title 14px, axis labels 10px).
   */
  fontScale?: number;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  title: '#1e293b',
  text: '#334155',
  legendText: '#475569',
  mutedText: '#64748b',
  axisLine: '#cbd5e1',
  splitLine: '#f1f5f9',
  background: '#ffffff',
};

/**
 * Builds a deterministic Apache ECharts option configuration object.
 * Used identically by the server SSR exporter, grid designer and page chart component.
 */
export function buildEChartsOption(
  chart: ChartRenderSpec,
  data: ChartRenderData,
  themeTokens?: Record<string, string>,
  appearance: ChartAppearance = DEFAULT_CHART_APPEARANCE,
  /** Rendered size in px, when known; lets axis titles adapt so they never collide. */
  size?: { width: number; height: number }
): Record<string, any> {
  const isPieOrDonut = chart.type === 'pie' || chart.type === 'donut';
  const titleText = escapeChartText(chart.title);
  const showLegend = chart.options?.legend !== false;
  const isStacked = Boolean(chart.options?.stacked);
  const isSmooth = Boolean(chart.options?.smooth);
  const isArea = Boolean(chart.options?.area);

  // Font sizes and the room kept for text, scaled by the theme text size (rounded to 0.5px)
  const fontScale = appearance.fontScale && appearance.fontScale > 0 ? appearance.fontScale : 1;
  const scaled = (px: number) => Math.round(px * fontScale * 2) / 2;

  const sanitizedCategories = (data.categories || []).map((cat) => escapeChartText(cat));
  const rawSeries = data.series || [];

  // Determine series colors
  const seriesColors = rawSeries.map((s, idx) => resolveChartColor(s.color, idx, themeTokens));

  const option: Record<string, any> = {
    animation: false, // SSR renders instantly
    color: seriesColors.length > 0 ? seriesColors : DEFAULT_CHART_PALETTE,
  };
  if (appearance.fontFamily) {
    option.textStyle = { fontFamily: appearance.fontFamily };
  }

  if (titleText) {
    option.title = {
      text: titleText,
      left: 'center',
      top: 10,
      textStyle: {
        fontSize: scaled(14),
        fontWeight: 600,
        color: appearance.title,
      },
    };
  }

  if (showLegend && rawSeries.length > 0) {
    option.legend = {
      show: true,
      bottom: 8,
      textStyle: {
        fontSize: scaled(11),
        color: appearance.legendText,
      },
      itemWidth: scaled(14),
      itemHeight: scaled(10),
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
        color: resolveChartColor(chart.options?.sliceColors?.[idx], idx, themeTokens),
      },
    }));

    option.series = [
      {
        // Stable ids let a live data update (setOption with replaceMerge) morph the existing
        // series instead of removing and re-adding it, which would replay the entry animation
        id: 'series-0',
        name: escapeChartText(primarySeries?.name || chart.title || 'Data'),
        type: 'pie',
        radius: chart.type === 'donut' ? ['40%', '68%'] : '65%',
        center: ['50%', titleText ? '55%' : '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: chart.type === 'donut' ? 4 : 0,
          borderColor: appearance.background,
          borderWidth: 2,
        },
        label: {
          show: true,
          // Same as the Excel export: values only when the legend names the slices
          formatter: showLegend ? '{c}' : '{b}: {c}',
          fontSize: scaled(11),
          color: appearance.text,
        },
        data: pieData,
      },
    ];
  } else {
    // Cartesian Chart (bar, line, area, combo)
    // Too short a chart can't fit axis titles next to its labels without squashing the plot,
    // so titles are dropped below AXIS_TITLES_MIN_HEIGHT rather than drawn over the labels.
    const roomForAxisTitles = !size || size.height >= AXIS_TITLES_MIN_HEIGHT;
    const xAxisTitle = roomForAxisTitles && chart.options?.xAxisTitle ? escapeChartText(chart.options.xAxisTitle) : undefined;
    const yAxisTitle = roomForAxisTitles && chart.options?.yAxisTitle ? escapeChartText(chart.options.yAxisTitle) : undefined;
    // Every category label is shown (ECharts would otherwise skip some); crowded axes tilt
    // their labels and long labels are truncated so the layout stays bounded.
    const rotateLabels = (data.categories || []).length > 5;

    // Layout is measured by ECharts, not estimated: the grid edges are the outer bounds and
    // the plot shrinks until axis labels AND axis titles fit inside them ('all'), while
    // nameMoveOverlap pushes each title past its axis' measured labels. This holds for any
    // label length, number format (decimals, thousands, negatives) or rotation.
    option.grid = {
      top: titleText ? scaled(45) : 16,
      bottom: showLegend ? scaled(40) : 12,
      left: 12,
      right: 24,
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
      // Never stop shrinking the plot before labels and titles fit: in small charts a
      // smaller plot is better than titles drawn over the labels
      outerBoundsClampWidth: 0,
      outerBoundsClampHeight: 0,
    };

    const nameTextStyle = {
      fontSize: scaled(AXIS_NAME_FONT_SIZE),
      fontWeight: 500,
      color: appearance.text,
      // Space kept between a title and the (possibly rotated) labels it is moved past
      textMargin: AXIS_NAME_MARGIN,
    };
    const AXIS_NAME_GAP = AXIS_NAME_MARGIN;

    // A title longer than its axis can't be placed without colliding: shorten it with "…".
    // The Y title runs along the chart height, the X title along its width.
    const yTitleMaxWidth = size ? Math.max(60, size.height - 70) : AXIS_TITLE_MAX_WIDTH_Y;
    const xTitleMaxWidth = size ? Math.max(80, size.width - 80) : AXIS_TITLE_MAX_WIDTH_X;

    option.xAxis = {
      type: 'category',
      data: sanitizedCategories,
      name: xAxisTitle,
      nameLocation: 'middle',
      nameGap: AXIS_NAME_GAP,
      nameMoveOverlap: true,
      nameTruncate: { maxWidth: xTitleMaxWidth, ellipsis: '…' },
      nameTextStyle,
      axisLabel: {
        fontSize: scaled(AXIS_LABEL_FONT_SIZE),
        color: appearance.mutedText,
        interval: 0,
        rotate: rotateLabels ? 30 : 0,
        width: scaled(AXIS_LABEL_MAX_WIDTH),
        overflow: 'truncate',
      },
      axisLine: {
        lineStyle: { color: appearance.axisLine },
      },
    };

    option.yAxis = {
      type: 'value',
      name: yAxisTitle,
      nameLocation: 'middle',
      nameGap: AXIS_NAME_GAP,
      nameMoveOverlap: true,
      nameTruncate: { maxWidth: yTitleMaxWidth, ellipsis: '…' },
      nameTextStyle,
      axisLabel: {
        fontSize: scaled(AXIS_LABEL_FONT_SIZE),
        color: appearance.mutedText,
      },
      splitLine: {
        lineStyle: {
          color: appearance.splitLine,
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
        id: `series-${idx}`,
        name: escapeChartText(s.name || `Series ${idx + 1}`),
        type: seriesType,
        data: s.data.map((val) => (val !== null && isFinite(val) ? val : 0)),
        itemStyle: {
          color: resolveChartColor(s.color, idx, themeTokens),
        },
      };

      // Mirror the native Excel export: "stacked" stacks bars, lines and areas, each within its
      // own group (Excel stacks per chart group), and area series are never smoothed (Excel area
      // charts can't be), so what the designer shows is what Excel draws.
      if (isStacked) {
        seriesObj.stack = `total-${hasArea ? 'area' : seriesType}`;
      }

      if (seriesType === 'line') {
        seriesObj.smooth = isSmooth && !hasArea;
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
