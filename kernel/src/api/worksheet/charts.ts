/**
 * WorksheetChartsImpl — Implementation of the WorksheetCharts sub-API.
 *
 * Calls domain modules directly (no intermediate operations layer or unwrap).
 * Validation and multi-step logic is inlined here.
 */
import type {
  Chart,
  ChartConfig,
  ChartFormatString,
  ChartImageExporter,
  ChartReadOptions,
  ChartSeriesDimension,
  ChartType,
  SheetId,
  SingleAxisConfig,
  WorksheetCharts,
} from '@mog-sdk/contracts/api';

import type {
  BoxplotConfig,
  ChartBorder,
  DataLabelConfig,
  DataTableConfig,
  HistogramConfig,
  ImageExportOptions,
  SeriesConfig,
  TrendlineConfig,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import type { ChartLayoutSnapshot } from '@mog-sdk/contracts/bridges';
import {
  applyUpdate,
  assertSupportedNativeXlsxChartConfig,
  awaitChartReadScope,
  awaitSheetMaterialized,
  requireChart,
  requireChartWithSeries,
  resolveChartIdInput,
} from './chart-api-helpers';
import { orderChartsForList } from '../../domain/charts/chart-list-ordering';
import {
  chartConfigToInternal,
  serializedChartToChart,
} from '../../domain/charts/chart-public-api-converters';
import { ensurePointsArray } from '../../domain/charts/chart-series-mutations';
import { withInferredChartTitle } from '../../domain/charts/chart-title-inference';
import { chartNotFound, invalidChartConfig, operationFailed } from '../../errors/api';
import { KernelError } from '../../errors';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';

// =============================================================================
// Implementation
// =============================================================================

export class WorksheetChartsImpl implements WorksheetCharts {
  /** Monotonic counter to ensure unique chart IDs within the same millisecond. */
  private static _idCounter = 0;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly exporter?: ChartImageExporter | null,
  ) {}

  // ===========================================================================
  // Core CRUD (Wave 1)
  // ===========================================================================

  async add(config: ChartConfig): Promise<Chart> {
    if (!config.type) throw invalidChartConfig('type is required');
    assertSupportedNativeXlsxChartConfig(config);
    const hasSeriesValues = config.series?.some((s) => s.values);
    if (!config.dataRange && !hasSeriesValues)
      throw invalidChartConfig('dataRange is required when series[].values are not provided');
    await awaitSheetMaterialized(this.ctx, this.sheetId);

    // Generate a stable ID once and pass it through the entire pipeline.
    // If the caller already provided an ID (e.g., via config), preserve it.
    // Use a counter suffix to avoid duplicate IDs when multiple charts are
    // created within the same millisecond.
    const chartId =
      (config as { id?: string }).id || `chart-${Date.now()}-${WorksheetChartsImpl._idCounter++}`;
    const configWithId = (await withInferredChartTitle(this.ctx, this.sheetId, {
      ...config,
      id: chartId,
    } as ChartConfig)) as ChartConfig;
    const internalConfig = chartConfigToInternal(configWithId);
    const result = await this.ctx.computeBridge.createChart(this.sheetId, internalConfig);
    // Extract the actual chart ID assigned by the Rust engine (may differ from our generated ID)
    const change = result?.floatingObjectChanges?.[0];
    const actualId = change?.objectId ?? change?.data?.id ?? chartId;

    // Read back the full chart entity.
    const full = await this.get(actualId);
    if (full) return full;

    // Fallback: return minimal chart from config if read-back fails.
    return {
      id: actualId,
      type: config.type,
      subType: config.subType,
      name: config.name ?? '',
      dataRange: config.dataRange ?? '',
      series: config.series ?? [],
      anchorRow: config.anchorRow ?? 0,
      anchorCol: config.anchorCol ?? 0,
      width: config.width ?? 480,
      height: config.height ?? 300,
    } as Chart;
  }

  async get(chartId: string): Promise<Chart | null> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const resolvedChartId = await resolveChartIdInput(this.ctx, this.sheetId, chartId);
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      resolvedChartId,
    )) as ChartFloatingObject | null;
    return raw ? serializedChartToChart(raw) : null;
  }

  async update(chartId: string, updates: Partial<ChartConfig>): Promise<void> {
    assertSupportedNativeXlsxChartConfig(updates);
    await applyUpdate(this.ctx, this.sheetId, chartId, updates);
  }

  async updateRaw(chartId: string, fields: Record<string, unknown>): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const resolvedChartId = await resolveChartIdInput(this.ctx, this.sheetId, chartId);
    await this.ctx.computeBridge.updateChart(this.sheetId, resolvedChartId, fields);
  }

  async remove(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const resolvedChartId = await resolveChartIdInput(this.ctx, this.sheetId, chartId);
    const existing = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      resolvedChartId,
    )) as ChartFloatingObject | null;
    if (!existing) throw chartNotFound(chartId);
    await this.ctx.computeBridge.deleteChart(this.sheetId, resolvedChartId);
  }

  async list(options?: ChartReadOptions): Promise<Chart[]> {
    await awaitChartReadScope(this.ctx, this.sheetId, options);
    const charts = (await this.ctx.computeBridge.getAllCharts(
      this.sheetId,
    )) as ChartFloatingObject[];
    return orderChartsForList(charts).map(serializedChartToChart);
  }

  async clear(): Promise<void> {
    const charts = await this.list();
    for (const chart of charts) {
      await this.remove(chart.id);
    }
  }

  // ===========================================================================
  // Group A: Simple Convenience Methods (2a-2f)
  // ===========================================================================

  async duplicate(chartId: string): Promise<string> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);

    const { id: _id, sheetId: _sheetId, createdAt: _ca, updatedAt: _ua, ...configFields } = chart;
    const config: ChartConfig = {
      ...configFields,
      anchorRow: configFields.anchorRow + 2,
    };

    // Re-use add() which validates and creates
    const newChart = await this.add(config);
    return newChart.id;
  }

  async exportImage(chartId: string, options?: ImageExportOptions): Promise<string> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const resolvedChartId = await resolveChartIdInput(this.ctx, this.sheetId, chartId);
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      resolvedChartId,
    )) as ChartFloatingObject | null;
    if (!raw) throw chartNotFound(chartId);

    const exporter = this.exporter ?? this.ctx.chartImageExporter;
    if (exporter) {
      try {
        const dataUrl = await exporter.exportImage(this.sheetId, resolvedChartId, options);
        return dataUrl;
      } catch (error) {
        if (error instanceof KernelError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw operationFailed('exportChartImage', reason, { cause: error });
      }
    }

    throw operationFailed('exportChartImage', 'No chart image exporter registered');
  }

  async setDataRange(chartId: string, range: string): Promise<void> {
    await applyUpdate(this.ctx, this.sheetId, chartId, { dataRange: range });
  }

  async setType(chartId: string, type: ChartType, subType?: string): Promise<void> {
    await applyUpdate(this.ctx, this.sheetId, chartId, {
      type,
      subType: subType as ChartConfig['subType'],
    });
  }

  async has(chartId: string): Promise<boolean> {
    return (await this.get(chartId)) !== null;
  }

  async getCount(options?: ChartReadOptions): Promise<number> {
    await awaitChartReadScope(this.ctx, this.sheetId, options);
    const charts = (await this.ctx.computeBridge.getAllCharts(
      this.sheetId,
    )) as ChartFloatingObject[];
    return charts.length;
  }

  async getByName(name: string): Promise<Chart | null> {
    const charts = await this.list();
    return charts.find((c) => c.name === name) ?? null;
  }

  // ===========================================================================
  // Group B: Z-Order Methods (2g)
  // ===========================================================================

  async bringToFront(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.bringChartToFront(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  async sendToBack(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.sendChartToBack(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  async bringForward(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.bringChartForward(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  async sendBackward(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.sendChartBackward(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  // ===========================================================================
  // Group C: Table-Linking Methods (2h)
  // ===========================================================================

  async linkToTable(chartId: string, tableId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.linkChartToTable(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
      tableId,
    );
  }

  async unlinkFromTable(chartId: string): Promise<void> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await this.ctx.computeBridge.unlinkChartFromTable(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  async isLinkedToTable(chartId: string): Promise<boolean> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    return this.ctx.computeBridge.isChartLinkedToTable(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  // ===========================================================================
  // Group D: Series Methods (2i)
  // ===========================================================================

  async addSeries(chartId: string, config: SeriesConfig): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    series.push(config);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
    return series.length - 1;
  }

  async removeSeries(chartId: string, index: number): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'removeChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    series.splice(index, 1);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getSeries(chartId: string, index: number): Promise<SeriesConfig> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'getChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    return series[index];
  }

  async updateSeries(
    chartId: string,
    index: number,
    updates: Partial<SeriesConfig>,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'updateChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    series[index] = { ...series[index], ...updates };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getSeriesCount(chartId: string): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    return series.length;
  }

  async reorderSeries(chartId: string, fromIndex: number, toIndex: number): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (fromIndex < 0 || fromIndex >= series.length) {
      throw operationFailed(
        'reorderChartSeries',
        `fromIndex ${fromIndex} out of range (0-${series.length - 1})`,
      );
    }
    if (toIndex < 0 || toIndex >= series.length) {
      throw operationFailed(
        'reorderChartSeries',
        `toIndex ${toIndex} out of range (0-${series.length - 1})`,
      );
    }
    const [item] = series.splice(fromIndex, 1);
    series.splice(toIndex, 0, item);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async setSeriesValues(chartId: string, index: number, range: string): Promise<void> {
    await this.updateSeries(chartId, index, { values: range });
  }

  async setSeriesCategories(chartId: string, index: number, range: string): Promise<void> {
    await this.updateSeries(chartId, index, { categories: range });
  }

  // ===========================================================================
  // Group E: Point Formatting (2j)
  // ===========================================================================

  async formatPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    format: { fill?: string; border?: ChartBorder },
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'formatChartPoint',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }

    const points = ensurePointsArray(series[seriesIndex], pointIndex);
    points[pointIndex] = { ...points[pointIndex], ...format };
    series[seriesIndex] = { ...series[seriesIndex], points };

    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async setPointDataLabel(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    config: DataLabelConfig,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'setChartPointDataLabel',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }

    const points = ensurePointsArray(series[seriesIndex], pointIndex);
    points[pointIndex] = { ...points[pointIndex], dataLabel: config };
    series[seriesIndex] = { ...series[seriesIndex], points };

    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  // ===========================================================================
  // Group F: Trendline CRUD Methods
  // ===========================================================================

  async addTrendline(
    chartId: string,
    seriesIndex: number,
    trendline: TrendlineConfig,
  ): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'addTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = [...(series[seriesIndex].trendlines ?? [])];
    trendlines.push(trendline);
    series[seriesIndex] = { ...series[seriesIndex], trendlines };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
    return trendlines.length - 1;
  }

  async removeTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'removeTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = [...(series[seriesIndex].trendlines ?? [])];
    if (trendlineIndex < 0 || trendlineIndex >= trendlines.length) {
      throw operationFailed(
        'removeTrendline',
        `Trendline index ${trendlineIndex} out of range (0-${trendlines.length - 1})`,
      );
    }
    trendlines.splice(trendlineIndex, 1);
    series[seriesIndex] = { ...series[seriesIndex], trendlines };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<TrendlineConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = series[seriesIndex].trendlines ?? [];
    if (trendlineIndex < 0 || trendlineIndex >= trendlines.length) return null;
    return trendlines[trendlineIndex] ?? null;
  }

  async getTrendlineCount(chartId: string, seriesIndex: number): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getTrendlineCount',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return (series[seriesIndex].trendlines ?? []).length;
  }

  // ===========================================================================
  // Group I: Data Table Method
  // ===========================================================================

  async getDataTable(chartId: string): Promise<DataTableConfig | null> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    if (!chart.dataTable) return null;
    // Map showKeys ↔ showLegendKey for OfficeJS compatibility
    const dt = chart.dataTable;
    return {
      ...dt,
      showLegendKey: dt.showKeys,
    } as DataTableConfig & { showLegendKey?: boolean };
  }

  // ===========================================================================
  // Group J: Convenience Methods
  // ===========================================================================

  async getItemAt(index: number): Promise<Chart | null> {
    const all = await this.list();
    return all[index] ?? null;
  }

  async setBubbleSizes(chartId: string, seriesIndex: number, range: string): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { bubbleSize: range });
  }

  // ===========================================================================
  // Group D2: Per-Series Statistical Options
  // ===========================================================================

  async getSeriesBinOptions(chartId: string, seriesIndex: number): Promise<HistogramConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesBinOptions',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return series[seriesIndex].binOptions ?? null;
  }

  async setSeriesBinOptions(
    chartId: string,
    seriesIndex: number,
    options: HistogramConfig,
  ): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { binOptions: options });
  }

  async getSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
  ): Promise<BoxplotConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesBoxwhiskerOptions',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return series[seriesIndex].boxwhiskerOptions ?? null;
  }

  async setSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
    options: BoxplotConfig,
  ): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { boxwhiskerOptions: options });
  }

  // ===========================================================================
  // Group M: Collection Events
  // ===========================================================================

  /**
   * Register a handler for chart activation events.
   * Wired to EventBus 'chart:selected' events, filtered by sheetId.
   */
  onActivated(handler: (event: { chartId: string }) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('chart:selected', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      handler({ chartId: event.chartId });
    });
    return toDisposable(unsub);
  }

  /**
   * Register a handler for chart deactivation events.
   * Wired to EventBus 'chart:deselected' events, filtered by sheetId.
   */
  onDeactivated(handler: (event: { chartId: string }) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('chart:deselected', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      handler({ chartId: event.chartId });
    });
    return toDisposable(unsub);
  }

  // ===========================================================================
  // Layout Retrieval Methods
  // ===========================================================================

  /**
   * Get the plot area layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the plotArea sub-object.
   */
  async getPlotAreaLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.plotArea) return null;
    return layout.plotArea;
  }

  /**
   * Get the legend layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the legend sub-object.
   */
  async getLegendLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.legend) return null;
    return layout.legend;
  }

  /**
   * Get the title layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the title sub-object.
   */
  async getTitleLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.title) return null;
    return layout.title;
  }

  /**
   * Get the data label layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the dataLabels sub-object.
   */
  async getDataLabelLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.dataLabels) return null;
    return layout.dataLabels;
  }

  /**
   * Internal helper: get the full chart layout snapshot from the chart bridge.
   *
   * Uses `IChartBridge.getLayout()` directly — no concrete-class cast needed
   * now that the interface returns `ChartLayoutSnapshot` (the narrower cached
   * snapshot, not the richer `ChartLayout` used by the charts library).
   */
  private async getChartLayout(chartId: string): Promise<ChartLayoutSnapshot | null> {
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const bridge = this.ctx.charts;
    if (!bridge || typeof bridge.getLayout !== 'function') {
      return null;
    }
    return bridge.getLayout(
      this.sheetId,
      await resolveChartIdInput(this.ctx, this.sheetId, chartId),
    );
  }

  // ===========================================================================
  // Axis Methods
  // ===========================================================================

  async getAxisItem(
    chartId: string,
    type: 'category' | 'value' | 'series',
    group: 'primary' | 'secondary',
  ): Promise<SingleAxisConfig | null> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    const axis = chart.axis;
    if (!axis) return null;

    if (type === 'series') {
      return axis.seriesAxis ?? null;
    }

    if (group === 'primary') {
      if (type === 'category') return axis.categoryAxis ?? null;
      if (type === 'value') return axis.valueAxis ?? null;
    } else {
      if (type === 'category') return axis.secondaryCategoryAxis ?? null;
      if (type === 'value') return axis.secondaryValueAxis ?? null;
    }

    return null;
  }

  async setAxisTitle(
    chartId: string,
    axisType: 'category' | 'value',
    formula: string,
  ): Promise<void> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    const axis = { ...(chart.axis ?? {}) };

    if (axisType === 'category') {
      axis.categoryAxis = { ...(axis.categoryAxis ?? { visible: true }), title: formula };
    } else {
      axis.valueAxis = { ...(axis.valueAxis ?? { visible: true }), title: formula };
    }

    await applyUpdate(this.ctx, this.sheetId, chartId, { axis });
  }

  async setCategoryNames(chartId: string, range: string): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const updatedSeries = series.map((s) => ({ ...s, categories: range }));
    await applyUpdate(this.ctx, this.sheetId, chartId, { series: updatedSeries });
  }

  // ===========================================================================
  // Series Dimension Methods
  // ===========================================================================

  async getSeriesDimensionValues(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<(string | number)[]> {
    const sourceString = await this.getSeriesDimensionDataSourceString(
      chartId,
      seriesIndex,
      dimension,
    );
    if (!sourceString) return [];

    const sourceType = await this.getSeriesDimensionDataSourceType(chartId, seriesIndex, dimension);

    if (sourceType === 'range') {
      // Parse the range reference and read cell values from the compute bridge
      const rangeRef = await this.ctx.computeBridge.parseRangeRef(sourceString);
      if (!rangeRef) return [];

      // A1RangeRef has { start: A1CellRef, end: A1CellRef, sheetName: string | null }
      // A1CellRef has { row: number, col: number, rowAbsolute: boolean, colAbsolute: boolean }
      const startRow = rangeRef.start.row;
      const startCol = rangeRef.start.col;
      const endRow = rangeRef.end.row;
      const endCol = rangeRef.end.col;

      // Use sheetName to resolve sheetId if present, otherwise use current sheet
      // Note: sheetName resolution would require a sheet name->id lookup;
      // for now we use the current sheet as the most common case
      const sheetId = this.sheetId;

      const values2d = await this.ctx.computeBridge.getRangeValues2d(
        sheetId,
        startRow,
        startCol,
        endRow,
        endCol,
      );

      // Flatten 2D values into a 1D array, filtering out nulls and errors
      const result: (string | number)[] = [];
      for (const row of values2d) {
        for (const cell of row) {
          if (typeof cell === 'string' || typeof cell === 'number') {
            result.push(cell);
          }
        }
      }
      return result;
    }

    // Literal: parse comma-separated or JSON-encoded values
    try {
      const parsed = JSON.parse(sourceString);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (v): v is string | number => typeof v === 'string' || typeof v === 'number',
        );
      }
    } catch {
      // Not JSON — try comma-separated
    }

    // Comma-separated literal values
    return sourceString
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const num = Number(s);
        return isNaN(num) ? s : num;
      });
  }

  async getSeriesDimensionDataSourceString(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesDimensionDataSourceString',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const s = series[seriesIndex];
    switch (dimension) {
      case 'categories':
        return s.categories ?? '';
      case 'values':
        return s.values ?? '';
      case 'bubbleSizes':
        return s.bubbleSize ?? '';
      default:
        return '';
    }
  }

  async getSeriesDimensionDataSourceType(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string> {
    const sourceString = await this.getSeriesDimensionDataSourceString(
      chartId,
      seriesIndex,
      dimension,
    );
    if (!sourceString) return 'literal';
    // If it looks like a cell range (contains sheet reference or A1 notation), it's a range
    if (/[A-Z]+\d+/i.test(sourceString) || sourceString.includes('!')) return 'range';
    return 'formula';
  }

  // ===========================================================================
  // Data Label Methods
  // ===========================================================================

  async getDataLabelSubstring(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _start: number,
    _length: number,
  ): Promise<ChartFormatString> {
    // Stub: requires rich text model for data labels.
    return { text: '' };
  }

  async setDataLabelHeight(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _value: number,
  ): Promise<void> {
    // Stub: layout dimensions interact with the render engine.
    throw operationFailed('setDataLabelHeight', 'Not implemented');
  }

  async setDataLabelWidth(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _value: number,
  ): Promise<void> {
    // Stub: layout dimensions interact with the render engine.
    throw operationFailed('setDataLabelWidth', 'Not implemented');
  }

  async getDataLabelTailAnchor(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
  ): Promise<{ row: number; col: number }> {
    // Stub: requires render engine layout data.
    return { row: 0, col: 0 };
  }

  // ===========================================================================
  // Title Methods
  // ===========================================================================

  async setTitleFormula(chartId: string, formula: string): Promise<void> {
    // Store formula as title text. Display value resolution requires compute bridge.
    await applyUpdate(this.ctx, this.sheetId, chartId, { title: formula });
  }

  async getTitleSubstring(
    _chartId: string,
    _start: number,
    _length: number,
  ): Promise<ChartFormatString> {
    // Stub: requires rich text model for titles.
    return { text: '' };
  }

  // ===========================================================================
  // Chart Activation
  // ===========================================================================

  async activate(chartId: string): Promise<void> {
    // Verify chart exists
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    const resolvedChartId = await resolveChartIdInput(this.ctx, this.sheetId, chartId);
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      resolvedChartId,
    )) as ChartFloatingObject | null;
    if (!raw) throw chartNotFound(chartId);

    // Emit activation event. Shell layer handles scroll/focus.
    this.ctx.eventBus.emit({
      type: 'chart:selected',
      sheetId: this.sheetId,
      chartId: resolvedChartId,
    } as never);
  }
}
