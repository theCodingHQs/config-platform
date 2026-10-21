import * as echarts from 'echarts';
import { Resvg } from '@resvg/resvg-js';
import {
  type GridChartDefinition,
  type ChartRenderData,
  buildEChartsOption,
  CHART_LIMITS,
} from '@config-platform/schema';
import { tenantLimitsService } from '../../limits/tenant-limits.js';

export class ChartRenderSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartRenderSecurityError';
  }
}

/**
 * Validates that SVG content is strictly free of malicious executable scripts or tags.
 */
export function assertSvgScriptFree(svg: string): void {
  if (/<script\b/i.test(svg)) {
    throw new ChartRenderSecurityError('Rendered chart SVG contains forbidden <script> element');
  }
  if (/\bon[a-z]+\s*=/i.test(svg)) {
    throw new ChartRenderSecurityError('Rendered chart SVG contains forbidden inline event handlers');
  }
  if (/href\s*=\s*['"]\s*javascript:/i.test(svg)) {
    throw new ChartRenderSecurityError('Rendered chart SVG contains forbidden javascript: URI');
  }
}

export class ChartRenderer {
  /**
   * Renders a chart configuration and its data to pure SVG via Apache ECharts SSR.
   * Completely DOM-free and headless.
   */
  public renderToSvg(
    chart: GridChartDefinition,
    data: ChartRenderData,
    dimensions: { width: number; height: number } = { width: 640, height: 360 },
    themeTokens?: Record<string, string>
  ): string {
    // Validate caps
    for (const s of data.series) {
      if (s.data.length > CHART_LIMITS.MAX_POINTS_PER_SERIES) {
        throw new Error(
          `Series '${s.name}' exceeds maximum limit of ${CHART_LIMITS.MAX_POINTS_PER_SERIES} data points (current: ${s.data.length})`
        );
      }
    }

    const width = Math.max(200, Math.min(dimensions.width, 2400));
    const height = Math.max(150, Math.min(dimensions.height, 1600));
    // The size lets axis titles adapt (shorten, or drop on very short charts) instead of colliding
    const option = buildEChartsOption(chart, data, themeTokens, undefined, { width, height });

    const chartInstance = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width,
      height,
    });

    try {
      chartInstance.setOption(option);
      const svgString = chartInstance.renderToSVGString();
      assertSvgScriptFree(svgString);
      return svgString;
    } finally {
      chartInstance.dispose();
    }
  }

  /**
   * Converts SVG string to PNG Buffer using @resvg/resvg-js (Rust native renderer).
   */
  public renderSvgToPng(svgString: string, targetWidth?: number): Buffer {
    assertSvgScriptFree(svgString);
    const resvg = new Resvg(svgString, {
      fitTo: targetWidth ? { mode: 'width', value: targetWidth } : undefined,
    });
    const rendered = resvg.render();
    return Buffer.from(rendered.asPng());
  }

  /**
   * Renders a chart directly to a PNG buffer.
   */
  public renderToPng(
    chart: GridChartDefinition,
    data: ChartRenderData,
    dimensions: { width: number; height: number } = { width: 640, height: 360 },
    themeTokens?: Record<string, string>
  ): Buffer {
    const svg = this.renderToSvg(chart, data, dimensions, themeTokens);
    return this.renderSvgToPng(svg, dimensions.width);
  }

  /**
   * Renders a chart to PNG while tracking and releasing export concurrency slot.
   */
  public async renderWithSlot(
    tenantId: string,
    chart: GridChartDefinition,
    data: ChartRenderData,
    dimensions: { width: number; height: number } = { width: 640, height: 360 },
    themeTokens?: Record<string, string>
  ): Promise<Buffer> {
    const releaseSlot = await tenantLimitsService.acquireExportSlot(tenantId);
    try {
      return this.renderToPng(chart, data, dimensions, themeTokens);
    } finally {
      releaseSlot();
    }
  }
}

export const chartRenderer = new ChartRenderer();
