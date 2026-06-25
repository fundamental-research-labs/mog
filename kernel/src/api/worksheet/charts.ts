/**
 * WorksheetChartsImpl — Implementation of the WorksheetCharts sub-API.
 *
 * Calls domain modules directly (no intermediate operations layer or unwrap).
 * Validation and multi-step logic is inlined here.
 */
import type {
  Chart,
  ChartActivateReceipt,
  ChartAddReceipt,
  ChartDescription,
  ChartConfig,
  ChartDuplicateReceipt,
  ChartFormatString,
  ChartImageExporter,
  ChartMutationReceipt,
  ChartReadOptions,
  ChartRemoveReceipt,
  ChartSeriesDimension,
  ChartSourceData,
  ChartSourceDataUpdate,
  ChartSourceRangeMatch,
  ChartType,
  ChartUpdateReceipt,
  SheetId,
  SingleAxisConfig,
  WorksheetCharts,
} from '@mog-sdk/contracts/api';
import type { ChartAppModel, ChartAxisRole } from '@mog-sdk/contracts/data/chart-app-model';

import type { CellRange } from '@mog-sdk/contracts/core';
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
  chartMutationOptions,
  chartSeriesCount,
  requireChart,
  requireChartSeriesForMutation,
  requireChartWithSeries,
  resolveChartIdInput,
} from './chart-api-helpers';
import { orderChartsForList } from '../../domain/charts/chart-list-ordering';
import {
  chartConfigToInternal,
  serializedChartToChart,
} from '../../domain/charts/chart-public-api-converters';
import { withInferredChartTitle } from '../../domain/charts/chart-title-inference';
import { sliceChartTitle } from './chart-title-substring';
import { chartNotFound, invalidChartConfig, operationFailed } from '../../errors/api';
import { KernelError } from '../../errors';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';
import {
  describeWorksheetChart,
  findWorksheetChartsBySourceRange,
  getWorksheetChartSourceData,
  updateChartSourceData,
} from './chart-source-diagnostics';
import {
  buildChartActivateReceipt,
  buildChartAddReceipt,
  buildChartDuplicateReceipt,
} from './charts/receipts';
import {
  bringWorksheetChartForward,
  bringWorksheetChartToFront,
  linkWorksheetChartToTable,
  sendWorksheetChartBackward,
  sendWorksheetChartToBack,
  unlinkWorksheetChartFromTable,
  updateRawWorksheetChart,
} from './charts/bridge-mutations';
import {
  clearWorksheetCharts,
  removeChartWithReceipt,
  updateChartWithReceipt,
} from './charts/mutations';
import {
  addChartSeriesMutation,
  addChartTrendlineMutation,
  formatChartPointMutation,
  removeChartSeriesMutation,
  removeChartTrendlineMutation,
  reorderChartSeriesMutation,
  setChartCategoryNamesMutation,
  setChartDataLabelDimensionMutation,
  setChartPointDataLabelMutation,
  setSeriesBinOptionsMutation,
  setSeriesBoxwhiskerOptionsMutation,
  updateChartSeriesMutation,
  updateChartTrendlineMutation,
} from './chart-mutation-receipts';
import {
  setChartAxisTitleAppModelMutation,
  setChartAxisVisibleMutation,
  setChartLegendVisibleMutation,
  setChartTitleVisibleMutation,
  switchChartSeriesOrientationMutation,
} from './chart-app-model-mutations';
import { getWorksheetChartAppModel } from './chart-app-model-read';
import { assertChartSourceRefsResolvable } from './chart-source-validation';

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

  async add(config: ChartConfig): Promise<ChartAddReceipt> {
    if (!config.type) throw invalidChartConfig('type is required');
    assertSupportedNativeXlsxChartConfig(config);
    const hasSeriesValues = config.series?.some((s) => s.values);
    if (!config.dataRange && !hasSeriesValues)
      throw invalidChartConfig('dataRange is required when series[].values are not provided');
    await awaitSheetMaterialized(this.ctx, this.sheetId);
    await assertChartSourceRefsResolvable(this.ctx, config);

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
    const result = await this.ctx.computeBridge.createChart(
      this.sheetId,
      internalConfig,
      chartMutationOptions(this.ctx, this.sheetId, 'charts.create'),
    );
    // Extract the actual chart ID assigned by the Rust engine (may differ from our generated ID)
    const change = result?.floatingObjectChanges?.[0];
    const actualId = change?.objectId ?? change?.data?.id ?? chartId;

    // Read back the full chart entity.
    const full = await this.get(actualId);
    if (full) return buildChartAddReceipt(this.sheetId, full);

    // Fallback: return minimal chart from config if read-back fails.
    const fallback = {
      id: actualId,
      type: configWithId.type,
      subType: configWithId.subType,
      name: configWithId.name ?? '',
      dataRange: configWithId.dataRange ?? '',
      series: configWithId.series ?? [],
      anchorRow: configWithId.anchorRow ?? 0,
      anchorCol: configWithId.anchorCol ?? 0,
      width: configWithId.width ?? 480,
      height: configWithId.height ?? 300,
    } as Chart;
    return buildChartAddReceipt(this.sheetId, fallback);
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

  async getAppModel(chartId: string, options?: ChartReadOptions): Promise<ChartAppModel | null> {
    return getWorksheetChartAppModel(this.ctx, this.sheetId, chartId, options);
  }

  async update(chartId: string, updates: Partial<ChartConfig>): Promise<ChartUpdateReceipt> {
    return updateChartWithReceipt(this.ctx, this.sheetId, chartId, updates);
  }

  async updateRaw(chartId: string, fields: Record<string, unknown>): Promise<void> {
    await updateRawWorksheetChart(this.ctx, this.sheetId, chartId, fields);
  }

  async remove(chartId: string): Promise<ChartRemoveReceipt> {
    return removeChartWithReceipt(this.ctx, this.sheetId, chartId);
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
    await clearWorksheetCharts(
      this.ctx,
      this.sheetId,
      charts.map((chart) => chart.id),
    );
  }

  // ===========================================================================
  // Group A: Simple Convenience Methods (2a-2f)
  // ===========================================================================

  async duplicate(chartId: string): Promise<ChartDuplicateReceipt> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);

    const { id: _id, sheetId: _sheetId, createdAt: _ca, updatedAt: _ua, ...configFields } = chart;
    const config: ChartConfig = {
      ...configFields,
      anchorRow: configFields.anchorRow + 2,
    };

    // Re-use add() which validates and creates
    const receipt = await this.add(config);
    return buildChartDuplicateReceipt(this.sheetId, chart.id, receipt.chart);
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
    await this.setSourceData(chartId, { dataRange: range });
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

  async describe(chartId: string, options?: ImageExportOptions): Promise<ChartDescription> {
    return describeWorksheetChart(this.ctx, this.sheetId, chartId, options);
  }

  async getSourceData(chartId: string, options?: ImageExportOptions): Promise<ChartSourceData> {
    return getWorksheetChartSourceData(this.ctx, this.sheetId, chartId, options);
  }

  async setSourceData(chartId: string, sourceData: ChartSourceDataUpdate): Promise<void> {
    await updateChartSourceData(this.ctx, this.sheetId, chartId, sourceData);
  }

  async findBySourceRange(range: string | CellRange): Promise<ChartSourceRangeMatch[]> {
    return findWorksheetChartsBySourceRange(
      this.ctx,
      this.sheetId,
      range,
      () => this.list(),
      (chartId) => this.describe(chartId),
    );
  }

  async usesRange(range: string | CellRange): Promise<boolean> {
    return (await this.findBySourceRange(range)).length > 0;
  }

  // ===========================================================================
  // Group B: Z-Order Methods (2g)
  // ===========================================================================

  async bringToFront(chartId: string): Promise<void> {
    await bringWorksheetChartToFront(this.ctx, this.sheetId, chartId);
  }

  async sendToBack(chartId: string): Promise<void> {
    await sendWorksheetChartToBack(this.ctx, this.sheetId, chartId);
  }

  async bringForward(chartId: string): Promise<void> {
    await bringWorksheetChartForward(this.ctx, this.sheetId, chartId);
  }

  async sendBackward(chartId: string): Promise<void> {
    await sendWorksheetChartBackward(this.ctx, this.sheetId, chartId);
  }

  // ===========================================================================
  // Group C: Table-Linking Methods (2h)
  // ===========================================================================

  async linkToTable(chartId: string, tableId: string): Promise<void> {
    await linkWorksheetChartToTable(this.ctx, this.sheetId, chartId, tableId);
  }

  async unlinkFromTable(chartId: string): Promise<void> {
    await unlinkWorksheetChartFromTable(this.ctx, this.sheetId, chartId);
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

  async addSeries(chartId: string, config: SeriesConfig): Promise<ChartMutationReceipt> {
    return addChartSeriesMutation(this.ctx, this.sheetId, chartId, config);
  }

  async removeSeries(chartId: string, index: number): Promise<ChartMutationReceipt> {
    return removeChartSeriesMutation(this.ctx, this.sheetId, chartId, index);
  }

  async getSeries(chartId: string, index: number): Promise<SeriesConfig> {
    const { chart, series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const seriesCount = chartSeriesCount(chart);
    if (index < 0 || index >= seriesCount) {
      throw operationFailed(
        'getChartSeries',
        `Series index ${index} out of range (0-${seriesCount - 1})`,
      );
    }
    return series[index] ?? {};
  }

  async updateSeries(
    chartId: string,
    index: number,
    updates: Partial<SeriesConfig>,
  ): Promise<ChartMutationReceipt> {
    return updateChartSeriesMutation(
      this.ctx,
      this.sheetId,
      'chart.series.update',
      chartId,
      index,
      updates,
    );
  }

  async getSeriesCount(chartId: string): Promise<number> {
    const { chart } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    return chartSeriesCount(chart);
  }

  async reorderSeries(
    chartId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<ChartMutationReceipt> {
    return reorderChartSeriesMutation(this.ctx, this.sheetId, chartId, fromIndex, toIndex);
  }

  async setSeriesValues(
    chartId: string,
    index: number,
    range: string,
  ): Promise<ChartMutationReceipt> {
    return updateChartSeriesMutation(
      this.ctx,
      this.sheetId,
      'chart.series.setValues',
      chartId,
      index,
      { values: range },
    );
  }

  async setSeriesCategories(
    chartId: string,
    index: number,
    range: string,
  ): Promise<ChartMutationReceipt> {
    return updateChartSeriesMutation(
      this.ctx,
      this.sheetId,
      'chart.series.setCategories',
      chartId,
      index,
      { categories: range },
    );
  }

  // ===========================================================================
  // Group E: Point Formatting (2j)
  // ===========================================================================

  async formatPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    format: { fill?: string; border?: ChartBorder },
  ): Promise<ChartMutationReceipt> {
    return formatChartPointMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      pointIndex,
      format,
    );
  }

  async setPointDataLabel(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    config: DataLabelConfig,
  ): Promise<ChartMutationReceipt> {
    return setChartPointDataLabelMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      pointIndex,
      config,
    );
  }

  // ===========================================================================
  // Group F: Trendline CRUD Methods
  // ===========================================================================

  async addTrendline(
    chartId: string,
    seriesIndex: number,
    trendline: TrendlineConfig,
  ): Promise<ChartMutationReceipt> {
    return addChartTrendlineMutation(this.ctx, this.sheetId, chartId, seriesIndex, trendline);
  }

  async updateTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
    updates: Partial<TrendlineConfig>,
  ): Promise<ChartMutationReceipt> {
    return updateChartTrendlineMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      trendlineIndex,
      updates,
    );
  }

  async removeTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<ChartMutationReceipt> {
    return removeChartTrendlineMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      trendlineIndex,
    );
  }

  async getTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<TrendlineConfig | null> {
    const { series } = await requireChartSeriesForMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      'getTrendline',
    );
    const trendlines = series[seriesIndex].trendlines ?? [];
    if (trendlineIndex < 0 || trendlineIndex >= trendlines.length) return null;
    return trendlines[trendlineIndex] ?? null;
  }

  async getTrendlineCount(chartId: string, seriesIndex: number): Promise<number> {
    const { series } = await requireChartSeriesForMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      'getTrendlineCount',
    );
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

  async setBubbleSizes(
    chartId: string,
    seriesIndex: number,
    range: string,
  ): Promise<ChartMutationReceipt> {
    return updateChartSeriesMutation(
      this.ctx,
      this.sheetId,
      'chart.series.setBubbleSizes',
      chartId,
      seriesIndex,
      { bubbleSize: range },
    );
  }

  // ===========================================================================
  // Group D2: Per-Series Statistical Options
  // ===========================================================================

  async getSeriesBinOptions(chartId: string, seriesIndex: number): Promise<HistogramConfig | null> {
    const { chart, series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const seriesCount = chartSeriesCount(chart);
    if (seriesIndex < 0 || seriesIndex >= seriesCount) {
      throw operationFailed(
        'getSeriesBinOptions',
        `Series index ${seriesIndex} out of range (0-${seriesCount - 1})`,
      );
    }
    return series[seriesIndex]?.binOptions ?? null;
  }

  async setSeriesBinOptions(
    chartId: string,
    seriesIndex: number,
    options: HistogramConfig,
  ): Promise<ChartMutationReceipt> {
    return setSeriesBinOptionsMutation(this.ctx, this.sheetId, chartId, seriesIndex, options);
  }

  async getSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
  ): Promise<BoxplotConfig | null> {
    const { chart, series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const seriesCount = chartSeriesCount(chart);
    if (seriesIndex < 0 || seriesIndex >= seriesCount) {
      throw operationFailed(
        'getSeriesBoxwhiskerOptions',
        `Series index ${seriesIndex} out of range (0-${seriesCount - 1})`,
      );
    }
    return series[seriesIndex]?.boxwhiskerOptions ?? null;
  }

  async setSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
    options: BoxplotConfig,
  ): Promise<ChartMutationReceipt> {
    return setSeriesBoxwhiskerOptionsMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      options,
    );
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

  async getPlotAreaLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.plotArea) return null;
    return layout.plotArea;
  }

  async getLegendLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.legend) return null;
    return layout.legend;
  }

  async getTitleLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.title) return null;
    return layout.title;
  }

  async getDataLabelLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.dataLabels) return null;
    return layout.dataLabels;
  }

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
    axisType: ChartAxisRole,
    title: string,
  ): Promise<ChartMutationReceipt> {
    return setChartAxisTitleAppModelMutation(this.ctx, this.sheetId, chartId, axisType, title);
  }

  async setAxisVisible(
    chartId: string,
    axisRole: ChartAxisRole,
    visible: boolean,
  ): Promise<ChartMutationReceipt> {
    return setChartAxisVisibleMutation(this.ctx, this.sheetId, chartId, axisRole, visible);
  }

  async setLegendVisible(chartId: string, visible: boolean): Promise<ChartMutationReceipt> {
    return setChartLegendVisibleMutation(this.ctx, this.sheetId, chartId, visible);
  }
  async setChartTitleVisible(chartId: string, visible: boolean): Promise<ChartMutationReceipt> {
    return setChartTitleVisibleMutation(this.ctx, this.sheetId, chartId, visible);
  }
  async switchSeriesOrientation(chartId: string): Promise<ChartMutationReceipt> {
    return switchChartSeriesOrientationMutation(this.ctx, this.sheetId, chartId);
  }

  async setCategoryNames(chartId: string, range: string): Promise<ChartMutationReceipt> {
    return setChartCategoryNamesMutation(this.ctx, this.sheetId, chartId, range);
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
    const { chart, series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const seriesCount = chartSeriesCount(chart);
    if (seriesIndex < 0 || seriesIndex >= seriesCount) {
      throw operationFailed(
        'getSeriesDimensionDataSourceString',
        `Series index ${seriesIndex} out of range (0-${seriesCount - 1})`,
      );
    }
    const s = series[seriesIndex] ?? {};
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
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<ChartMutationReceipt> {
    return setChartDataLabelDimensionMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      pointIndex,
      'height',
      value,
    );
  }

  async setDataLabelWidth(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<ChartMutationReceipt> {
    return setChartDataLabelDimensionMutation(
      this.ctx,
      this.sheetId,
      chartId,
      seriesIndex,
      pointIndex,
      'width',
      value,
    );
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
    // Keep the formula in the dedicated metadata field. Until chart-title
    // formula evaluation is available, do not expose the raw formula as
    // rendered title text.
    await applyUpdate(this.ctx, this.sheetId, chartId, { title: null, titleFormula: formula });
  }

  async getTitleSubstring(
    chartId: string,
    start: number,
    length: number,
  ): Promise<ChartFormatString> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    return sliceChartTitle(chart, start, length);
  }

  // ===========================================================================
  // Chart Activation
  // ===========================================================================

  async activate(chartId: string): Promise<ChartActivateReceipt> {
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
    return buildChartActivateReceipt(this.sheetId, resolvedChartId);
  }
}
