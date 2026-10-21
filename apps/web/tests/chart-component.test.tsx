import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ErdTable } from '@config-platform/schema';
import * as schema from '@config-platform/schema';
import { buildEChartsOption, DEFAULT_CHART_APPEARANCE, AXIS_TITLES_MIN_HEIGHT, formatPlainDate, type DateDisplayPrefs } from '@config-platform/schema';
import { defaultChartAxisTitles } from '../src/components/chart-axis-titles';
import { MetadataProvider } from '../src/context/metadata-context';
import { PageRuntimeProvider } from '../src/context/page-runtime-context';
import { DateDisplayProvider } from '../src/context/date-display-context';
import { ChartComponent } from '../src/components/chart';
import * as apiClient from '../src/api/client';

const entities: ErdTable[] = [{
  id: 't_machine',
  name: 'machine',
  label: 'Machine',
  physicalTableName: 't_machine',
  version: 1,
  columns: [
    { id: 'c_line', name: 'line', label: 'Line', physicalColumnName: 'c_line', type: 'text', required: false, unique: false, isPrimary: false, position: 0, isForeignKey: false, config: {} },
    { id: 'c_output', name: 'output', label: 'Output', physicalColumnName: 'c_output', type: 'number', required: false, unique: false, isPrimary: false, position: 1, isForeignKey: false, config: {} },
    { id: 'c_month', name: 'month', label: 'Month', physicalColumnName: 'c_month', type: 'date', required: false, unique: false, isPrimary: false, position: 2, isForeignKey: false, config: {} },
  ],
}];

function renderChart(props: Partial<React.ComponentProps<typeof ChartComponent>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MetadataProvider tenantId="t" initialEntities={entities}>
        <ChartComponent entityId="t_machine" groupByFieldId="c_line" aggregateOp="sum" aggregateFieldId="c_output" title="Output by line" type="bar" {...props} />
      </MetadataProvider>
    </QueryClientProvider>,
  );
}

describe('Page chart component (ECharts)', () => {
  it('charts totals calculated by the server over all records, as an accessible data table', async () => {
    const spy = vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({
      groups: [{ key: 'A', value: 15 }, { key: 'B', value: 7 }],
      groupsTruncated: false,
    });

    renderChart();

    const table = await screen.findByTestId('chart-data-table');
    const rows = within(table).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows).toEqual(['A15', 'B7']);
    expect(screen.getByTestId('chart-plot')).toHaveAttribute('aria-label', 'Output by line: 2 categories');
    // Grouped and summed on the server (no record limit), not from a loaded page of rows
    expect(spy).toHaveBeenCalledWith('t_machine', { op: 'sum', field: 'output', groupBy: 'line', filter: undefined });
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it('a chart bound to a page data source totals every record matching the source filters', async () => {
    // The data source loads one page of 10 rows for a table; the chart must not total just those
    vi.spyOn(apiClient, 'fetchRecords').mockResolvedValue({ data: [{ id: '1', line: 'A', output: 1 }], nextCursor: 'more' } as any);
    const spy = vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({
      groups: [{ key: 'A', value: 1200 }], groupsTruncated: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId="t" initialEntities={entities}>
          <PageRuntimeProvider
            tenantId="t"
            page={{
              schemaVersion: 2, id: 'p', version: 1, route: '/p',
              state: { line: 'A', search: '' },
              dataSources: [{ id: 'ds_lines', entityId: 't_machine', limit: 10, filter: { line: '{{ state.line }}', name: { contains: '{{ state.search }}' } } }],
              root: { id: 'r', type: 'stack', props: {}, children: [] },
            } as any}
          >
            <ChartComponent source="ds_lines" groupByFieldId="c_line" aggregateOp="sum" aggregateFieldId="c_output" title="Output" type="bar" />
          </PageRuntimeProvider>
        </MetadataProvider>
      </QueryClientProvider>,
    );
    const table = await screen.findByTestId('chart-data-table');
    expect(within(table).getAllByRole('row')[1].textContent).toBe('A1200');
    // Same entity and resolved filters as the data source (the empty search is dropped)
    expect(spy).toHaveBeenCalledWith('t_machine', { op: 'sum', field: 'output', groupBy: 'line', filter: { line: 'A' } });
  });

  it('counts without a field, and says when the server returned only the first groups', async () => {
    const spy = vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({
      groups: Array.from({ length: 50 }, (_, i) => ({ key: `L${i}`, value: i })),
      groupsTruncated: true,
    });
    renderChart({ aggregateOp: 'count', aggregateFieldId: undefined });
    await screen.findByTestId('chart-data-table');
    expect(spy).toHaveBeenCalledWith('t_machine', expect.objectContaining({ op: 'count', field: undefined, groupBy: 'line' }));
    expect(screen.getByText(/Showing the first 50 groups/)).toBeInTheDocument();
  });

  it('shows an optional icon before the title', async () => {
    vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({ groups: [{ key: 'A', value: 1 }], groupsTruncated: false });
    const { container } = renderChart({ icon: 'Factory' });
    const title = await screen.findByTestId('chart-title');
    expect(title).toHaveTextContent('Output by line');
    expect(title.querySelector('svg')).not.toBeNull();
    cleanup();
    renderChart();
    expect((await screen.findByTestId('chart-title')).querySelector('svg')).toBeNull();
    expect(container).toBeTruthy();
  });

  it('labels date groups as dates in time order, in the viewer date format', async () => {
    // The API sends calendar dates as written ("2026-10-01"), here out of order
    vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({
      groups: [{ key: '2026-10-01', value: 2 }, { key: '2026-09-01', value: 5 }, { key: '2026-08-01', value: 1 }],
      groupsTruncated: false,
    });
    const labelsFor = async (prefs?: DateDisplayPrefs) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MetadataProvider tenantId="t" initialEntities={entities}>
            <DateDisplayProvider value={prefs ?? {}}>
              <ChartComponent entityId="t_machine" groupByFieldId="c_month" aggregateOp="sum" aggregateFieldId="c_output" title="By month" type="bar" />
            </DateDisplayProvider>
          </MetadataProvider>
        </QueryClientProvider>,
      );
      const table = await screen.findByTestId('chart-data-table');
      const labels = within(table).getAllByRole('row').slice(1).map((row) => (row as HTMLTableRowElement).cells[0].textContent);
      cleanup();
      return labels;
    };
    expect(await labelsFor()).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'].map((d) => formatPlainDate(d)));
    expect(await labelsFor({ dateFormat: 'DD/MM/YYYY' })).toEqual(['01/08/2026', '01/09/2026', '01/10/2026']);
  });

  it('labels a Month field by month', async () => {
    vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({ groups: [{ key: '2026-10-01', value: 2 }], groupsTruncated: false });
    const monthEntities = [{ ...entities[0], columns: entities[0].columns.map((c) => (c.id === 'c_month' ? { ...c, config: { granularity: 'month' } } : c)) }];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MetadataProvider tenantId="t" initialEntities={monthEntities as any}>
          <DateDisplayProvider value={{ locale: 'en-US' }}>
            <ChartComponent entityId="t_machine" groupByFieldId="c_month" aggregateOp="count" title="By month" type="bar" />
          </DateDisplayProvider>
        </MetadataProvider>
      </QueryClientProvider>,
    );
    const table = await screen.findByTestId('chart-data-table');
    expect((within(table).getAllByRole('row')[1] as HTMLTableRowElement).cells[0].textContent).toBe('Oct 2026');
  });

  it('shows an empty state when there is no data', async () => {
    vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({ groups: [], groupsTruncated: false });
    renderChart();
    await waitFor(() => expect(screen.getByText('No data available')).toBeInTheDocument());
    expect(screen.queryByTestId('chart-plot')).not.toBeInTheDocument();
  });

  it('derives automatic axis titles from the fields', () => {
    expect(defaultChartAxisTitles('Line', 'count', undefined)).toEqual({ x: 'Line', y: 'Number of records' });
    expect(defaultChartAxisTitles('Line', 'sum', 'Output')).toEqual({ x: 'Line', y: 'Total Output' });
    expect(defaultChartAxisTitles('Line', 'avg', 'Output').y).toBe('Average Output');
    expect(defaultChartAxisTitles(undefined, 'max', 'Output')).toEqual({ x: 'Category', y: 'Maximum Output' });
  });

  it('option builder shows every label, tilts crowded axes and keeps axis titles clear of labels', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => `Machine ${c}`);
    const option = buildEChartsOption(
      { type: 'bar', title: '', options: { xAxisTitle: 'Machine', yAxisTitle: 'Days' } },
      { categories: many, series: [{ name: 'Days', data: [1, 2, 3, 4, 5, 1250000] }] },
    );
    expect(option.xAxis.axisLabel).toMatchObject({ interval: 0, rotate: 30, overflow: 'truncate' });
    expect(option.xAxis.name).toBe('Machine');
    expect(option.xAxis.nameTextStyle.color).toBe(DEFAULT_CHART_APPEARANCE.text);
    // Layout is measured by ECharts: titles move past the real labels and everything is
    // kept inside the chart, whatever the label lengths or number formats
    for (const axis of [option.xAxis, option.yAxis]) {
      expect(axis.nameMoveOverlap).toBe(true);
      expect(axis.nameTextStyle.textMargin).toBeGreaterThan(0);
    }
    expect(option.grid).toMatchObject({ outerBoundsMode: 'same', outerBoundsContain: 'all' });
    expect(option.grid.containLabel).toBeUndefined();

    const short = buildEChartsOption(
      { type: 'bar', title: '', options: { yAxisTitle: 'Days' } },
      { categories: ['A'], series: [{ name: 'Days', data: [5] }] },
    );
    expect(short.xAxis.axisLabel.rotate).toBe(0);
  });

  it('adapts axis titles to the chart size: shortened to fit, omitted on very short charts', () => {
    const longTitles = { xAxisTitle: 'Fiscal quarter of the current reporting year', yAxisTitle: 'Average attainment percentage across all lines' };
    const data = { categories: ['Q1', 'Q2'], series: [{ name: 'S', data: [1, 2] }] };

    const sized = buildEChartsOption({ type: 'bar', title: '', options: longTitles }, data, undefined, undefined, { width: 360, height: 280 });
    expect(sized.yAxis.nameTruncate.maxWidth).toBe(210); // runs along the 280px height
    expect(sized.xAxis.nameTruncate.maxWidth).toBe(280); // runs along the 360px width

    const tiny = buildEChartsOption({ type: 'bar', title: '', options: longTitles }, data, undefined, undefined, { width: 360, height: AXIS_TITLES_MIN_HEIGHT - 1 });
    expect(tiny.xAxis.name).toBeUndefined();
    expect(tiny.yAxis.name).toBeUndefined();
  });

  it('page chart passes custom or automatic axis titles, or none when turned off', async () => {
    vi.spyOn(apiClient, 'fetchAggregateGroups').mockResolvedValue({ groups: [{ key: 'A', value: 3 }], groupsTruncated: false });
    const spy = vi.spyOn(schema, 'buildEChartsOption');

    renderChart();
    await screen.findByTestId('chart-data-table');
    expect(spy.mock.calls.at(-1)![0].options).toMatchObject({ xAxisTitle: 'Line', yAxisTitle: 'Total Output' });
    cleanup();

    renderChart({ xAxisTitle: 'Production line', yAxisTitle: 'Units' });
    await screen.findByTestId('chart-data-table');
    expect(spy.mock.calls.at(-1)![0].options).toMatchObject({ xAxisTitle: 'Production line', yAxisTitle: 'Units' });
    cleanup();

    renderChart({ showAxisTitles: false });
    await screen.findByTestId('chart-data-table');
    expect(spy.mock.calls.at(-1)![0].options?.xAxisTitle).toBeUndefined();
    expect(spy.mock.calls.at(-1)![0].options?.yAxisTitle).toBeUndefined();
    spy.mockRestore();
  });

  it('draws charts the way the native Excel export does (smoothing, stacking, donut labels)', () => {
    const data = { categories: ['A', 'B'], series: [{ name: 'S1', data: [1, 2] }, { name: 'S2', data: [3, 4] }] };
    // Excel area charts can't be smoothed, so the designer draws areas straight too
    const area = buildEChartsOption({ type: 'area', title: '', options: { smooth: true } }, data);
    expect(area.series.every((s: any) => s.smooth === false && s.areaStyle)).toBe(true);
    const lineArea = buildEChartsOption({ type: 'line', title: '', options: { smooth: true, area: true } }, data);
    expect(lineArea.series[0].smooth).toBe(false);
    // Lines can be smoothed in Excel (<c:smooth val="1"/>)
    expect(buildEChartsOption({ type: 'line', title: '', options: { smooth: true } }, data).series[0].smooth).toBe(true);

    // Excel stacks lines and areas too, each within its own group
    const stackedLine = buildEChartsOption({ type: 'line', title: '', options: { stacked: true } }, data);
    expect(stackedLine.series.map((s: any) => s.stack)).toEqual(['total-line', 'total-line']);
    const combo = buildEChartsOption(
      { type: 'combo', title: '', options: { stacked: true } },
      { categories: ['A'], series: [{ name: 'B', data: [1], type: 'bar' }, { name: 'L', data: [2], type: 'line' }] },
    );
    expect(combo.series.map((s: any) => s.stack)).toEqual(['total-bar', 'total-line']);

    // Donut labels: values only while the legend names the slices (as in Excel)
    const donutData = { categories: ['Met', 'Missed'], series: [{ name: 'D', data: [94, 94] }] };
    expect(buildEChartsOption({ type: 'donut', title: '', options: { legend: true } }, donutData).series[0].label.formatter).toBe('{c}');
    expect(buildEChartsOption({ type: 'donut', title: '', options: { legend: false } }, donutData).series[0].label.formatter).toBe('{b}: {c}');
  });

  it('shared option builder applies UI appearance and keeps export defaults unchanged', () => {
    const data = { categories: ['A'], series: [{ name: 'Output', data: [1] }] };
    const exportOption = buildEChartsOption({ type: 'bar', title: 'T' }, data);
    expect(exportOption.title.textStyle.color).toBe(DEFAULT_CHART_APPEARANCE.title);
    expect(exportOption.textStyle).toBeUndefined();

    const dark = { ...DEFAULT_CHART_APPEARANCE, title: '#f8fafc', mutedText: '#94a3b8', fontFamily: 'Inter' };
    const uiOption = buildEChartsOption({ type: 'bar', title: 'T' }, data, undefined, dark);
    expect(uiOption.title.textStyle.color).toBe('#f8fafc');
    expect(uiOption.xAxis.axisLabel.color).toBe('#94a3b8');
    expect(uiOption.textStyle).toEqual({ fontFamily: 'Inter' });
  });

  it('chart text follows the theme text size through the appearance font scale', () => {
    const chart = { type: 'bar' as const, title: 'T', options: { xAxisTitle: 'X', yAxisTitle: 'Y' } };
    const data = { categories: ['A'], series: [{ name: 'Output', data: [1] }] };
    const fonts = (o: any) => [
      o.title.textStyle.fontSize, o.legend.textStyle.fontSize, o.xAxis.axisLabel.fontSize,
      o.yAxis.axisLabel.fontSize, o.xAxis.nameTextStyle.fontSize,
    ];
    // Exports keep their sizes; the largest theme text size (18px vs 14px) scales every font
    expect(fonts(buildEChartsOption(chart, data))).toEqual([14, 11, 10, 10, 11]);
    const large = buildEChartsOption(chart, data, undefined, { ...DEFAULT_CHART_APPEARANCE, fontScale: 18 / 14 });
    expect(fonts(large)).toEqual([18, 14, 13, 13, 14]);
    // Room for the larger title and legend grows with them
    expect(large.grid.top).toBeGreaterThan(45);
    expect(large.grid.bottom).toBeGreaterThan(40);
  });

  it('a live data update keeps the drawn series, so only the changed points animate', async () => {
    const echarts = await import('echarts');
    for (const type of ['bar', 'line', 'area', 'donut'] as const) {
      const chart = { type, title: '', options: { stacked: true } };
      const instance = echarts.init(null as any, undefined, { renderer: 'svg', ssr: true, width: 400, height: 300 });
      const option = (v: number) =>
        buildEChartsOption(chart, { categories: ['A', 'B'], series: [{ name: 'W1', data: [1, v] }, { name: 'W2', data: [3, 4] }] });
      instance.setOption(option(2), { notMerge: true });
      const before = (instance as any).getModel().getSeriesByIndex(0);
      // Same call the grid designer and page charts make when only the data changed
      instance.setOption(option(5), { replaceMerge: ['series'] });
      // Series without stable ids are removed and re-added, which replays the entry animation
      expect((instance as any).getModel().getSeriesByIndex(0)).toBe(before);
      instance.dispose();
    }
  });
});
