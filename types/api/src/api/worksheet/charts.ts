/**
 * WorksheetCharts — Sub-API Interface for Chart Operations
 *
 * CRUD operations plus convenience, z-order, table-linking,
 * series manipulation, and point formatting methods.
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
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
  SeriesConfig,
  SingleAxisConfig,
  TrendlineConfig,
} from '../types';

/**
 * ChartImageExporter — Injectable dependency for chart image export.
 *
 * The kernel does not own raster surfaces. Browser and Node hosts inject a
 * platform exporter that compiles chart marks through IChartBridge and renders
 * those marks to an image.
 */
export interface ChartImageExporter {
  exportImage(
    sheetId: string,
    chartId: string,
    options?: ImageExportOptions,
  ): Promise<string | null>;
}

export interface WorksheetCharts {
  // ===========================================================================
  // Core CRUD (Wave 1)
  // ===========================================================================

  /** Add a chart to the sheet. Returns the created chart. */
  add(config: ChartConfig): Promise<Chart>;

  /** Get a chart by ID, or null if not found. */
  get(chartId: string): Promise<Chart | null>;

  /** Update a chart's configuration. */
  update(chartId: string, updates: Partial<ChartConfig>): Promise<void>;

  /** Remove a chart by ID. */
  remove(chartId: string): Promise<void>;

  /** List all charts in the sheet. */
  list(): Promise<Chart[]>;

  /** Remove all charts from the sheet. */
  clear(): Promise<void>;

  // ===========================================================================
  // Group A: Simple Convenience Methods (2a-2f)
  // ===========================================================================

  /** Duplicate a chart, offsetting the copy by 2 rows. Returns the new chart ID. */
  duplicate(chartId: string): Promise<string>;

  /**
   * Export a chart as an image.
   *
   * Supported formats are PNG and JPEG. SVG and other unsupported formats
   * reject explicitly instead of falling back to another image type.
   * Browser exports render through the app canvas backend; Node SDK exports
   * render through the native headless raster backend.
   */
  exportImage(chartId: string, options?: ImageExportOptions): Promise<string>;

  /** Set a chart's data range (A1 notation). */
  setDataRange(chartId: string, range: string): Promise<void>;

  /** Set a chart's type and optional sub-type. */
  setType(chartId: string, type: ChartType, subType?: string): Promise<void>;

  /** Check if a chart exists by ID. */
  has(chartId: string): Promise<boolean>;

  /** Get the total number of charts on this sheet. */
  getCount(): Promise<number>;

  /** Find a chart by its name, or null if not found. */
  getByName(name: string): Promise<Chart | null>;

  // ===========================================================================
  // Group B: Z-Order Methods (2g)
  // ===========================================================================

  /** Bring a chart to the front (highest z-index). */
  bringToFront(chartId: string): Promise<void>;

  /** Send a chart to the back (lowest z-index). */
  sendToBack(chartId: string): Promise<void>;

  /** Bring a chart forward by one layer. */
  bringForward(chartId: string): Promise<void>;

  /** Send a chart backward by one layer. */
  sendBackward(chartId: string): Promise<void>;

  // ===========================================================================
  // Group C: Table-Linking Methods (2h)
  // ===========================================================================

  /** Link a chart to a table so it auto-updates with the table's data. */
  linkToTable(chartId: string, tableId: string): Promise<void>;

  /** Unlink a chart from its source table. */
  unlinkFromTable(chartId: string): Promise<void>;

  /** Check whether a chart is linked to a table. */
  isLinkedToTable(chartId: string): Promise<boolean>;

  // ===========================================================================
  // Group D: Series Methods (2i)
  // ===========================================================================

  /** Add a data series to a chart. Returns the new series index. */
  addSeries(chartId: string, config: SeriesConfig): Promise<number>;

  /** Remove a data series by index. */
  removeSeries(chartId: string, index: number): Promise<void>;

  /** Get a data series by index. */
  getSeries(chartId: string, index: number): Promise<SeriesConfig>;

  /** Update a data series at the given index. */
  updateSeries(chartId: string, index: number, updates: Partial<SeriesConfig>): Promise<void>;

  /** Get the number of data series in a chart. */
  getSeriesCount(chartId: string): Promise<number>;

  /** Reorder a series from one index to another. */
  reorderSeries(chartId: string, fromIndex: number, toIndex: number): Promise<void>;

  /** Set the values range for a series (A1 notation). */
  setSeriesValues(chartId: string, index: number, range: string): Promise<void>;

  /** Set the categories range for a series (A1 notation). */
  setSeriesCategories(chartId: string, index: number, range: string): Promise<void>;

  // ===========================================================================
  // Group D2: Per-Series Statistical Options
  // ===========================================================================

  /** Get per-series histogram bin options, or null if not set (falls back to chart-level). */
  getSeriesBinOptions(chartId: string, seriesIndex: number): Promise<HistogramConfig | null>;

  /** Set per-series histogram bin options (overrides chart-level histogram config). */
  setSeriesBinOptions(
    chartId: string,
    seriesIndex: number,
    options: HistogramConfig,
  ): Promise<void>;

  /** Get per-series box/whisker options, or null if not set (falls back to chart-level). */
  getSeriesBoxwhiskerOptions(chartId: string, seriesIndex: number): Promise<BoxplotConfig | null>;

  /** Set per-series box/whisker options (overrides chart-level boxplot config). */
  setSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
    options: BoxplotConfig,
  ): Promise<void>;

  // ===========================================================================
  // Group E: Point Formatting (2j)
  // ===========================================================================

  /** Format an individual data point within a series. */
  formatPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    format: { fill?: string; border?: ChartBorder },
  ): Promise<void>;

  /** Set the data label configuration for an individual data point. */
  setPointDataLabel(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    config: DataLabelConfig,
  ): Promise<void>;

  // ===========================================================================
  // Group F: Trendline CRUD
  // ===========================================================================

  /** Add a trendline to a series. Returns the new trendline index. */
  addTrendline(chartId: string, seriesIndex: number, config: TrendlineConfig): Promise<number>;

  /** Remove a trendline from a series by index. */
  removeTrendline(chartId: string, seriesIndex: number, trendlineIndex: number): Promise<void>;

  /** Get a trendline configuration by index, or null if not found. */
  getTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<TrendlineConfig | null>;

  /** Get the number of trendlines on a series. */
  getTrendlineCount(chartId: string, seriesIndex: number): Promise<number>;

  // ===========================================================================
  // Group I: Data Table
  // ===========================================================================

  /** Get the chart's data table configuration, or null if none. */
  getDataTable(chartId: string): Promise<DataTableConfig | null>;

  // ===========================================================================
  // Group J: Convenience Methods
  // ===========================================================================

  /** Get a chart by its positional index, or null if out of range. */
  getItemAt(index: number): Promise<Chart | null>;

  /** Set the bubble sizes range for a series (A1 notation). */
  setBubbleSizes(chartId: string, seriesIndex: number, range: string): Promise<void>;

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
    chartId: string,
    type: 'category' | 'value' | 'series',
    group: 'primary' | 'secondary',
  ): Promise<SingleAxisConfig | null>;

  /** Set axis title from a formula string. */
  setAxisTitle(chartId: string, axisType: 'category' | 'value', formula: string): Promise<void>;

  /** Set category axis labels from a cell range (A1 notation). */
  setCategoryNames(chartId: string, range: string): Promise<void>;

  // ===========================================================================
  // Series dimension methods
  // ===========================================================================

  /** Get computed values for a series dimension. */
  getSeriesDimensionValues(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<(string | number)[]>;

  /** Get the range/formula string for a series dimension. */
  getSeriesDimensionDataSourceString(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string>;

  /** Get the data source type for a series dimension ('range' | 'literal' | 'formula'). */
  getSeriesDimensionDataSourceType(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string>;

  // ===========================================================================
  // Data label methods
  // ===========================================================================

  /** Get a rich text substring from a data label. */
  getDataLabelSubstring(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    start: number,
    length: number,
  ): Promise<ChartFormatString>;

  /** Set the height of a data label. */
  setDataLabelHeight(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<void>;

  /** Set the width of a data label. */
  setDataLabelWidth(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    value: number,
  ): Promise<void>;

  /** Get the tail anchor point for a data label's leader line. */
  getDataLabelTailAnchor(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
  ): Promise<{ row: number; col: number }>;

  // ===========================================================================
  // Title methods
  // ===========================================================================

  /** Set chart title from a formula string. */
  setTitleFormula(chartId: string, formula: string): Promise<void>;

  /** Get a rich text substring from the chart title. */
  getTitleSubstring(chartId: string, start: number, length: number): Promise<ChartFormatString>;

  // ===========================================================================
  // Chart activation
  // ===========================================================================

  /** Activate (select + focus) a chart. Emits 'chart:selected' event and scrolls chart into view. */
  activate(chartId: string): Promise<void>;
}
