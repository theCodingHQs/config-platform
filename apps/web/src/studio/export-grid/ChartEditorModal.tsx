import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import {
  X,
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  Layers,
  Palette,
  Check,
  Plus,
  Trash2,
  Maximize2,
  Table,
  Database,
} from 'lucide-react';
import {
  type GridChartDefinition,
  type ChartType,
  type GridDatasetDefinition,
  type GridSheetDefinition,
  type ChartRenderData,
  buildEChartsOption,
  DEFAULT_CHART_PALETTE,
  THEME_TOKEN_COLORS,
  CHART_LIMITS,
} from '@config-platform/schema';

export interface ChartEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (chart: GridChartDefinition) => void;
  initialChart?: GridChartDefinition | null;
  datasets: GridDatasetDefinition[];
  sheets: GridSheetDefinition[];
  selectedRange?: {
    sheetId: string;
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
  themeTokens?: Record<string, string>;
  sheetCellReader?: (sheetId: string, rangeA1: string) => (string | number | null)[];
}

const CHART_TYPES: Array<{
  type: ChartType;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  description: string;
}> = [
  { type: 'bar', label: 'Bar', icon: BarChart3, description: 'Compare categories side-by-side' },
  { type: 'line', label: 'Line', icon: LineChart, description: 'Display trends and series over time' },
  { type: 'area', label: 'Area', icon: AreaChart, description: 'Trend line with filled volume area' },
  { type: 'pie', label: 'Pie', icon: PieChart, description: 'Proportional division of a whole' },
  { type: 'donut', label: 'Donut', icon: PieChart, description: 'Hollow ring breakdown of values' },
  { type: 'combo', label: 'Combo', icon: Layers, description: 'Mix bar and line series on one axis' },
];

export function ChartEditorModal({
  isOpen,
  onClose,
  onSave,
  initialChart,
  datasets,
  sheets,
  selectedRange,
  themeTokens,
  sheetCellReader,
}: ChartEditorModalProps) {
  if (!isOpen) return null;

  const defaultSheetId = sheets[0]?.id || 'sheet_0';

  // ─── Form State ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(initialChart?.title || 'Metric Overview');
  const [chartType, setChartType] = useState<ChartType>(initialChart?.type || 'bar');
  const [sourceKind, setSourceKind] = useState<'range' | 'dataset'>(
    initialChart?.source.kind || (datasets.length > 0 ? 'dataset' : 'range')
  );

  // Range-specific state
  const [rangeSheetId, setRangeSheetId] = useState<string>(
    initialChart?.source.kind === 'range' ? initialChart.source.sheetId : defaultSheetId
  );
  const [categoryRange, setCategoryRange] = useState<string>(
    initialChart?.source.kind === 'range' ? initialChart.source.categoryRange || 'A2:A7' : 'A2:A7'
  );
  const [rangeSeries, setRangeSeries] = useState<
    Array<{ id: string; name: string; range: string; color: string; type?: 'bar' | 'line' | 'area' }>
  >(
    initialChart?.source.kind === 'range'
      ? initialChart.source.series.map((s, idx) => ({
          id: `s_${idx}`,
          name: s.name,
          range: s.range,
          color: s.color || DEFAULT_CHART_PALETTE[idx % DEFAULT_CHART_PALETTE.length],
          type: s.type,
        }))
      : [
          {
            id: 's_0',
            name: 'Series 1',
            range: 'B2:B7',
            color: DEFAULT_CHART_PALETTE[0],
            type: 'bar',
          },
        ]
  );

  // Dataset-specific state
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
    initialChart?.source.kind === 'dataset'
      ? initialChart.source.datasetId
      : datasets[0]?.id || ''
  );
  const [datasetCategory, setDatasetCategory] = useState<string>(
    initialChart?.source.kind === 'dataset'
      ? typeof initialChart.source.category === 'string'
        ? initialChart.source.category
        : initialChart.source.category.fieldId
      : ''
  );
  const [datasetSeries, setDatasetSeries] = useState<
    Array<{
      id: string;
      fieldId?: string;
      aggregateId?: string;
      name: string;
      color: string;
      type?: 'bar' | 'line' | 'area';
    }>
  >(
    initialChart?.source.kind === 'dataset'
      ? initialChart.source.series.map((s, idx) => ({
          id: `ds_s_${idx}`,
          fieldId: s.fieldId,
          aggregateId: s.aggregateId,
          name: s.name || s.fieldId || s.aggregateId || `Series ${idx + 1}`,
          color: s.color || DEFAULT_CHART_PALETTE[idx % DEFAULT_CHART_PALETTE.length],
          type: s.type,
        }))
      : []
  );

  // Anchor state
  const [anchorSheetId, setAnchorSheetId] = useState(
    initialChart?.anchor.sheetId || selectedRange?.sheetId || defaultSheetId
  );
  const [startRow, setStartRow] = useState(
    initialChart?.anchor.startRow ?? selectedRange?.startRow ?? 1
  );
  const [startCol, setStartCol] = useState(
    initialChart?.anchor.startCol ?? selectedRange?.startCol ?? 4
  );
  const [endRow, setEndRow] = useState(
    initialChart?.anchor.endRow ?? selectedRange?.endRow ?? 13
  );
  const [endCol, setEndCol] = useState(
    initialChart?.anchor.endCol ?? selectedRange?.endCol ?? 12
  );

  // Options
  const [showLegend, setShowLegend] = useState(initialChart?.options?.legend !== false);
  const [isStacked, setIsStacked] = useState(Boolean(initialChart?.options?.stacked));
  const [isSmooth, setIsSmooth] = useState(Boolean(initialChart?.options?.smooth));
  const [xAxisTitle, setXAxisTitle] = useState(initialChart?.options?.xAxisTitle || '');
  const [yAxisTitle, setYAxisTitle] = useState(initialChart?.options?.yAxisTitle || '');

  const [formError, setFormError] = useState<string | null>(null);

  // Active dataset reference
  const currentDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId),
    [datasets, selectedDatasetId]
  );

  // Populate initial dataset category and series if switching to dataset mode or empty
  useEffect(() => {
    if (currentDataset) {
      if (!datasetCategory) {
        const firstField = currentDataset.fields?.[0]?.id || currentDataset.fields?.[0]?.name;
        if (firstField) setDatasetCategory(firstField);
      }
      if (datasetSeries.length === 0) {
        const numericField =
          currentDataset.aggregates?.[0]?.id ||
          currentDataset.fields?.[1]?.id ||
          currentDataset.fields?.[0]?.id;
        if (numericField) {
          const isAgg = currentDataset.aggregates?.some((a) => a.id === numericField);
          setDatasetSeries([
            {
              id: 'ds_s_0',
              fieldId: isAgg ? undefined : numericField,
              aggregateId: isAgg ? numericField : undefined,
              name: isAgg ? 'Total' : 'Metric',
              color: DEFAULT_CHART_PALETTE[0],
              type: 'bar',
            },
          ]);
        }
      }
    }
  }, [currentDataset, datasetCategory, datasetSeries.length]);

  // Preview DOM ref
  const chartPreviewRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  // ─── Generate Preview Data ─────────────────────────────────────────────────
  const previewData: ChartRenderData = useMemo(() => {
    if (sourceKind === 'range') {
      let categories: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
      if (sheetCellReader && categoryRange) {
        try {
          const read = sheetCellReader(rangeSheetId, categoryRange);
          if (read && read.length > 0) {
            categories = read.map((v) => (v !== null && v !== undefined ? String(v) : ''));
          }
        } catch {
          // fallback to mock categories
        }
      }

      const series = rangeSeries.map((s, idx) => {
        let values: (number | null)[] = [120, 200, 150, 80, 70, 110];
        if (sheetCellReader && s.range) {
          try {
            const read = sheetCellReader(rangeSheetId, s.range);
            if (read && read.length > 0) {
              values = read.map((v) => {
                const n = Number(v);
                return isFinite(n) ? n : 0;
              });
            }
          } catch {
            // fallback to mock series
          }
        }
        return {
          name: s.name || `Series ${idx + 1}`,
          data: values,
          color: s.color,
          type: s.type,
        };
      });

      return { categories, series };
    } else {
      // Dataset preview data
      const categories = ['North', 'South', 'East', 'West', 'Central'];
      const series = datasetSeries.map((s, idx) => ({
        name: s.name || `Metric ${idx + 1}`,
        data: [
          100 + idx * 30,
          180 + idx * 45,
          140 + idx * 25,
          220 + idx * 50,
          95 + idx * 20,
        ],
        color: s.color,
        type: s.type,
      }));
      return { categories, series };
    }
  }, [
    sourceKind,
    categoryRange,
    rangeSheetId,
    rangeSeries,
    datasetSeries,
    sheetCellReader,
  ]);

  // ─── Render Live ECharts in Modal ──────────────────────────────────────────
  useEffect(() => {
    if (!chartPreviewRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartPreviewRef.current);
    }

    const tempChartDef: GridChartDefinition = {
      id: initialChart?.id || 'temp_preview',
      title,
      type: chartType,
      source:
        sourceKind === 'range'
          ? {
              kind: 'range',
              sheetId: rangeSheetId,
              categoryRange,
              series: rangeSeries.map((s) => ({
                name: s.name,
                range: s.range,
                color: s.color,
                type: s.type,
              })),
            }
          : {
              kind: 'dataset',
              datasetId: selectedDatasetId,
              category: datasetCategory,
              series: datasetSeries.map((s) => ({
                fieldId: s.fieldId,
                aggregateId: s.aggregateId,
                name: s.name,
                color: s.color,
                type: s.type,
              })),
            },
      anchor: {
        sheetId: anchorSheetId,
        startRow,
        startCol,
        endRow,
        endCol,
      },
      options: {
        legend: showLegend,
        stacked: isStacked,
        smooth: isSmooth,
        xAxisTitle: xAxisTitle.trim() || undefined,
        yAxisTitle: yAxisTitle.trim() || undefined,
      },
    };

    const option = buildEChartsOption(tempChartDef, previewData, themeTokens);
    option.animation = true; // smooth preview transitions
    chartInstanceRef.current.setOption(option, true);

    const handleResize = () => chartInstanceRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [
    title,
    chartType,
    sourceKind,
    rangeSheetId,
    categoryRange,
    rangeSeries,
    selectedDatasetId,
    datasetCategory,
    datasetSeries,
    anchorSheetId,
    startRow,
    startCol,
    endRow,
    endCol,
    showLegend,
    isStacked,
    isSmooth,
    xAxisTitle,
    yAxisTitle,
    previewData,
    themeTokens,
    initialChart?.id,
  ]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // ─── Actions & Handlers ────────────────────────────────────────────────────
  const handleApplyCurrentSelectionAsAnchor = () => {
    if (selectedRange) {
      setAnchorSheetId(selectedRange.sheetId);
      setStartRow(selectedRange.startRow);
      setStartCol(selectedRange.startCol);
      setEndRow(Math.max(selectedRange.startRow + 8, selectedRange.endRow));
      setEndCol(Math.max(selectedRange.startCol + 6, selectedRange.endCol));
    }
  };

  const handleApplyCurrentSelectionAsRange = () => {
    if (selectedRange) {
      const colToLetter = (c: number) => String.fromCharCode(65 + c);
      const startCell = `${colToLetter(selectedRange.startCol)}${selectedRange.startRow + 1}`;
      const endCell = `${colToLetter(selectedRange.startCol)}${selectedRange.endRow + 1}`;
      setCategoryRange(`${startCell}:${endCell}`);

      if (selectedRange.endCol > selectedRange.startCol) {
        const seriesStartCell = `${colToLetter(selectedRange.startCol + 1)}${selectedRange.startRow + 1}`;
        const seriesEndCell = `${colToLetter(selectedRange.endCol)}${selectedRange.endRow + 1}`;
        setRangeSeries([
          {
            id: 's_0',
            name: 'Series 1',
            range: `${seriesStartCell}:${seriesEndCell}`,
            color: DEFAULT_CHART_PALETTE[0],
            type: 'bar',
          },
        ]);
      }
    }
  };

  const handleSave = () => {
    setFormError(null);

    if (!title.trim()) {
      setFormError('Chart title is required');
      return;
    }
    if (title.length > CHART_LIMITS.MAX_TITLE_LENGTH) {
      setFormError(`Chart title exceeds max limit of ${CHART_LIMITS.MAX_TITLE_LENGTH} characters`);
      return;
    }

    if (sourceKind === 'range') {
      if (rangeSeries.length === 0) {
        setFormError('At least one series range must be specified');
        return;
      }
      for (const s of rangeSeries) {
        if (!s.range.trim()) {
          setFormError(`Series '${s.name}' range cannot be empty (e.g. B2:B12)`);
          return;
        }
      }
    } else {
      if (!selectedDatasetId) {
        setFormError('Please select a dataset');
        return;
      }
      if (!datasetCategory) {
        setFormError('Please select a category field');
        return;
      }
      if (datasetSeries.length === 0) {
        setFormError('At least one series field/aggregate must be selected');
        return;
      }
    }

    if (startRow >= endRow || startCol >= endCol) {
      setFormError('Anchor end coordinates must be greater than start coordinates');
      return;
    }

    const chartId = initialChart?.id || `ch_${Date.now()}`;
    const chartDef: GridChartDefinition = {
      id: chartId,
      title: title.trim(),
      type: chartType,
      source:
        sourceKind === 'range'
          ? {
              kind: 'range',
              sheetId: rangeSheetId,
              categoryRange: categoryRange.trim() || undefined,
              series: rangeSeries.map((s) => ({
                name: s.name.trim() || 'Series',
                range: s.range.trim(),
                color: s.color,
                type: s.type,
              })),
            }
          : {
              kind: 'dataset',
              datasetId: selectedDatasetId,
              category: datasetCategory,
              series: datasetSeries.map((s) => ({
                fieldId: s.fieldId,
                aggregateId: s.aggregateId,
                name: s.name.trim() || undefined,
                color: s.color,
                type: s.type,
              })),
            },
      anchor: {
        sheetId: anchorSheetId,
        startRow: Number(startRow),
        startCol: Number(startCol),
        endRow: Number(endRow),
        endCol: Number(endCol),
      },
      options: {
        legend: showLegend,
        stacked: isStacked,
        smooth: isSmooth,
        xAxisTitle: xAxisTitle.trim() || undefined,
        yAxisTitle: yAxisTitle.trim() || undefined,
      },
    };

    onSave(chartDef);
    onClose();
  };

  return (
    <div
      data-testid="chart-editor-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-bg)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: '940px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-panel)',
          border: 'var(--border-width) solid var(--border)',
          boxShadow: 'var(--shadow-elevation)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <BarChart3 size={20} style={{ color: 'var(--accent)' }} />
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              {initialChart ? 'Edit Chart' : 'Insert Chart'}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body: Left Form (55%) + Right Live Preview (45%) */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Form */}
          <div
            style={{
              flex: '1 1 55%',
              padding: 'var(--space-4)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            {formError && (
              <div
                style={{
                  backgroundColor: 'var(--danger-subtle)',
                  color: 'var(--danger)',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-control)',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 500,
                }}
              >
                {formError}
              </div>
            )}

            {/* Title */}
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, display: 'block' }}>
                Chart Title
              </label>
              <input
                type="text"
                className="input input-sm"
                value={title}
                maxLength={CHART_LIMITS.MAX_TITLE_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Quarterly Sales by Region"
                style={{ width: '100%', marginTop: 'var(--space-1)' }}
              />
            </div>

            {/* Chart Type Selector */}
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                Chart Type
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'var(--space-2)',
                }}
              >
                {CHART_TYPES.map((t) => {
                  const Icon = t.icon;
                  const isSelected = chartType === t.type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => setChartType(t.type)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-control)',
                        border: isSelected
                          ? '2px solid var(--accent)'
                          : 'var(--border-width) solid var(--border)',
                        backgroundColor: isSelected ? 'var(--accent-subtle)' : 'var(--surface)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: '100%' }}>
                        <Icon size={16} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }} />
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{t.label}</span>
                      </div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                        {t.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Data Source Tabs */}
            <div style={{ marginTop: 'var(--space-1)' }}>
              <div
                style={{
                  display: 'flex',
                  borderBottom: 'var(--border-width) solid var(--border)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <button
                  type="button"
                  className={`btn btn-ghost ${sourceKind === 'dataset' ? 'active' : ''}`}
                  onClick={() => setSourceKind('dataset')}
                  style={{
                    flex: 1,
                    borderBottom: sourceKind === 'dataset' ? '2px solid var(--accent)' : 'none',
                    fontWeight: sourceKind === 'dataset' ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-1)',
                    padding: 'var(--space-1) var(--space-2)',
                  }}
                >
                  <Database size={14} />
                  <span style={{ fontSize: 'var(--font-size-xs)' }}>Query Dataset</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost ${sourceKind === 'range' ? 'active' : ''}`}
                  onClick={() => setSourceKind('range')}
                  style={{
                    flex: 1,
                    borderBottom: sourceKind === 'range' ? '2px solid var(--accent)' : 'none',
                    fontWeight: sourceKind === 'range' ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-1)',
                    padding: 'var(--space-1) var(--space-2)',
                  }}
                >
                  <Table size={14} />
                  <span style={{ fontSize: 'var(--font-size-xs)' }}>Cell Range</span>
                </button>
              </div>

              {/* Source: Dataset */}
              {sourceKind === 'dataset' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {datasets.length === 0 ? (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', padding: 'var(--space-2)' }}>
                      No datasets found in this template. Please add a dataset in the Datasets tab or switch to Cell Range mode.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Dataset</label>
                        <select
                          className="input input-sm"
                          value={selectedDatasetId}
                          onChange={(e) => setSelectedDatasetId(e.target.value)}
                          style={{ width: '100%', marginTop: 'var(--space-1)' }}
                        >
                          {datasets.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name || d.id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                          Category (X-Axis or Pie Segments)
                        </label>
                        <select
                          className="input input-sm"
                          value={datasetCategory}
                          onChange={(e) => setDatasetCategory(e.target.value)}
                          style={{ width: '100%', marginTop: 'var(--space-1)' }}
                        >
                          {(currentDataset?.fields || []).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name || f.fieldPath || f.id}
                            </option>
                          ))}
                          {(currentDataset?.aggregates || []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name || a.id} (Aggregate)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Series Fields */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                            Series Metrics ({datasetSeries.length}/{CHART_LIMITS.MAX_SERIES_PER_CHART})
                          </label>
                          {datasetSeries.length < CHART_LIMITS.MAX_SERIES_PER_CHART && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                const nextColor =
                                  DEFAULT_CHART_PALETTE[
                                    datasetSeries.length % DEFAULT_CHART_PALETTE.length
                                  ];
                                const candidateField =
                                  currentDataset?.fields?.[datasetSeries.length]?.id ||
                                  currentDataset?.aggregates?.[0]?.id ||
                                  'amount';
                                setDatasetSeries([
                                  ...datasetSeries,
                                  {
                                    id: `ds_s_${Date.now()}`,
                                    fieldId: candidateField,
                                    name: `Series ${datasetSeries.length + 1}`,
                                    color: nextColor,
                                    type: chartType === 'combo' ? 'line' : undefined,
                                  },
                                ]);
                              }}
                              style={{ fontSize: 'var(--font-size-xs)' }}
                            >
                              <Plus size={12} /> Add Metric
                            </button>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                          {datasetSeries.map((s, idx) => (
                            <div
                              key={s.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-1)',
                                padding: 'var(--space-1)',
                                backgroundColor: 'var(--surface-subtle)',
                                borderRadius: 'var(--radius-control)',
                              }}
                            >
                              <select
                                className="input input-sm"
                                value={s.fieldId || s.aggregateId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const isAgg = currentDataset?.aggregates?.some((a) => a.id === val);
                                  const updated = [...datasetSeries];
                                  updated[idx] = {
                                    ...updated[idx],
                                    fieldId: isAgg ? undefined : val,
                                    aggregateId: isAgg ? val : undefined,
                                    name: updated[idx].name || val,
                                  };
                                  setDatasetSeries(updated);
                                }}
                                style={{ flex: '1 1 40%' }}
                              >
                                <optgroup label="Fields">
                                  {(currentDataset?.fields || []).map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name || f.fieldPath || f.id}
                                    </option>
                                  ))}
                                </optgroup>
                                {(currentDataset?.aggregates || []).length > 0 && (
                                  <optgroup label="Aggregates">
                                    {currentDataset!.aggregates!.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name || a.id}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>

                              <input
                                type="text"
                                className="input input-sm"
                                placeholder="Label"
                                value={s.name}
                                onChange={(e) => {
                                  const updated = [...datasetSeries];
                                  updated[idx] = { ...updated[idx], name: e.target.value };
                                  setDatasetSeries(updated);
                                }}
                                style={{ flex: '1 1 35%' }}
                              />

                              <input
                                type="color"
                                value={s.color.startsWith('#') ? s.color : DEFAULT_CHART_PALETTE[0]}
                                onChange={(e) => {
                                  const updated = [...datasetSeries];
                                  updated[idx] = { ...updated[idx], color: e.target.value };
                                  setDatasetSeries(updated);
                                }}
                                title="Series Color"
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  padding: 0,
                                  border: 'none',
                                  borderRadius: 'var(--radius-control)',
                                  cursor: 'pointer',
                                }}
                              />

                              {chartType === 'combo' && (
                                <select
                                  className="input input-sm"
                                  value={s.type || 'bar'}
                                  onChange={(e) => {
                                    const updated = [...datasetSeries];
                                    updated[idx] = {
                                      ...updated[idx],
                                      type: e.target.value as 'bar' | 'line',
                                    };
                                    setDatasetSeries(updated);
                                  }}
                                  style={{ width: '65px' }}
                                >
                                  <option value="bar">Bar</option>
                                  <option value="line">Line</option>
                                </select>
                              )}

                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setDatasetSeries(datasetSeries.filter((_, i) => i !== idx))}
                                disabled={datasetSeries.length <= 1}
                                style={{ color: 'var(--danger)', padding: 'var(--space-1)' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Source: Range */}
              {sourceKind === 'range' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Sheet</label>
                      <select
                        className="input input-sm"
                        value={rangeSheetId}
                        onChange={(e) => setRangeSheetId(e.target.value)}
                        style={{ width: '100%', marginTop: 'var(--space-1)' }}
                      >
                        {sheets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || s.id}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        Category Range
                      </label>
                      <input
                        type="text"
                        className="input input-sm"
                        value={categoryRange}
                        onChange={(e) => setCategoryRange(e.target.value)}
                        placeholder="e.g. A2:A12"
                        style={{ width: '100%', marginTop: 'var(--space-1)' }}
                      />
                    </div>
                  </div>

                  {selectedRange && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleApplyCurrentSelectionAsRange}
                      style={{ fontSize: 'var(--font-size-xs)', alignSelf: 'flex-start' }}
                    >
                      <Table size={12} /> Use current sheet selection for ranges
                    </button>
                  )}

                  {/* Range Series */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                        Series Ranges ({rangeSeries.length}/{CHART_LIMITS.MAX_SERIES_PER_CHART})
                      </label>
                      {rangeSeries.length < CHART_LIMITS.MAX_SERIES_PER_CHART && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const nextColor =
                              DEFAULT_CHART_PALETTE[
                                rangeSeries.length % DEFAULT_CHART_PALETTE.length
                              ];
                            setRangeSeries([
                              ...rangeSeries,
                              {
                                id: `s_${Date.now()}`,
                                name: `Series ${rangeSeries.length + 1}`,
                                range: 'B2:B7',
                                color: nextColor,
                                type: chartType === 'combo' ? 'line' : undefined,
                              },
                            ]);
                          }}
                          style={{ fontSize: 'var(--font-size-xs)' }}
                        >
                          <Plus size={12} /> Add Series
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                      {rangeSeries.map((s, idx) => (
                        <div
                          key={s.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            padding: 'var(--space-1)',
                            backgroundColor: 'var(--surface-subtle)',
                            borderRadius: 'var(--radius-control)',
                          }}
                        >
                          <input
                            type="text"
                            className="input input-sm"
                            placeholder="Series Name"
                            value={s.name}
                            onChange={(e) => {
                              const updated = [...rangeSeries];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              setRangeSeries(updated);
                            }}
                            style={{ flex: '1 1 35%' }}
                          />

                          <input
                            type="text"
                            className="input input-sm"
                            placeholder="Range (e.g. B2:B12)"
                            value={s.range}
                            onChange={(e) => {
                              const updated = [...rangeSeries];
                              updated[idx] = { ...updated[idx], range: e.target.value };
                              setRangeSeries(updated);
                            }}
                            style={{ flex: '1 1 35%' }}
                          />

                          <input
                            type="color"
                            value={s.color.startsWith('#') ? s.color : DEFAULT_CHART_PALETTE[0]}
                            onChange={(e) => {
                              const updated = [...rangeSeries];
                              updated[idx] = { ...updated[idx], color: e.target.value };
                              setRangeSeries(updated);
                            }}
                            title="Color"
                            style={{
                              width: '28px',
                              height: '28px',
                              padding: 0,
                              border: 'none',
                              borderRadius: 'var(--radius-control)',
                              cursor: 'pointer',
                            }}
                          />

                          {chartType === 'combo' && (
                            <select
                              className="input input-sm"
                              value={s.type || 'bar'}
                              onChange={(e) => {
                                const updated = [...rangeSeries];
                                updated[idx] = {
                                  ...updated[idx],
                                  type: e.target.value as 'bar' | 'line',
                                };
                                setRangeSeries(updated);
                              }}
                              style={{ width: '65px' }}
                            >
                              <option value="bar">Bar</option>
                              <option value="line">Line</option>
                            </select>
                          )}

                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setRangeSeries(rangeSeries.filter((_, i) => i !== idx))}
                            disabled={rangeSeries.length <= 1}
                            style={{ color: 'var(--danger)', padding: 'var(--space-1)' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Anchor Placement */}
            <div style={{ borderTop: 'var(--border-width) solid var(--border)', paddingTop: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                  Grid Anchor Placement
                </label>
                {selectedRange && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleApplyCurrentSelectionAsAnchor}
                    style={{ fontSize: 'var(--font-size-xs)' }}
                  >
                    <Maximize2 size={12} /> Fit to Selection
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                <div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Start Col</span>
                  <input
                    type="number"
                    min={0}
                    className="input input-sm"
                    value={startCol}
                    onChange={(e) => setStartCol(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Start Row</span>
                  <input
                    type="number"
                    min={0}
                    className="input input-sm"
                    value={startRow}
                    onChange={(e) => setStartRow(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>End Col</span>
                  <input
                    type="number"
                    min={startCol + 1}
                    className="input input-sm"
                    value={endCol}
                    onChange={(e) => setEndCol(parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>End Row</span>
                  <input
                    type="number"
                    min={startRow + 1}
                    className="input input-sm"
                    value={endRow}
                    onChange={(e) => setEndRow(parseInt(e.target.value, 10) || 1)}
                  />
                </div>
              </div>
            </div>

            {/* Options */}
            <div style={{ borderTop: 'var(--border-width) solid var(--border)', paddingTop: 'var(--space-2)' }}>
              <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                Display Options
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}>
                  <input
                    type="checkbox"
                    checked={showLegend}
                    onChange={(e) => setShowLegend(e.target.checked)}
                  />
                  <span>Show Legend</span>
                </label>

                {(chartType === 'bar' || chartType === 'line' || chartType === 'area') && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}>
                    <input
                      type="checkbox"
                      checked={isStacked}
                      onChange={(e) => setIsStacked(e.target.checked)}
                    />
                    <span>Stacked Series</span>
                  </label>
                )}

                {/* Excel can smooth line series but not area charts, so the option is only offered
                    where the exported workbook will honour it */}
                {(chartType === 'line' || chartType === 'combo') && (
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}
                    title="Applies to line series; Excel draws area series with straight segments"
                  >
                    <input
                      type="checkbox"
                      checked={isSmooth}
                      onChange={(e) => setIsSmooth(e.target.checked)}
                    />
                    <span>Smooth Lines</span>
                  </label>
                )}
              </div>

              {(chartType === 'bar' || chartType === 'line' || chartType === 'area' || chartType === 'combo') && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="X-Axis Title (optional)"
                    value={xAxisTitle}
                    onChange={(e) => setXAxisTitle(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="Y-Axis Title (optional)"
                    value={yAxisTitle}
                    onChange={(e) => setYAxisTitle(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right Live Preview */}
          <div
            style={{
              flex: '1 1 45%',
              borderLeft: 'var(--border-width) solid var(--border)',
              backgroundColor: 'var(--surface-subtle)',
              display: 'flex',
              flexDirection: 'column',
              padding: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>
                Live SSR/Client Preview
              </span>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  backgroundColor: 'var(--accent-subtle)',
                  color: 'var(--accent)',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-control)',
                  fontWeight: 600,
                }}
              >
                Apache ECharts
              </span>
            </div>

            <div
              style={{
                flex: 1,
                backgroundColor: 'var(--surface)',
                borderRadius: 'var(--radius-control)',
                border: 'var(--border-width) solid var(--border)',
                minHeight: '260px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                ref={chartPreviewRef}
                style={{ width: '100%', height: '100%', minHeight: '260px' }}
              />
            </div>

            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
              Preview uses the exact shared option builder that renders pure SVG and embeds in exported XLSX.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" data-testid="save-chart-btn" onClick={handleSave}>
            {initialChart ? 'Update Chart' : 'Add Chart to Grid'}
          </button>
        </div>
      </div>
    </div>
  );
}
