/**
 * WorksheetCharts — Sub-API Interface for Chart Operations
 *
 * CRUD operations plus convenience, z-order, table-linking,
 * series manipulation, and point formatting methods.
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { CellRange } from '@mog/types-core/core';
import type { ChartMutationReceipt } from '../mutation-receipt';
import type { ChartAppModel, ChartAxisRole } from '@mog/types-data/data/chart-app-model';
import type {
  BoxplotConfig,
  Chart,
  ChartBorder,
  ChartConfig,
  ChartFormatString,
  ChartSeriesDimension,
  ChartType,
  DataLabelConfig,
  DataTableConfig,
  HistogramConfig,
  ImageExportOptions,
  ResolvedChartSpecSnapshot,
  SeriesConfig,
  SingleAxisConfig,
  TrendlineConfig,
} from '../types';
import type {
  ChartActivateReceipt,
  ChartAddReceipt,
  ChartDuplicateReceipt,
  ChartRemoveReceipt,
  ChartUpdateReceipt,
} from '../mutation-receipt';

/**
 * ChartImageExporter — Injectable dependency for chart image export.
 *
 * The kernel does not own raster surfaces. Browser and Node hosts inject a
 * platform exporter that compiles chart marks through IChartBridge and renders
 * those marks to an image.
 */
export interface ChartImageExporter {
  exportImage(sheetId: string, chartId: string, options?: ImageExportOptions): Promise<string>;
}

export type ChartReadMaterialization = 'available' | 'sheet' | 'complete';

export interface ChartReadOptions {
  /**
   * Controls whether passive chart reads should promote deferred XLSX import
   * materialization. The default, `sheet`, waits for this worksheet. `available`
   * returns chart records that are already loaded so UI subscriptions do not
   * block first interaction, and `complete` waits for all workbook sheets.
   */
  materialization?: ChartReadMaterialization;
}

/**
 * Identifies one chart. A bare string is matched against both stable IDs and
 * exact display names. Use an explicit selector to disambiguate duplicate
 * names or an ID/name collision.
 */
export type ChartTarget =
  | string
  | { readonly id: string; readonly name?: never }
  | { readonly name: string; readonly id?: never };

export type ChartSourceData = ResolvedChartSpecSnapshot['resolved']['ranges'];

export type ChartAxisDescription = ResolvedChartSpecSnapshot['resolved']['axes'];

export interface ChartCachedPoint {
  readonly index: number;
  readonly category: string | number | null;
  readonly xValue: string | number | null;
  readonly value: number | null;
  readonly renderedValue?: number | null;
  readonly bubbleSize?: number | null;
  readonly blank: boolean;
}

export interface ChartSeriesDescription {
  readonly index: number;
  readonly name: string;
  readonly type?: string;
  readonly axisGroup: 'primary' | 'secondary';
  readonly source: ResolvedChartSpecSnapshot['resolved']['series'][number]['source'];
  readonly ranges: ChartSourceData['seriesReferences'][number] | null;
  readonly cachedPoints: readonly ChartCachedPoint[];
  readonly pointCount: number;
  readonly renderedPointCount: number;
}

export interface ChartDescription {
  readonly chartId: string;
  readonly sheetId: string;
  readonly name?: string;
  readonly title?: string;
  readonly chartType: string;
  readonly subType?: string;
  readonly axes: ChartAxisDescription;
  readonly sourceData: ChartSourceData;
  readonly categories: readonly (string | number | null)[];
  readonly series: readonly ChartSeriesDescription[];
  readonly warnings: readonly string[];
  readonly diagnostics: {
    readonly ranges: ChartSourceData['diagnostics'];
    readonly compiler: readonly string[];
    readonly unsupportedFeatures: readonly string[];
  };
  readonly resolvedSpec: ResolvedChartSpecSnapshot;
}

export interface ChartSeriesSourceDataUpdate {
  readonly index: number;
  readonly name?: string | null;
  readonly nameRef?: string | null;
  readonly values?: string | null;
  readonly categories?: string | null;
  readonly bubbleSize?: string | null;
}

export interface ChartSourceDataUpdate {
  readonly dataRange?: string | null;
  readonly categoryRange?: string | null;
  readonly seriesRange?: string | null;
  readonly series?: readonly ChartSeriesSourceDataUpdate[];
}

export type ChartSourceRangeKind =
  | 'dataRange'
  | 'categoryRange'
  | 'seriesRange'
  | 'seriesName'
  | 'seriesValues'
  | 'seriesCategories'
  | 'seriesBubbleSizes';

export interface ChartSourceRangeMatch {
  readonly chartId: string;
  readonly chartName?: string;
  readonly chartTitle?: string;
  readonly rangeKind: ChartSourceRangeKind;
  readonly seriesIndex?: number;
  readonly source: 'identity' | 'a1';
  readonly ref?: string;
  readonly range: NonNullable<ChartSourceData['dataRange']>['range'];
}

export interface WorksheetCharts {
  // ===========================================================================
  // Core CRUD (Wave 1)
  // ===========================================================================

  /** Add a chart to the sheet. Returns a receipt with the created chart. */
  add(config: ChartConfig): Promise<ChartAddReceipt>;

  /** Get a chart by exact ID or name, or null if not found. */
  get(chartTarget: ChartTarget): Promise<Chart | null>;

  /** Get the normalized app-facing chart model used by first-party UI controls. */
  getAppModel(chartTarget: ChartTarget, options?: ChartReadOptions): Promise<ChartAppModel | null>;

  /** Update a chart's configuration. */
  update(chartTarget: ChartTarget, updates: Partial<ChartConfig>): Promise<ChartUpdateReceipt>;

  /** Remove a chart by exact ID or name. */
  remove(chartTarget: ChartTarget): Promise<ChartRemoveReceipt>;

  /** List charts in the sheet. Pass `{ materialization: "available" }` for passive UI reads. */
  list(options?: ChartReadOptions): Promise<Chart[]>;

  /** @deprecated Use `list()` instead. Compatibility alias for learned chart paths. */
  listCharts(options?: ChartReadOptions): Promise<Chart[]>;

  /** Remove all charts from the sheet. */
  clear(): Promise<void>;

  // ===========================================================================
  // Group A: Simple Convenience Methods (2a-2f)
  // ===========================================================================

  /** Duplicate a chart, offsetting the copy by 2 rows. Returns a receipt with the copy. */
  duplicate(chartTarget: ChartTarget): Promise<ChartDuplicateReceipt>;

  /**
   * Export a chart as an image.
   *
   * Supported formats are SVG, PNG, and JPEG. SVG uses the portable vector
   * renderer; PNG and JPEG require a runtime raster backend.
   */
  exportImage(chartTarget: ChartTarget, options?: ImageExportOptions): Promise<string>;

  /** Set a chart's data range (A1 notation). */
  setDataRange(chartTarget: ChartTarget, range: string): Promise<void>;

  /** Set a chart's type and optional sub-type. */
  setType(chartTarget: ChartTarget, type: ChartType, subType?: string): Promise<void>;

  /** Check if a chart exists by exact ID or name. */
  has(chartTarget: ChartTarget): Promise<boolean>;

  /** Get the total number of loaded charts on this sheet. */
  getCount(options?: ChartReadOptions): Promise<number>;

  /** Find a chart by its name, or null if not found. */
  getByName(name: string): Promise<Chart | null>;

  /**
   * Describe the chart using the same resolved spec and source data that the
   * production chart renderer uses.
   */
  describe(chartTarget: ChartTarget, options?: ImageExportOptions): Promise<ChartDescription>;

  /** Get the resolved chart source ranges and source-range diagnostics. */
  getSourceData(chartTarget: ChartTarget, options?: ImageExportOptions): Promise<ChartSourceData>;

  /**
   * Replace chart source range metadata. This does not write worksheet cell
   * values; it changes which worksheet ranges feed the chart.
   */
  setSourceData(chartTarget: ChartTarget, sourceData: ChartSourceDataUpdate): Promise<void>;

  /** Find loaded charts whose resolved source ranges overlap the worksheet range. */
  findBySourceRange(range: string | CellRange): Promise<ChartSourceRangeMatch[]>;

  /** True when any loaded chart source range overlaps the worksheet range. */
  usesRange(range: string | CellRange): Promise<boolean>;

  // ===========================================================================
  // Group B: Z-Order Methods (2g)
  // ===========================================================================

  /** Bring a chart to the front (highest z-index). */
  bringToFront(chartTarget: ChartTarget): Promise<void>;

  /** Send a chart to the back (lowest z-index). */
  sendToBack(chartTarget: ChartTarget): Promise<void>;

  /** Bring a chart forward by one layer. */
  bringForward(chartTarget: ChartTarget): Promise<void>;

  /** Send a chart backward by one layer. */
  sendBackward(chartTarget: ChartTarget): Promise<void>;

  // ===========================================================================
  // Group C: Table-Linking Methods (2h)
  // ===========================================================================

  /** Link a chart to a table so it auto-updates with the table's data. */
  linkToTable(chartTarget: ChartTarget, tableId: string): Promise<void>;

  /** Unlink a chart from its source table. */
  unlinkFromTable(chartTarget: ChartTarget): Promise<void>;

  /** Check whether a chart is linked to a table. */
  isLinkedToTable(chartTarget: ChartTarget): Promise<boolean>;

  // ===========================================================================
  // Group D: Series Methods (2i)
  // ===========================================================================

  /** Add a data series to a chart. Returns the new series index. */
  addSeries(chartTarget: ChartTarget, config: SeriesConfig): Promise<ChartMutationReceipt>;

  /** Remove a data series by index. */
  removeSeries(chartTarget: ChartTarget, index: number): Promise<ChartMutationReceipt>;

  /** Get a data series by index. */
  getSeries(chartTarget: ChartTarget, index: number): Promise<SeriesConfig>;

  /** Update a data series at the given index. */
  updateSeries(
    chartTarget: ChartTarget,
    index: number,
    updates: Partial<SeriesConfig>,
  ): Promise<ChartMutationReceipt>;

  /** Get the number of data series in a chart. */
  getSeriesCount(chartTarget: ChartTarget): Promise<number>;

  /** Reorder a series from one index to another. */
  reorderSeries(
    chartTarget: ChartTarget,
    fromIndex: number,
    toIndex: number,
  ): Promise<ChartMutationReceipt>;

  /** Set the values range for a series (A1 notation). */
  setSeriesValues(
    chartTarget: ChartTarget,
    index: number,
    range: string,
  ): Promise<ChartMutationReceipt>;

  /** Set the categories range for a series (A1 notation). */
  setSeriesCategories(
    chartTarget: ChartTarget,
    index: number,
    range: string,
  ): Promise<ChartMutationReceipt>;

  // ===========================================================================
  // Group D2: Per-Series Statistical Options
  // ===========================================================================

  /** Get per-series histogram bin options, or null if not set (falls back to chart-level). */
  getSeriesBinOptions(
    chartTarget: ChartTarget,
    seriesIndex: number,
  ): Promise<HistogramConfig | null>;

  /** Set per-series histogram bin options (overrides chart-level histogram config). */
  setSeriesBinOptions(
    chartTarget: ChartTarget,
    seriesIndex: number,
    options: HistogramConfig,
  ): Promise<ChartMutationReceipt>;

  /** Get per-series box/whisker options, or null if not set (falls back to chart-level). */
  getSeriesBoxwhiskerOptions(
    chartTarget: ChartTarget,
    seriesIndex: number,
  ): Promise<BoxplotConfig | null>;

  /** Set per-series box/whisker options (overrides chart-level boxplot config). */
  setSeriesBoxwhiskerOptions(
    chartTarget: ChartTarget,
    seriesIndex: number,
    options: BoxplotConfig,
  ): Promise<ChartMutationReceipt>;

  // ===========================================================================
  // Group E: Point Formatting (2j)
  // ===========================================================================

  /** Format an individual data point within a series. */
  formatPoint(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
    format: { fill?: string; border?: ChartBorder },
  ): Promise<ChartMutationReceipt>;

  /** Set the data label configuration for an individual data point. */
  setPointDataLabel(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
    config: DataLabelConfig,
  ): Promise<ChartMutationReceipt>;

  // ===========================================================================
  // Group F: Trendline CRUD
  // ===========================================================================

  /** Add a trendline to a series. Returns the new trendline index. */
  addTrendline(
    chartTarget: ChartTarget,
    seriesIndex: number,
    config: TrendlineConfig,
  ): Promise<ChartMutationReceipt>;

  /** Update a trendline on a series by index. */
  updateTrendline(
    chartTarget: ChartTarget,
    seriesIndex: number,
    trendlineIndex: number,
    updates: Partial<TrendlineConfig>,
  ): Promise<ChartMutationReceipt>;

  /** Remove a trendline from a series by index. */
  removeTrendline(
    chartTarget: ChartTarget,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<ChartMutationReceipt>;

  /** Get a trendline configuration by index, or null if not found. */
  getTrendline(
    chartTarget: ChartTarget,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<TrendlineConfig | null>;

  /** Get the number of trendlines on a series. */
  getTrendlineCount(chartTarget: ChartTarget, seriesIndex: number): Promise<number>;

  // ===========================================================================
  // Group I: Data Table
  // ===========================================================================

  /** Get the chart's data table configuration, or null if none. */
  getDataTable(chartTarget: ChartTarget): Promise<DataTableConfig | null>;

  // ===========================================================================
  // Group J: Convenience Methods
  // ===========================================================================

  /** Get a chart by its positional index, or null if out of range. */
  getItemAt(index: number): Promise<Chart | null>;

  /** Set the bubble sizes range for a series (A1 notation). */
  setBubbleSizes(
    chartTarget: ChartTarget,
    seriesIndex: number,
    range: string,
  ): Promise<ChartMutationReceipt>;

  // ===========================================================================
  // Group M: Collection Events
  // ===========================================================================

  /** Register a handler for chart activation events. Returns a CallableDisposable. */
  onActivated(handler: (args: { chartId: string }) => void): CallableDisposable;

  /** Register a handler for chart deactivation events. Returns a CallableDisposable. */
  onDeactivated(handler: (args: { chartId: string }) => void): CallableDisposable;

  // ===========================================================================
  // Axis methods
  // ===========================================================================

  /** Get an axis by spreadsheet special-cell typetype/group identifiers. */
  getAxisItem(
    chartTarget: ChartTarget,
    type: 'category' | 'value' | 'series',
    group: 'primary' | 'secondary',
  ): Promise<SingleAxisConfig | null>;

  /** Set axis title by semantic axis role. Title text is stored literally. */
  setAxisTitle(
    chartTarget: ChartTarget,
    axisType: ChartAxisRole,
    title: string,
  ): Promise<ChartMutationReceipt>;

  /** Set axis visibility by semantic axis role. */
  setAxisVisible(
    chartTarget: ChartTarget,
    axisRole: ChartAxisRole,
    visible: boolean,
  ): Promise<ChartMutationReceipt>;

  /** Set legend visibility with chart-app-model semantics. */
  setLegendVisible(chartTarget: ChartTarget, visible: boolean): Promise<ChartMutationReceipt>;

  /** Set chart title visibility without requiring callers to patch raw title fields. */
  setChartTitleVisible(chartTarget: ChartTarget, visible: boolean): Promise<ChartMutationReceipt>;

  /** Switch source orientation when supported, otherwise return an explicit no-op/unsupported receipt. */
  switchSeriesOrientation(chartTarget: ChartTarget): Promise<ChartMutationReceipt>;

  /** Set category axis labels from a cell range (A1 notation). */
  setCategoryNames(chartTarget: ChartTarget, range: string): Promise<ChartMutationReceipt>;

  // ===========================================================================
  // Series dimension methods
  // ===========================================================================

  /** Get computed values for a series dimension. */
  getSeriesDimensionValues(
    chartTarget: ChartTarget,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<(string | number)[]>;

  /** Get the range/formula string for a series dimension. */
  getSeriesDimensionDataSourceString(
    chartTarget: ChartTarget,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string>;

  /** Get the data source type for a series dimension ('range' | 'literal' | 'formula'). */
  getSeriesDimensionDataSourceType(
    chartTarget: ChartTarget,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string>;

  // ===========================================================================
  // Data label methods
  // ===========================================================================

  /** Get a rich text substring from a data label. */
  getDataLabelSubstring(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
    start: number,
    length: number,
  ): Promise<ChartFormatString>;

  /** Set the height of a data label. */
  setDataLabelHeight(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<ChartMutationReceipt>;

  /** Set the width of a data label. */
  setDataLabelWidth(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<ChartMutationReceipt>;

  /** Get the tail anchor point for a data label's leader line. */
  getDataLabelTailAnchor(
    chartTarget: ChartTarget,
    seriesIndex: number,
    pointIndex: number,
  ): Promise<{ row: number; col: number }>;

  // ===========================================================================
  // Title methods
  // ===========================================================================

  /** Set chart title from a formula string. */
  setTitleFormula(chartTarget: ChartTarget, formula: string): Promise<void>;

  /** Get a rich text substring from the chart title. */
  getTitleSubstring(
    chartTarget: ChartTarget,
    start: number,
    length: number,
  ): Promise<ChartFormatString>;

  // ===========================================================================
  // Chart activation
  // ===========================================================================

  /** Activate (select + focus) a chart. Emits 'chart:selected' event and scrolls chart into view. */
  activate(chartTarget: ChartTarget): Promise<ChartActivateReceipt>;
}
