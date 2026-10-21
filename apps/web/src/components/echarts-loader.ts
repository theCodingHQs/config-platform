/**
 * Lazily loads a tree-shaken ECharts build for page charts.
 *
 * ECharts is the project's single charting library: the same option builder
 * (@config-platform/schema buildEChartsOption) drives page charts, the grid
 * designer and server-rendered export images. Loading on demand keeps it out of
 * the main bundle for pages without charts.
 */
type EChartsCore = typeof import("echarts/core");

let loader: Promise<EChartsCore> | null = null;

export function loadECharts(): Promise<EChartsCore> {
  if (!loader) {
    loader = Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]).then(([core, charts, components, renderers]) => {
      core.use([
        charts.BarChart,
        charts.LineChart,
        charts.PieChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        components.TitleComponent,
        renderers.SVGRenderer,
      ]);
      return core;
    });
    // Allow a retry if the chunk failed to load (e.g. network blip)
    loader.catch(() => {
      loader = null;
    });
  }
  return loader;
}
