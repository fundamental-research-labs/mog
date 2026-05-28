/**
 * Canonical Chart Type Definitions
 *
 * This is the single source of truth for chart types across the spreadsheet OS.
 * The charts package (@mog/charts) imports from here and extends with
 * internal-only fields (StoredChartConfig).
 *
 * These are pure type definitions only -- no runtime values, no CellId imports.
 * Internal storage concerns (CellId anchors, zIndex, table linking) belong
 * in the charts package's StoredChartConfig.
 */

/**
 * Chart anchor mode - how the chart position tracks cell changes.
 *
 * - 'oneCell': Chart moves with anchor cell, but doesn't resize (default)
 * - 'twoCell': Chart moves and resizes with both anchor cells
 * - 'absolute': Chart position is fixed in pixels, doesn't move with cells
 */
export type ChartAnchorMode = 'oneCell' | 'twoCell' | 'absolute';

/**
 * Supported chart types for spreadsheet charts
 */
export type ChartType =
  | 'bar'
  | 'column'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'bubble'
  | 'combo'
  | 'radar'
  | 'stock'
  | 'funnel'
  | 'waterfall'
  // OOXML roundtrip types
  | 'surface'
  | 'surface3d'
  | 'ofPie'
  | 'bar3d'
  | 'column3d'
  | 'line3d'
  | 'pie3d'
  | 'area3d'
  // Statistical chart types
  | 'histogram'
  | 'boxplot'
  | 'heatmap'
  | 'violin'
  | 'pareto'
  // Hierarchical chart types
  | 'treemap'
  | 'sunburst'
  // Geographic chart types
  | 'regionMap'
  // Exploded pie variants
  | 'pieExploded'
  | 'pie3dExploded'
  | 'doughnutExploded'
  // Bubble with 3D effect
  | 'bubble3DEffect'
  // Surface variants
  | 'surfaceWireframe'
  | 'surfaceTopView'
  | 'surfaceTopViewWireframe'
  // Line with markers
  | 'lineMarkers'
  | 'lineMarkersStacked'
  | 'lineMarkersStacked100'
  // Decorative 3D shape charts (cylinder)
  | 'cylinderColClustered'
  | 'cylinderColStacked'
  | 'cylinderColStacked100'
  | 'cylinderBarClustered'
  | 'cylinderBarStacked'
  | 'cylinderBarStacked100'
  | 'cylinderCol'
  // Decorative 3D shape charts (cone)
  | 'coneColClustered'
  | 'coneColStacked'
  | 'coneColStacked100'
  | 'coneBarClustered'
  | 'coneBarStacked'
  | 'coneBarStacked100'
  | 'coneCol'
  // Decorative 3D shape charts (pyramid)
  | 'pyramidColClustered'
  | 'pyramidColStacked'
  | 'pyramidColStacked100'
  | 'pyramidBarClustered'
  | 'pyramidBarStacked'
  | 'pyramidBarStacked100'
  | 'pyramidCol';

/**
 * Chart sub-types for variations
 */
export type BarSubType = 'clustered' | 'stacked' | 'percentStacked';
export type LineSubType =
  | 'straight'
  | 'smooth'
  | 'stepped'
  | 'stacked'
  | 'percentStacked'
  | 'markers'
  | 'markersStacked'
  | 'markersPercentStacked';
export type AreaSubType = 'standard' | 'stacked' | 'percentStacked';

/**
 * Stock chart sub-types (OHLC = Open-High-Low-Close)
 */
export type StockSubType = 'hlc' | 'ohlc' | 'volume-hlc' | 'volume-ohlc';

/**
 * Radar chart sub-types
 */
export type RadarSubType = 'basic' | 'filled';

/**
 * Data series orientation
 */
export type SeriesOrientation = 'rows' | 'columns';

/**
 * Legend position options
 */
export type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'none' | 'corner' | 'custom';

/**
 * Axis type
 */
export type AxisType = 'category' | 'value' | 'time' | 'log';

/**
 * Trendline types for scatter charts
 */
export type TrendlineType =
  | 'linear'
  | 'exponential'
  | 'logarithmic'
  | 'polynomial'
  | 'power'
  | 'moving-average';

/**
 * Image export format options
 */
export type ImageExportFormat = 'png' | 'jpeg' | 'svg';

// =============================================================================
// Shared Formatting Primitives
// =============================================================================

/** Color: hex string for direct colors, object for theme-aware colors. */
export type ChartColor = string | { theme: string; tintShade?: number };

/** Fill. Maps to OOXML EG_FillProperties. */
export type ChartFill =
  | { type: 'none' }
  | { type: 'solid'; color: ChartColor; transparency?: number }
  | {
      type: 'gradient';
      gradientType: 'linear' | 'radial' | 'rectangular';
      angle?: number;
      stops: { position: number; color: ChartColor; transparency?: number }[];
    }
  | { type: 'pattern'; pattern: string; foreground?: ChartColor; background?: ChartColor };

/** Line/border. Maps to OOXML CT_LineProperties. */
export interface ChartLineFormat {
  color?: ChartColor;
  width?: number;
  dashStyle?: 'solid' | 'dot' | 'dash' | 'dashDot' | 'longDash' | 'longDashDot' | 'longDashDotDot';
  transparency?: number;
}

/** Shared chart border configuration (matches ChartBorderData wire type) */
export interface ChartBorder {
  color?: string;
  width?: number;
  style?: string;
}

/** Font. Maps to OOXML tx_pr → defRPr. */
export interface ChartFont {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: ChartColor;
  underline?:
    | 'none'
    | 'single'
    | 'double'
    | 'singleAccountant'
    | 'doubleAccountant'
    | 'dash'
    | 'dashLong'
    | 'dotDash'
    | 'dotDotDash'
    | 'dotted'
    | 'heavy'
    | 'wavy'
    | 'wavyDouble'
    | 'wavyHeavy'
    | 'words';
  strikethrough?: 'single' | 'double';
}

/** A styled text run for rich text in chart titles and data labels. */
export interface ChartFormatString {
  text: string;
  font?: ChartFont;
}

/** Shadow effect for chart elements. */
export interface ChartShadow {
  visible?: boolean;
  color?: ChartColor;
  blur?: number;
  offsetX?: number;
  offsetY?: number;
  transparency?: number;
}

/** Composite format for a chart element. */
export interface ChartFormat {
  fill?: ChartFill;
  line?: ChartLineFormat;
  font?: ChartFont;
  textRotation?: number;
  shadow?: ChartShadow;
}

/** Shared chart line configuration (legacy — prefer ChartLineFormat) */
export interface ChartLine {
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted' | 'none';
  transparency?: number;
}

// =============================================================================
// Supporting Config Types
// =============================================================================

/** Error bar configuration for series (matches ErrorBarData wire type) */
export interface ErrorBarConfig {
  visible?: boolean;
  direction?: string;
  barType?: string;
  valueType?: string;
  value?: number;
  noEndCap?: boolean;
  lineFormat?: ChartLineFormat;
}

/** Rich title configuration */
export interface TitleConfig {
  text?: string;
  visible?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'overlay';
  font?: ChartFont;
  format?: ChartFormat;
  overlay?: boolean;
  /** Text orientation angle in degrees (-90 to 90) */
  textOrientation?: number;
  richText?: ChartFormatString[];
  formula?: string;
  // Additional title properties
  /** Horizontal text alignment. */
  horizontalAlignment?: 'left' | 'center' | 'right';
  /** Vertical text alignment. */
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  /** Show drop shadow on title. */
  showShadow?: boolean;
  /** Height in points (read-only, populated from render engine). */
  readonly height?: number;
  /** Width in points (read-only, populated from render engine). */
  readonly width?: number;
  /** Left position in points (read-only, populated from render engine). */
  readonly left?: number;
  /** Top position in points (read-only, populated from render engine). */
  readonly top?: number;
}

/** Plot area configuration */
export interface PlotAreaConfig {
  fill?: ChartFill;
  border?: ChartBorder;
  format?: ChartFormat;
}

/** Chart area configuration */
export interface ChartAreaConfig {
  fill?: ChartFill;
  border?: ChartBorder;
  format?: ChartFormat;
}

/** Histogram configuration */
export interface HistogramConfig {
  binCount?: number;
  binWidth?: number;
  cumulative?: boolean;
}

/** Box plot configuration */
export interface BoxplotConfig {
  showOutliers?: boolean;
  showMean?: boolean;
  whiskerType?: 'tukey' | 'minMax' | 'percentile';
}

/** Heatmap configuration */
export interface HeatmapConfig {
  colorScale?: string[];
  showLabels?: boolean;
  minColor?: string;
  maxColor?: string;
}

/** Violin plot configuration */
export interface ViolinConfig {
  showBox?: boolean;
  bandwidth?: number;
  side?: 'both' | 'left' | 'right';
}

/** Treemap chart configuration */
export interface TreemapConfig {
  /** Number of hierarchy levels to display */
  levels?: number;
  /** Show category labels on each rectangle */
  showLabels?: boolean;
  /** Color scale for treemap rectangles */
  colorScale?: string[];
  /** Layout algorithm */
  layoutAlgorithm?: 'squarified' | 'slice' | 'dice' | 'sliceDice';
}

/** Sunburst chart configuration */
export interface SunburstConfig {
  /** Number of hierarchy levels to display */
  levels?: number;
  /** Show category labels on each arc */
  showLabels?: boolean;
  /** Color scale for sunburst arcs */
  colorScale?: string[];
  /** Inner radius as fraction of outer radius (0-1) */
  innerRadius?: number;
}

/** Region map chart configuration */
export interface RegionMapConfig {
  /** Geographic region scope */
  region?: 'world' | 'us' | 'europe' | 'asia' | 'africa' | 'oceania' | 'southAmerica';
  /** Color scale for region fills */
  colorScale?: string[];
  /** Show region labels */
  showLabels?: boolean;
  /** Projection type */
  projection?: 'mercator' | 'equalEarth' | 'naturalEarth';
}

// =============================================================================
// Sub-Config Types
// =============================================================================

/**
 * Waterfall chart configuration for special bars
 */
export interface WaterfallConfig {
  /** Indices that are "total" bars (drawn from zero) */
  totalIndices?: number[];
  /** Color for positive values */
  increaseColor?: string;
  /** Color for negative values */
  decreaseColor?: string;
  /** Color for total bars */
  totalColor?: string;
}

/**
 * Legend configuration (matches LegendData wire type)
 */
export interface LegendConfig {
  show: boolean;
  position: string;
  visible: boolean;
  overlay?: boolean;
  font?: ChartFont;
  format?: ChartFormat;
  entries?: LegendEntryConfig[];
  /** Custom legend X position (0-1, fraction of chart area) when position is 'custom' */
  customX?: number;
  /** Custom legend Y position (0-1, fraction of chart area) when position is 'custom' */
  customY?: number;
  shadow?: ChartShadow;
  // Additional legend properties
  /** Show drop shadow on legend box. */
  showShadow?: boolean;
  /** Legend height in points (read-only, populated from render engine). */
  readonly height?: number;
  /** Legend width in points (read-only, populated from render engine). */
  readonly width?: number;
  /** Legend left position in points (read-only, populated from render engine). */
  readonly left?: number;
  /** Legend top position in points (read-only, populated from render engine). */
  readonly top?: number;
}

/** Legend entry override (show/hide individual entries). */
export interface LegendEntryConfig {
  idx: number;
  delete?: boolean;
  format?: ChartFormat;
  /** Whether this legend entry is visible */
  visible?: boolean;
}

/**
 * Single axis configuration (matches SingleAxisData wire type).
 */
export interface SingleAxisConfig {
  title?: string;
  visible: boolean;
  min?: number;
  max?: number;
  axisType?: string;
  gridLines?: boolean;
  minorGridLines?: boolean;
  majorUnit?: number;
  minorUnit?: number;
  tickMarks?: string;
  minorTickMarks?: string;
  numberFormat?: string;
  reverse?: boolean;
  position?: string;
  logBase?: number;
  displayUnit?: string;
  format?: ChartFormat;
  titleFormat?: ChartFormat;
  gridlineFormat?: ChartLineFormat;
  minorGridlineFormat?: ChartLineFormat;
  crossBetween?: string;
  tickLabelPosition?: string;
  baseTimeUnit?: string;
  majorTimeUnit?: string;
  minorTimeUnit?: string;
  customDisplayUnit?: number;
  displayUnitLabel?: string;
  labelAlignment?: string;
  labelOffset?: number;
  noMultiLevelLabels?: boolean;
  /** Scale type: linear or logarithmic */
  scaleType?: 'linear' | 'logarithmic';
  /** Category axis type */
  categoryType?: 'automatic' | 'textAxis' | 'dateAxis';
  /** Where the axis crosses */
  crossesAt?: 'automatic' | 'max' | 'min' | 'custom';
  /** Custom crossing value when crossesAt is 'custom' */
  crossesAtValue?: number;
  // Additional axis properties
  /** Whether the axis title is visible (separate from title text content). */
  titleVisible?: boolean;
  /** Interval between tick labels (e.g., 1 = every label, 2 = every other). */
  tickLabelSpacing?: number;
  /** Interval between tick marks. */
  tickMarkSpacing?: number;
  /** Whether the number format is linked to the source data cell format. */
  linkNumberFormat?: boolean;
  /** Whether tick marks are between categories (true) or on categories (false) */
  isBetweenCategories?: boolean;
  /** Text orientation angle in degrees (-90 to 90) */
  textOrientation?: number;
  /** Label alignment (alias for labelAlignment) */
  alignment?: string;
  /** @deprecated Alias for axisType — kept for backward compat with charts package */
  type?: AxisType;
  /** @deprecated Alias for visible — kept for backward compat with charts package */
  show?: boolean;
}

/**
 * Axis configuration (matches AxisData wire type).
 *
 * Wire field names: categoryAxis, valueAxis, secondaryCategoryAxis, secondaryValueAxis.
 * Legacy aliases: xAxis, yAxis, secondaryYAxis (mapped in chart-bridge).
 */
export interface AxisConfig {
  // Wire-compatible field names (matches AxisData)
  categoryAxis?: SingleAxisConfig;
  valueAxis?: SingleAxisConfig;
  secondaryCategoryAxis?: SingleAxisConfig;
  secondaryValueAxis?: SingleAxisConfig;

  seriesAxis?: SingleAxisConfig;

  // Legacy aliases — charts package and existing user code may use these
  /** @deprecated Use categoryAxis instead */
  xAxis?: SingleAxisConfig;
  /** @deprecated Use valueAxis instead */
  yAxis?: SingleAxisConfig;
  /** @deprecated Use secondaryValueAxis instead */
  secondaryYAxis?: SingleAxisConfig;
}

/**
 * Data label configuration (matches DataLabelData wire type)
 */
export interface DataLabelConfig {
  show: boolean;
  position?:
    | 'center'
    | 'insideEnd'
    | 'insideBase'
    | 'outsideEnd'
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'bestFit'
    | 'callout'
    | 'outside'
    | 'inside';
  format?: string;
  showValue?: boolean;
  showCategoryName?: boolean;
  /** @deprecated Use showCategoryName instead. Alias kept for legacy consumers. */
  showCategory?: boolean;
  showSeriesName?: boolean;
  showPercentage?: boolean;
  /** @deprecated Use showPercentage instead. Alias kept for legacy consumers. */
  showPercent?: boolean;
  showBubbleSize?: boolean;
  showLegendKey?: boolean;
  separator?: string;
  showLeaderLines?: boolean;
  text?: string;
  visualFormat?: ChartFormat;
  numberFormat?: string;
  /** Text orientation angle in degrees (-90 to 90) */
  textOrientation?: number;
  richText?: ChartFormatString[];
  // Additional data label properties
  /** Whether the label auto-generates text from data. */
  autoText?: boolean;
  /** Horizontal text alignment. */
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify' | 'distributed';
  /** Vertical text alignment. */
  verticalAlignment?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';
  /** Whether the number format is linked to the source data cell format. */
  linkNumberFormat?: boolean;
  /** Callout shape type (e.g., 'rectangle', 'roundRectangle', 'wedgeRoundRectCallout'). */
  geometricShapeType?: string;
  /** Formula-based label text. */
  formula?: string;
  /** X position in points (read-only, populated from render engine). */
  readonly left?: number;
  /** Y position in points (read-only, populated from render engine). */
  readonly top?: number;
  /** Height in points (read-only, populated from render engine). */
  readonly height?: number;
  /** Width in points (read-only, populated from render engine). */
  readonly width?: number;
  /** Leader line formatting configuration. */
  leaderLinesFormat?: ChartLeaderLinesFormat;
}

/**
 * Trendline configuration (matches TrendlineData wire type)
 */
export interface TrendlineConfig {
  show?: boolean;
  type?: string;
  color?: string;
  lineWidth?: number;
  order?: number;
  period?: number;
  forward?: number;
  backward?: number;
  intercept?: number;
  displayEquation?: boolean;
  displayRSquared?: boolean;
  name?: string;
  lineFormat?: ChartLineFormat;
  label?: TrendlineLabelConfig;
  /** @deprecated Use displayEquation instead */
  showEquation?: boolean;
  /** @deprecated Use displayRSquared instead */
  showR2?: boolean;
  /** @deprecated Use forward instead */
  forwardPeriod?: number;
  /** @deprecated Use backward instead */
  backwardPeriod?: number;
}

/** Trendline label configuration. */
export interface TrendlineLabelConfig {
  text?: string;
  format?: ChartFormat;
  numberFormat?: string;
}

/**
 * Pie/doughnut slice configuration (matches PieSliceData wire type)
 */
export interface PieSliceConfig {
  explosion?: number;
  explodedIndices?: number[];
  explodeOffset?: number;
  /** Explode all slices simultaneously */
  explodeAll?: boolean;
}

/**
 * Individual series configuration (matches ChartSeriesData wire type)
 */
export interface SeriesConfig {
  name?: string;
  type?: string;
  color?: string;
  values?: string;
  categories?: string;
  bubbleSize?: string;
  smooth?: boolean;
  explosion?: number;
  invertIfNegative?: boolean;
  yAxisIndex?: number;
  showMarkers?: boolean;
  markerSize?: number;
  markerStyle?: string;
  lineWidth?: number;
  points?: PointFormat[];
  dataLabels?: DataLabelConfig;
  trendlines?: TrendlineConfig[];
  errorBars?: ErrorBarConfig;
  xErrorBars?: ErrorBarConfig;
  yErrorBars?: ErrorBarConfig;
  idx?: number;
  order?: number;
  format?: ChartFormat;
  barShape?: string;
  /** Color to use when a data point is inverted (negative) */
  invertColor?: ChartColor;
  // Additional series properties
  /** Marker fill color. */
  markerBackgroundColor?: ChartColor;
  /** Marker border color. */
  markerForegroundColor?: ChartColor;
  /** Whether this series is hidden/filtered from the chart. */
  filtered?: boolean;
  /** Show drop shadow on series. */
  showShadow?: boolean;
  /** Show connector lines between pie slices (bar-of-pie, pie-of-pie). */
  showConnectorLines?: boolean;
  /** Gap width between bars/columns as percentage (per-series override) */
  gapWidth?: number;
  /** Overlap between bars/columns (-100 to 100, per-series override) */
  overlap?: number;
  /** Hole size for doughnut charts as percentage (per-series override) */
  doughnutHoleSize?: number;
  /** First slice angle for pie/doughnut charts in degrees (per-series override) */
  firstSliceAngle?: number;
  /** Split type for of-pie charts (per-series override) */
  splitType?: string;
  /** Split value threshold for of-pie charts (per-series override) */
  splitValue?: number;
  /** Bubble scale as percentage (per-series override) */
  bubbleScale?: number;
  leaderLineFormat?: ChartFormat;
  showLeaderLines?: boolean;
  /** Per-series histogram bin options (overrides chart-level histogram config) */
  binOptions?: HistogramConfig;
  /** Per-series box/whisker options (overrides chart-level boxplot config) */
  boxwhiskerOptions?: BoxplotConfig;
  /** @deprecated Use trendlines[] instead */
  trendline?: TrendlineConfig;
}

/** Marker style for scatter/line chart markers. */
export type MarkerStyle =
  | 'circle'
  | 'dash'
  | 'diamond'
  | 'dot'
  | 'none'
  | 'picture'
  | 'plus'
  | 'square'
  | 'star'
  | 'triangle'
  | 'x'
  | 'auto';

/**
 * Per-point formatting for individual data points (matches PointFormatData wire type)
 */
export interface PointFormat {
  idx: number;
  fill?: string;
  border?: ChartBorder;
  dataLabel?: DataLabelConfig;
  visualFormat?: ChartFormat;
  // Additional point properties
  /** Readonly: computed value at this point (populated by get, ignored on set). */
  readonly value?: number | string;
  /** Per-point marker fill color. */
  markerBackgroundColor?: ChartColor;
  /** Per-point marker border color. */
  markerForegroundColor?: ChartColor;
  /** Per-point marker size (2-72 points). */
  markerSize?: number;
  /** Per-point marker style. */
  markerStyle?: MarkerStyle;
}

/**
 * Image fitting mode for exports:
 * - 'fill': scale the chart to fill the entire target canvas (may crop)
 * - 'fit': scale the chart to fit within the target dimensions (preserves aspect ratio)
 * - 'fitAndCenter': same as 'fit' but centers the chart within the target canvas
 */
export type ImageFittingMode = 'fill' | 'fit' | 'fitAndCenter';

/**
 * Image export options
 */
export interface ImageExportOptions {
  /** Image format (default: 'png') */
  format?: ImageExportFormat;
  /** Pixel ratio for higher resolution (default: 2) */
  pixelRatio?: number;
  /** Background color (default: '#ffffff') */
  backgroundColor?: string;
  /** Target width in pixels (default: 640) */
  width?: number;
  /** Target height in pixels (default: 480) */
  height?: number;
  /** JPEG quality 0-1 (default: 0.92, only used when format is 'jpeg') */
  quality?: number;
  /** Fitting mode (default: 'fill') */
  fittingMode?: ImageFittingMode;
}

/** Dimension identifiers for series data access. */
export type ChartSeriesDimension = 'categories' | 'values' | 'bubbleSizes';

/** Leader line formatting for data labels. */
export interface ChartLeaderLinesFormat {
  format: ChartLineFormat;
}

/** Pivot chart display options (field button visibility). */
export interface PivotChartOptions {
  /** Show axis field buttons on the chart. */
  showAxisFieldButtons?: boolean;
  /** Show legend field buttons on the chart. */
  showLegendFieldButtons?: boolean;
  /** Show report filter field buttons on the chart. */
  showReportFilterFieldButtons?: boolean;
  /** Show value field buttons on the chart. */
  showValueFieldButtons?: boolean;
}

/** Data table configuration (matches ChartDataTableData wire type). */
export interface DataTableConfig {
  showHorzBorder?: boolean;
  showVertBorder?: boolean;
  showOutline?: boolean;
  showKeys?: boolean;
  format?: ChartFormat;
  /** Whether to show legend keys in the data table */
  showLegendKey?: boolean;
  /** Whether the data table is visible */
  visible?: boolean;
}

// =============================================================================
// Public API Types
// =============================================================================

/**
 * Public chart configuration -- the shape used by the unified API surface.
 *
 * This contains all user-facing fields for creating/updating charts.
 * Internal-only fields (CellId anchors, zIndex, table linking cache)
 * are defined in StoredChartConfig in the charts package.
 */
export interface ChartConfig {
  type: ChartType;
  /** Chart sub-type. For type-safe usage, prefer TypedChartConfig<T> which constrains subType to match type. */
  subType?: BarSubType | LineSubType | AreaSubType | StockSubType | RadarSubType;

  // Position (integer-based)
  /** Anchor row (0-based) */
  anchorRow: number;
  /** Anchor column (0-based) */
  anchorCol: number;
  /** Chart width in cells */
  width: number;
  /** Chart height in cells */
  height: number;

  // Data binding (A1 strings)
  /** Data range in A1 notation (e.g., "A1:D10"). Optional when series[].values are provided. */
  dataRange?: string;
  /** Series labels range in A1 notation */
  seriesRange?: string;
  /** Category labels range in A1 notation */
  categoryRange?: string;

  seriesOrientation?: SeriesOrientation;

  // Appearance
  title?: string | null;
  subtitle?: string;
  legend?: LegendConfig;
  axis?: AxisConfig;
  colors?: string[];

  // Series-specific overrides
  series?: SeriesConfig[];

  // Data labels
  dataLabels?: DataLabelConfig;

  // Pie/Doughnut specific
  pieSlice?: PieSliceConfig;

  // Scatter specific
  /** @deprecated Use trendlines[] instead — kept for backward compat */
  trendline?: TrendlineConfig;
  /** Wire-compatible trendline array */
  trendlines?: TrendlineConfig[];
  /** Connect scatter points with lines (scatter-lines variant) */
  showLines?: boolean;
  /** Use smooth curves for scatter lines (scatter-smooth-lines variant) */
  smoothLines?: boolean;

  // Radar specific
  /** Fill area under radar lines */
  radarFilled?: boolean;
  /** Show markers on radar vertices */
  radarMarkers?: boolean;

  // Chart-level display properties
  /** How blank cells are plotted: 'gap' (leave gap), 'zero' (treat as zero), 'span' (interpolate) */
  displayBlanksAs?: 'gap' | 'zero' | 'span';
  /** Whether to plot only visible cells (respecting row/column hiding) */
  plotVisibleOnly?: boolean;
  /** Gap width between bars/columns as percentage (0-500). Applied to bar/column chart types. */
  gapWidth?: number;
  /** Overlap between bars/columns (-100 to 100). Applied to clustered bar/column types. */
  overlap?: number;
  /** Hole size for doughnut charts as percentage (10-90) */
  doughnutHoleSize?: number;
  /** First slice angle for pie/doughnut charts in degrees (0-360) */
  firstSliceAngle?: number;
  /** Bubble scale for bubble charts as percentage (0-300) */
  bubbleScale?: number;
  /** Split type for of-pie charts (pie-of-pie, bar-of-pie) */
  splitType?: 'auto' | 'value' | 'percent' | 'position' | 'custom';
  /** Split value threshold for of-pie charts */
  splitValue?: number;

  // Waterfall specific
  waterfall?: WaterfallConfig;

  // Statistical chart specific
  histogram?: HistogramConfig;
  boxplot?: BoxplotConfig;
  heatmap?: HeatmapConfig;
  violin?: ViolinConfig;

  // Hierarchical chart specific
  treemap?: TreemapConfig;
  sunburst?: SunburstConfig;

  // Geographic chart specific
  regionMap?: RegionMapConfig;

  // Identity
  name?: string;

  // Rich title and area configs
  chartTitle?: TitleConfig;
  chartArea?: ChartAreaConfig;
  plotArea?: PlotAreaConfig;

  // Rich formatting
  style?: number;
  roundedCorners?: boolean;
  autoTitleDeleted?: boolean;
  showDataLabelsOverMaximum?: boolean;
  chartFormat?: ChartFormat;
  plotFormat?: ChartFormat;
  titleFormat?: ChartFormat;
  titleRichText?: ChartFormatString[];
  titleFormula?: string;
  dataTable?: DataTableConfig;

  // Simple config properties
  /** Which level of multi-level category labels to show (0-based). */
  categoryLabelLevel?: number;
  /** Which level of multi-level series names to show (0-based). */
  seriesNameLevel?: number;
  /** Show/hide all pivot field buttons on the chart. */
  showAllFieldButtons?: boolean;

  // Chart-level series properties
  /** Size of the secondary plot for PieOfPie/BarOfPie charts (5-200%). OOXML c:secondPieSize. */
  secondPlotSize?: number;
  /** Use different colors per category. OOXML c:varyColors (chart-group level). */
  varyByCategories?: boolean;

  // Pivot chart options
  /** Pivot chart display options. */
  pivotOptions?: PivotChartOptions;

  // Z-Order commands (used by chart z-order actions)
  /**
   * Z-order command for layering charts.
   * Accepted as a convenience field by ws.charts.update() to adjust z-index:
   * - 'front': bring to top of stack
   * - 'back': send to bottom of stack
   * - 'forward': move one layer up
   * - 'backward': move one layer down
   */
  zOrder?: 'front' | 'back' | 'forward' | 'backward';

  /** Mark shape for 3D bar/column charts (default: 'box'). Maps to OOXML c:shape. */
  barShape?: 'box' | 'cylinder' | 'cone' | 'pyramid';

  /**
   * Extensible extra data for enriched chart configurations.
   * Contains additional chart-specific settings (e.g., chartTitle font, chartArea fill)
   * that are stored on the chart but not part of the core config schema.
   */
  extra?: unknown;

  // Position in points (Group A)
  /** Chart height in points */
  heightPt?: number;
  /** Chart width in points */
  widthPt?: number;
  /** Left offset in points */
  leftPt?: number;
  /** Top offset in points */
  topPt?: number;

  // 3D effects (Group B3)
  /** Enable 3D bubble effect for bubble charts */
  bubble3DEffect?: boolean;

  // Surface chart options (Group B4)
  /** Render surface chart as wireframe */
  wireframe?: boolean;
  /** Use surface chart top-down view (contour) */
  surfaceTopView?: boolean;

  // Color scheme (Group L)
  /** Chart color scheme index */
  colorScheme?: number;
}

/**
 * Chart as returned by get/list operations.
 *
 * Extends ChartConfig with identity and metadata fields.
 */
export interface Chart extends ChartConfig {
  id: string;
  sheetId?: string;
  createdAt?: number;
  updatedAt?: number;
}
