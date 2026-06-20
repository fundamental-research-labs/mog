/**
 * Chart Types - Internal & Re-exports
 *
 * Public chart type definitions are canonical in @mog-sdk/contracts/data/charts.
 * This file:
 * 1. Re-exports all public types for backwards compatibility
 * 2. Defines StoredChartConfig (extends ChartConfig with internal-only fields)
 * 3. Defines runtime types (ChartData, ChartInstance, etc.)
 * 4. Defines advanced type-level machinery (TypedChartConfig, SubTypeFor, etc.)
 */

import type { CellId, CellIdRange } from '@mog-sdk/contracts/cell-identity';

// =============================================================================
// Re-export all public types from contracts (backwards compatibility)
// =============================================================================

export type {
  AreaSubType,
  AxisConfig,
  AxisType,
  BarSubType,
  Chart,
  ChartAnchorMode,
  ChartColor,
  ChartColorMapOverride,
  ChartColorMapping,
  ChartConfig,
  ChartFill,
  ChartFormat,
  ChartLeaderLinesFormat,
  ChartLineFormat,
  ChartLineSettings,
  ChartSeriesCategoryLevelCache,
  ChartSeriesCategoryLevelsCache,
  ChartSeriesDimensionSourceKind,
  ChartSeriesXRole,
  ChartSeriesStockRole,
  ChartSurfaceBandFormat,
  ChartSeriesPointCache,
  ChartSeriesPointCachePoint,
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnostic,
  ChartSeriesProjectionDiagnosticReason,
  ChartShadow,
  ChartLegendEntryIndexKind,
  ChartLegendEntryVocabulary,
  ChartSemanticLayer,
  ChartStyleContext,
  ChartStyleDiagnostic,
  ChartStyleOwner,
  ChartWorkbookThemeColor,
  ChartWorkbookThemeData,
  ChartType,
  DataLabelConfig,
  ErrorBarConfig,
  ErrorBarSource,
  BoxplotConfig,
  HeatmapConfig,
  HierarchyChartConfig,
  HierarchyChartRow,
  HistogramConfig,
  ImageExportFormat,
  ImageExportOptions,
  LegendConfig,
  LegendPosition,
  LineSubType,
  MarkerStyle,
  PieSliceConfig,
  PivotChartProjectionData,
  PointFormat,
  RadarSubType,
  ResolvedChartLegendEntrySnapshot,
  ResolvedChartProjectedRoleMappingSnapshot,
  ResolvedChartSourceSeriesSnapshot,
  SeriesConfig,
  SeriesOrientation,
  SingleAxisConfig,
  SunburstConfig,
  StockExactnessEvidenceStatus,
  StockSourceComposition,
  StockSourceKind,
  StockSubType,
  StockVolumeAxisPolicy,
  TreemapConfig,
  TrendlineConfig,
  TrendlineLabelConfig,
  TrendlineType,
  UpDownBarsConfig,
  RegionMapConfig,
  ViolinConfig,
  WaterfallConfig,
} from '@mog-sdk/contracts/data/charts';

// Import types we need to reference in this file
import type {
  AreaSubType,
  BarSubType,
  ChartAnchorMode,
  ChartConfig,
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnostic,
  ChartSeriesProjectionDiagnosticReason,
  ChartType,
  PivotChartProjectionData,
  LineSubType,
  RadarSubType,
  StockSubType,
} from '@mog-sdk/contracts/data/charts';

// =============================================================================
// Type-level machinery (stays in charts package)
// =============================================================================

/**
 * Valid subType for each chart type.
 * Use with TypedChartConfig<T> for compile-time validation that
 * subType matches the chart type.
 */
export type SubTypeFor<T extends ChartType> = T extends 'bar' | 'column' | 'bar3d' | 'column3d'
  ? BarSubType
  : T extends 'line' | 'line3d'
    ? LineSubType
    : T extends 'area' | 'area3d'
      ? AreaSubType
      : T extends 'stock'
        ? StockSubType
        : T extends 'radar'
          ? RadarSubType
          : never;

/**
 * Chart-type-specific fields that only apply to certain chart types.
 * Used by TypedChartConfig to constrain which fields are available.
 *
 * Field ownership:
 *   pieSlice                       -> pie, doughnut
 *   trendline                      -> scatter, bubble, line, area
 *   showLines, smoothLines         -> scatter, bubble
 *   radarFilled, radarMarkers      -> radar
 *   waterfall                      -> waterfall
 *   histogram                      -> histogram
 *   boxplot                        -> boxplot
 *   hierarchy                      -> treemap, sunburst
 *   regionMap                      -> regionMap
 */
type PieFields = 'pieSlice';
type TrendlineFields = 'trendline';
type ScatterOnlyFields = 'showLines' | 'smoothLines';
type RadarFields = 'radarFilled' | 'radarMarkers';
type WaterfallFields = 'waterfall';
type HistogramFields = 'histogram';
type BoxplotFields = 'boxplot';
type HierarchyFields = 'hierarchy' | 'treemap' | 'sunburst';
type RegionMapFields = 'regionMap';

/**
 * All chart-type-specific field names.
 */
type AllChartSpecificFields =
  | PieFields
  | TrendlineFields
  | ScatterOnlyFields
  | RadarFields
  | WaterfallFields
  | HistogramFields
  | BoxplotFields
  | HierarchyFields
  | RegionMapFields;

/**
 * Fields to omit for chart type T (fields that don't apply to that type).
 *
 * Each chart type gets only its relevant fields; everything else is omitted.
 * This prevents invalid combinations like `pieSlice` on a bar chart or
 * `radarFilled` on a scatter chart.
 */
type OmitFieldsFor<T extends ChartType> =
  // Pie/doughnut (including 3D and ofPie): only pieSlice
  T extends 'pie' | 'doughnut' | 'pie3d' | 'ofPie'
    ? Exclude<AllChartSpecificFields, PieFields>
    : // Scatter/bubble: trendline + scatter-only fields (showLines, smoothLines)
      T extends 'scatter' | 'bubble'
      ? Exclude<AllChartSpecificFields, TrendlineFields | ScatterOnlyFields>
      : // Line/area (including 3D): trendline only (no scatter-only fields like showLines)
        T extends 'line' | 'area' | 'line3d' | 'area3d'
        ? Exclude<AllChartSpecificFields, TrendlineFields>
        : // Radar: radar fields only
          T extends 'radar'
          ? Exclude<AllChartSpecificFields, RadarFields>
          : // Waterfall: waterfall fields only
            T extends 'waterfall'
            ? Exclude<AllChartSpecificFields, WaterfallFields>
            : T extends 'histogram'
              ? Exclude<AllChartSpecificFields, HistogramFields>
              : T extends 'boxplot'
                ? Exclude<AllChartSpecificFields, BoxplotFields>
                : T extends 'treemap' | 'sunburst'
                  ? Exclude<AllChartSpecificFields, HierarchyFields>
                  : T extends 'regionMap'
                    ? Exclude<AllChartSpecificFields, RegionMapFields>
                    : // Stock: no type-specific fields (uses subType and series config)
                      T extends 'stock'
                      ? AllChartSpecificFields
                      : // All other chart types (bar, column, combo, funnel, 3D bar/column, surface): no specific fields
                        AllChartSpecificFields;

/**
 * Type-safe chart config where subType and chart-specific fields are
 * constrained to match the chart type. Prevents invalid combinations like
 * type: 'line' with subType: 'clustered' or pieSlice on a bar chart.
 *
 * Field availability by chart type:
 *   pie/doughnut  -> pieSlice
 *   scatter/bubble -> trendline, showLines, smoothLines
 *   line/area     -> trendline (no showLines/smoothLines)
 *   radar         -> radarFilled, radarMarkers
 *   waterfall     -> waterfall
 *   bar/column/combo/funnel/stock -> (no type-specific fields)
 *
 * @example
 * const config: TypedChartConfig<'bar'> = {
 *   type: 'bar',
 *   subType: 'clustered', // OK - BarSubType
 *   // pieSlice: ...,     // Error - not available on bar charts
 *   // trendline: ...,    // Error - not available on bar charts
 * };
 * const pie: TypedChartConfig<'pie'> = {
 *   type: 'pie',
 *   pieSlice: { explodedIndex: 0 }, // OK - PieSliceConfig
 * };
 * const scatter: TypedChartConfig<'scatter'> = {
 *   type: 'scatter',
 *   trendline: { show: true, type: 'linear' }, // OK
 *   showLines: true,                            // OK
 * };
 * const line: TypedChartConfig<'line'> = {
 *   type: 'line',
 *   trendline: { show: true, type: 'linear' }, // OK - trendline on line
 *   // showLines: true,                         // Error - scatter-only
 * };
 */
export type TypedChartConfig<T extends ChartType = ChartType> = Omit<
  StoredChartConfig,
  'type' | 'subType' | OmitFieldsFor<T>
> & {
  type: T;
  subType?: SubTypeFor<T>;
};

// =============================================================================
// StoredChartConfig - Internal storage shape (extends public ChartConfig)
// =============================================================================

/**
 * Full chart configuration stored in Yjs.
 *
 * Extends the public ChartConfig with internal-only fields:
 * - id: Required for stored charts
 * - CellId-based positioning (CRDT-safe)
 * - CellIdRange-based data binding (CRDT-safe)
 * - Z-order, table linking, metadata
 *
 * Charts now use Cell Identity Model for CRDT-safe
 * positioning and data ranges. Position-based fields are deprecated but
 * supported for backwards compatibility during migration.
 *
 * New fields:
 * - anchorCellId: CellId-based position anchor (replaces anchorRow/anchorCol)
 * - dataRangeIdentity: CellIdRange-based data range (replaces dataRange A1 string)
 *
 * Resolution: Call resolveCellIdRange() at render/extraction time to get positions.
 */
export interface StoredChartConfig extends ChartConfig {
  id: string;

  // ==========================================================================
  // Position: CellId-based (CRDT-safe) - NEW
  // ==========================================================================

  /** Primary anchor cell (top-left). Chart moves when this cell moves. */
  anchorCellId?: CellId;

  /** Secondary anchor cell for twoCell mode. Chart resizes when corners move. */
  endAnchorCellId?: CellId;

  /** Anchor mode - how chart tracks cell changes. Default: 'oneCell' */
  anchorMode?: ChartAnchorMode;

  // ==========================================================================
  // Data binding: CellIdRange-based (CRDT-safe) - NEW
  // ==========================================================================

  /** Chart data range using CellId corners. Automatically expands when rows/cols inserted. */
  dataRangeIdentity?: CellIdRange;

  /** Series labels range using CellId corners. */
  seriesRangeIdentity?: CellIdRange;

  /** Category labels range using CellId corners. */
  categoryRangeIdentity?: CellIdRange;

  // ==========================================================================
  // Metadata
  // ==========================================================================

  sheetId?: string;
  createdAt?: number;
  updatedAt?: number;

  // Z-Order
  /**
   * Z-index for layering charts on the overlay.
   * Higher values render on top of lower values.
   * Default: 0 (uses creation order)
   */
  zIndex?: number;

  // ==========================================================================
  // Table Linking
  // ==========================================================================

  /**
   * ID of the source table this chart is linked to.
   * When set, the chart's data range automatically updates with the table.
   */
  sourceTableId?: string;

  /**
   * Specific table column names to use for data series.
   * If not set, uses all data columns from the table.
   */
  tableDataColumns?: string[];

  /**
   * Table column name to use for categories/X-axis.
   */
  tableCategoryColumn?: string;

  /**
   * Whether to use table column names as series labels.
   * Default: true when linked to a table.
   */
  useTableColumnNamesAsLabels?: boolean;

  /**
   * Cached table column names for legend display.
   * Updated when refreshChartTableLink is called.
   */
  tableColumnNames?: string[];
}

/**
 * Serialized chart for Yjs storage
 */
export interface SerializedChart extends StoredChartConfig {
  // All StoredChartConfig fields are serializable
}

/**
 * Input type for creating a new chart.
 * The id is optional because it's auto-generated if not provided.
 */
export type CreateChartInput = Omit<StoredChartConfig, 'id'> & { id?: string };

// =============================================================================
// Runtime Types (stay in charts package)
// =============================================================================

/**
 * Provenance for a chart point's numeric value before render fallback normalization.
 *
 * Chart rendering keeps `y` as a finite number for compatibility. When source
 * data cannot produce a real finite value, extracted chart data preserves why
 * the point was rendered with a fallback value.
 */
export type ChartDataPointValueState = 'value' | 'blank' | 'nonFinite' | 'nonNumeric' | 'hidden';

/**
 * Chart data point
 */
export interface ChartDataPoint {
  x: string | number;
  /**
   * Finite numeric value used by renderers. Blank, non-finite, or non-numeric
   * source values may be represented as `0` here for existing chart behavior.
   */
  y: number;
  /**
   * Source value state for points whose rendered `y` may not match the source.
   * Undefined means the point has no explicit provenance, which legacy callers
   * can treat as a normal value.
   */
  valueState?: ChartDataPointValueState;
  name?: string;
  value?: number; // For pie charts
  size?: number; // For bubble charts
  open?: number; // OHLC fields for stock charts
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

/**
 * Chart data series
 */
export interface ChartDataSeries {
  name: string;
  data: ChartDataPoint[];
  type?: ChartType;
  color?: string;
  yAxisIndex?: 0 | 1;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  visibleOrder?: number;
  pivotSeriesKey?: string;
  pivotDataFieldIndex?: number;
  projectionAuthority?: ChartSeriesProjectionAuthority;
  projectionDiagnostics?: ChartSeriesProjectionDiagnostic[];
}

/**
 * One rendered category label level, aligned to ChartData.categories by index.
 */
export interface ChartCategoryLevelData {
  level: number;
  labels: Array<string | null>;
}

/**
 * Extracted chart data ready for rendering
 */
export interface ChartData {
  categories: (string | number)[];
  /** Optional multi-level category labels preserved from imported chart caches. */
  categoryLevels?: ChartCategoryLevelData[];
  /** Optional per-category number format codes for axis label rendering. */
  categoryFormatCodes?: Array<string | null | undefined>;
  series: ChartDataSeries[];
}

/**
 * Chart instance state
 */
export interface ChartInstance {
  id: string;
  config: StoredChartConfig;
  data: ChartData;
  element?: HTMLElement;
  dispose: () => void;
  update: (config: Partial<StoredChartConfig>) => void;
  setData: (data: ChartData) => void;
  resize: () => void;
  /** Export chart as image data URL */
  exportImage: (
    options?: import('@mog-sdk/contracts/data/charts').ImageExportOptions,
  ) => string | null;
}

/**
 * Chart creation options
 */
export interface ChartCreateOptions {
  container: HTMLElement;
  config: StoredChartConfig;
  data?: ChartData;
  theme?: 'light' | 'dark';
}

/**
 * Default chart colors.
 * Imported from utils/colors for a single source of truth.
 * Uses D3's category10 palette for broad compatibility.
 *
 * NOTE: Imported from `utils/colors` (not `grammar/encoding-resolver`)
 * because `encoding-resolver` transitively imports `utils/colors`, which
 * imports from this `types/` tree via the barrel — forming a cycle.
 * The palette's canonical home is `utils/colors`.
 */
import { DEFAULT_CATEGORY_COLORS } from '../utils/colors';
export const DEFAULT_CHART_COLORS = DEFAULT_CATEGORY_COLORS;

/**
 * Default chart configuration
 */
export const DEFAULT_CHART_CONFIG: Partial<StoredChartConfig> = {
  width: 480,
  height: 225,
  legend: {
    show: true,
    position: 'bottom',
    visible: true,
  },
  axis: {
    xAxis: {
      type: 'category',
      visible: true,
      gridLines: false,
    },
    yAxis: {
      type: 'value',
      visible: true,
      gridLines: true,
    },
  },
  dataLabels: {
    show: false,
  },
  colors: DEFAULT_CHART_COLORS,
};
