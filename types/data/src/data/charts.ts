/**
 * Canonical Chart Type Definitions
 *
 * This is the single source of truth for chart types across the spreadsheet OS.
 * The charts package (@mog/charts) imports from here and extends with
 * internal-only fields (StoredChartConfig).
 *
 * These are pure type definitions only -- no runtime values, no CellId imports.
 * Internal storage concerns (CellId anchors, table linking) belong
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
export type RadarSubType = 'basic' | 'markers' | 'filled';

/**
 * Data series orientation
 */
export type SeriesOrientation = 'rows' | 'columns';

/**
 * Legend position options
 */
export type LegendPosition =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topRight'
  | 'top-right'
  | 'tr'
  | 'none'
  | 'corner'
  | 'custom';

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
  dashStyle?:
    | 'solid'
    | 'dot'
    | 'dash'
    | 'dashDot'
    | 'longDash'
    | 'longDashDot'
    | 'longDashDotDot'
    | 'sysDash'
    | 'sysDot'
    | 'sysDashDot'
    | 'sysDashDotDot';
  transparency?: number;
  /** Explicit OOXML a:ln/a:noFill. Absent line formatting is not an explicit no-line. */
  noFill?: boolean;
}

/** Shared chart border configuration (matches ChartBorderData wire type) */
export interface ChartBorder {
  color?: string;
  width?: number;
  style?: 'solid' | 'dot' | 'dash' | 'dashDot' | 'longDash' | 'longDashDot' | 'longDashDotDot';
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

/** Theme color entry exposed by workbook theme data. */
export interface ChartWorkbookThemeColor {
  /** OOXML theme slot name, e.g. `dk1`, `lt1`, `accent1`, `hlink`. */
  name: string;
  /** Resolved RGB color, normally `#RRGGBB`. */
  color: string;
  /** Lossless source payload from import, when available. */
  source?: unknown;
}

/**
 * Workbook theme context passed to the chart style resolver.
 *
 * The public `colors` projection is stable and ergonomic. The optional scheme
 * payloads are deliberately structural so the chart renderer can consume the
 * generated OOXML bridge objects without making contracts depend on generated
 * implementation modules.
 */
export interface ChartWorkbookThemeData {
  colors: ChartWorkbookThemeColor[];
  majorFont?: string | null;
  minorFont?: string | null;
  themePartPath?: string;
  themeRelationshipIdHint?: string;
  themeRelationshipType?: string;
  name?: string;
  colorScheme?: unknown;
  fontScheme?: unknown;
  formatScheme?: unknown;
}

export type ChartStyleDiagnosticDisposition =
  | 'rendered'
  | 'approximated'
  | 'preservedForExportOnly'
  | 'droppedUnsupported'
  | 'droppedStale';

export type ChartStyleDiagnosticSeverity = 'info' | 'warning' | 'error';

/** Style/import diagnostic emitted by the chart style resolver. */
export interface ChartStyleDiagnostic {
  category: string;
  ownerKey: string;
  ooxmlPath?: string;
  severity: ChartStyleDiagnosticSeverity;
  disposition: ChartStyleDiagnosticDisposition;
  feature: string;
  message?: string;
}

/**
 * Chart-local color mapping override. Values are OOXML color-scheme slots such
 * as `Dk1`, `Lt1`, `Accent1`, `Hlink`, and `FolHlink`.
 */
export interface ChartColorMapping {
  bg1?: string;
  tx1?: string;
  bg2?: string;
  tx2?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  accent4?: string;
  accent5?: string;
  accent6?: string;
  hlink?: string;
  folHlink?: string;
}

export type ChartColorMapOverride =
  | { type: 'master' }
  | { type: 'override'; mapping: ChartColorMapping };

/**
 * Unresolved imported chart style sidecar. Rust import will widen this with
 * owner-level DrawingML payloads; TS render code already treats it as the style
 * resolver input and keeps the ergonomic `ChartFormat` fields separate.
 */
export interface ChartStyleContext {
  colorMapOverride?: ChartColorMapOverride;
  diagnostics?: ChartStyleDiagnostic[];
  owners?: ChartStyleOwner[];
}

export interface ChartStyleOwner {
  ownerKey: string;
  sourcePath?: string;
  editOwnerId?: string;
  format?: ChartFormat;
  richText?: ChartFormatString[];
  diagnostics?: ChartStyleDiagnostic[];
  /** Lossless imported DrawingML payload for future resolver/export use. */
  importedDrawingMl?: unknown;
}

/** OOXML chart manual layout target. */
export type ManualLayoutTarget = 'inner' | 'outer';

/** OOXML chart manual layout mode. */
export type ManualLayoutMode = 'edge' | 'factor';

/** Manual chart element layout imported from OOXML `c:manualLayout`. */
export interface ManualLayout {
  layoutTarget?: ManualLayoutTarget;
  xMode?: ManualLayoutMode;
  yMode?: ManualLayoutMode;
  wMode?: ManualLayoutMode;
  hMode?: ManualLayoutMode;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  extLst?: string;
}

/** OOXML DrawingML text vertical mode (`a:bodyPr@vert`). */
export type ChartTextVerticalType =
  | 'horz'
  | 'vert'
  | 'vert270'
  | 'wordArtVert'
  | 'eaVert'
  | 'mongolianVert'
  | 'wordArtVertRtl';

/** Composite format for a chart element. */
export interface ChartFormat {
  fill?: ChartFill;
  line?: ChartLineFormat;
  font?: ChartFont;
  /** Text rotation angle in degrees (`a:bodyPr@rot`, OOXML angle / 60000). */
  textRotation?: number;
  /** DrawingML vertical text mode. This is separate from textRotation. */
  textVerticalType?: ChartTextVerticalType;
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
  plusSource?: ErrorBarSource;
  minusSource?: ErrorBarSource;
}

/** Custom error-bar source formula plus sparse cached values. */
export interface ErrorBarSource {
  formula?: string;
  cache?: ChartSeriesPointCache;
}

/** Rich title configuration */
export interface TitleConfig {
  text?: string;
  visible?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'overlay';
  font?: ChartFont;
  format?: ChartFormat;
  overlay?: boolean;
  /** Text orientation angle in degrees (-90 to 90). Vertical text mode lives on format.textVerticalType. */
  textOrientation?: number;
  richText?: ChartFormatString[];
  formula?: string;
  /** Manual title layout imported from OOXML when representable. */
  layout?: ManualLayout;
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
  /** Manual plot-area layout imported from OOXML when representable. */
  layout?: ManualLayout;
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
  overflowBin?: boolean;
  overflowBinValue?: number;
  underflowBin?: boolean;
  underflowBinValue?: number;
  cumulative?: boolean;
}

/** Box plot configuration */
export interface BoxplotConfig {
  showOutliers?: boolean;
  showOutlierPoints?: boolean;
  showMean?: boolean;
  showMeanMarkers?: boolean;
  showMeanLine?: boolean;
  quartileMethod?: string;
  whiskerType?: 'tukey' | 'minMax' | 'percentile';
}

/** Imported hierarchy row for treemap/sunburst ChartEx projections. */
export interface HierarchyChartRow {
  id: string;
  parentId?: string;
  label: string;
  level: number;
  value?: number;
  categoryFormula?: string;
  valueFormula?: string;
}

/** Typed hierarchy projection for ChartEx treemap/sunburst imports. */
export interface HierarchyChartConfig {
  rows?: HierarchyChartRow[];
  categoryFormulas?: string[];
  valueFormula?: string;
  parentLabelLayout?: string;
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
  /** Imported region category formula from ChartEx projection. */
  regionFormula?: string;
  /** Imported value formula from ChartEx projection. */
  valueFormula?: string;
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
  /** Indices that are subtotal bars in imported ChartEx waterfalls. */
  subtotalIndices?: number[];
  /** Indices that are "total" bars (drawn from zero) */
  totalIndices?: number[];
  /** Whether connector lines between bars are drawn. */
  showConnectorLines?: boolean;
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
  /** Manual legend layout imported from OOXML when representable. */
  layout?: ManualLayout;
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
  /**
   * Whether axis visibility was explicitly authored. Distinguishes omitted
   * visibility defaults from explicit visible axes.
   */
  visibleExplicit?: boolean;
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
  titleRichText?: ChartFormatString[];
  gridlineFormat?: ChartLineFormat;
  minorGridlineFormat?: ChartLineFormat;
  crossBetween?: string;
  tickLabelPosition?: string;
  baseTimeUnit?: string;
  majorTimeUnit?: string;
  minorTimeUnit?: string;
  customDisplayUnit?: number;
  displayUnitLabel?: string;
  displayUnitLabelLayout?: ManualLayout;
  displayUnitLabelFormat?: ChartFormat;
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
  /** Text orientation angle in degrees (-90 to 90). Vertical text mode lives on format.textVerticalType. */
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
  /** Explicit OOXML delete/suppression, distinct from an absent label config. */
  delete?: boolean;
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
  /** Text orientation angle in degrees (-90 to 90). Vertical text mode lives on visualFormat.textVerticalType. */
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
  /** Manual layout imported from OOXML when representable. */
  layout?: ManualLayout;
}

/**
 * Trendline configuration (matches TrendlineData wire type)
 */
export interface TrendlineConfig {
  show?: boolean;
  type?: TrendlineType;
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
  layout?: ManualLayout;
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
 * Imported point cache for a chart data dimension.
 *
 * OOXML chart caches are sparse by point index. An omitted index inside
 * `pointCount` is a meaningful blank/missing point, while an explicit "0"
 * point is a real zero value.
 */
export interface ChartSeriesPointCache {
  /** Logical OOXML point count for the dimension, when supplied by the source. */
  pointCount?: number;
  /** Dimension-wide number format code; point entries may override it. */
  formatCode?: string;
  /** Sparse cached points keyed by OOXML `c:pt/@idx`. */
  points: ChartSeriesPointCachePoint[];
}

export interface ChartSeriesPointCachePoint {
  /** Source point index. Missing indices inside `pointCount` are blanks. */
  idx: number;
  /** Raw OOXML cached point value. Numeric values are preserved as strings. */
  value: string;
  /** Point-level number format override. */
  formatCode?: string;
}

/** Imported multi-level category cache for hierarchical category labels. */
export interface ChartSeriesCategoryLevelsCache {
  /** Logical OOXML point count for the category domain, when supplied by the source. */
  pointCount?: number;
  /** Category label levels in source order. */
  levels: ChartSeriesCategoryLevelCache[];
}

export interface ChartSeriesCategoryLevelCache {
  /** Zero-based level index in source order. */
  level: number;
  /** Logical point count for this level, when supplied by the source. */
  pointCount?: number;
  /** Sparse cached labels keyed by OOXML `c:pt/@idx`. */
  points: ChartSeriesPointCachePoint[];
}

/** Imported chart dimension source authority. */
export type ChartSeriesDimensionSourceKind = 'ref' | 'literal' | 'cacheFallback';

/** Imported x/category dimension role for a series. */
export type ChartSeriesXRole = 'category' | 'quantitative';

/** Imported OOXML category/x source value type. */
export type ChartSeriesCategorySourceType = 'number' | 'string' | 'multiLevelString';

/** Imported stock chart source role for HLC/OHLC and volume stock charts. */
export type ChartSeriesStockRole = 'volume' | 'open' | 'high' | 'low' | 'close';

/** Mechanical authority status for stock exactness evidence. */
export type StockExactnessEvidenceStatus = 'exact' | 'verifiedDefault' | 'approximate' | 'missing';

/** Source composition behind a rendered stock chart. */
export type StockSourceKind = 'singleStockChart' | 'comboVolumeBarStockChart' | 'modeled';

/** Value-axis ownership for stock volume roles. */
export type StockVolumeAxisPolicy = 'stockValueAxis' | 'separateVolumeAxis';

/** Public-safe imported/authored stock source composition contract. */
export interface StockSourceComposition {
  sourceKind: StockSourceKind;
  sourceRoleOrder: ChartSeriesStockRole[];
  sourceRoleSemanticStatus?: StockExactnessEvidenceStatus;
  sourceRoleSemanticSource?: string;
  sourceRoleSemanticReason?: string;
  highLowLines: boolean;
  upDownBars: boolean;
  volumeAxisPolicy: StockVolumeAxisPolicy;
}

/** Semantic layer represented by a resolved chart snapshot field. */
export type ChartSemanticLayer = 'source' | 'projected' | 'rendered' | 'unknown';

/** Vocabulary used by visible legend entries. */
export type ChartLegendEntryVocabulary =
  | 'series'
  | 'category'
  | 'point'
  | 'stockSourceRole'
  | 'valueBand'
  | 'unknown';

/** Index space used by legend entry metadata. */
export type ChartLegendEntryIndexKind =
  | 'series'
  | 'sourceSeries'
  | 'point'
  | 'stockRole'
  | 'valueBand'
  | 'unknown';

/** Render authority used for projected or imported chart series data. */
export type ChartSeriesProjectionAuthority =
  | 'explicitSeries'
  | 'liveRange'
  | 'pivotCache'
  | 'fallbackCache'
  | 'literal'
  | 'unavailable';

/**
 * Reason a source series was filtered, dropped, or intentionally projected into another series.
 * `projectedIntoStockGlyph` means a source OHLC/volume role series is represented by one
 * rendered stock glyph series.
 */
export type ChartSeriesProjectionDiagnosticReason =
  | 'unresolvedPivotSource'
  | 'unsupportedPivotFeature'
  | 'hiddenDataField'
  | 'allItemsFiltered'
  | 'noValueData'
  | 'worksheetHiddenByPlotVisibleOnly'
  | 'styleResolvedNoFillOrLine'
  | 'staleMaterializedRange'
  | 'projectedIntoStockGlyph';

/** Diagnostic explaining why a source series was altered, dropped, or not renderable. */
export interface ChartSeriesProjectionDiagnostic {
  reason: ChartSeriesProjectionDiagnosticReason;
  severity?: ChartStyleDiagnosticSeverity;
  sourceSeriesKey?: string;
  sourceSeriesIndex?: number;
  message?: string;
}

/** Support level for the resolved rendering contract of a chart family. */
export type ChartFamilySupportLevel =
  | 'exact'
  | 'approximate'
  | 'preservedPlaceholder'
  | 'unsupported';

/** Deterministic reason for a chart family's support level. */
export type ChartFamilySupportReason =
  | 'exactRenderer'
  | 'standardRenderer'
  | 'comboLayeredRenderer'
  | 'comboLayeredGeometryApproximation'
  | 'comboLayeredGeometryEvidenceMissing'
  | 'comboLayerAuthorityIncomplete'
  | 'barColumnGeometryApproximation'
  | 'barColumnGeometryEvidenceMissing'
  | 'barColumnRectangleReconciliationMissing'
  | 'barColumnRectangleReconciliationMismatch'
  | 'barColumnValueAxisScaleReconciliationIncomplete'
  | 'pieDoughnutGeometryApproximation'
  | 'pieDoughnutGeometryEvidenceMissing'
  | 'pathCartesianGeometryApproximation'
  | 'pathCartesianGeometryEvidenceMissing'
  | 'pathAxisReservationApproximation'
  | 'pathPlotFrameReservationApproximation'
  | 'pathPlotFrameEvidenceMissing'
  | 'pathAxisCrossingApproximation'
  | 'pathAxisVisualContractIncomplete'
  | 'pathPointAuthorityIncomplete'
  | 'pathLegendRenderMismatch'
  | 'pathLegendOrderMismatch'
  | 'pathValueScalePlanTraceMismatch'
  | 'pathLineVisualContractIncomplete'
  | 'pathMarkerVisualContractIncomplete'
  | 'pathColorAuthorityIncomplete'
  | 'pathBlankMarkerPolicyIncomplete'
  | 'pathLegendSymbolContractIncomplete'
  | 'areaSurfaceStyleEvidenceMissing'
  | 'areaSurfaceStyleApproximation'
  | 'areaSurfaceExtentEvidenceMissing'
  | 'areaSurfaceExtentApproximation'
  | 'comboSecondaryAxisPolicyApproximation'
  | 'xyCartesianGeometryEvidenceMissing'
  | 'xyAxisVisualContractIncomplete'
  | 'scatterVisualContractIncomplete'
  | 'scatterPointAuthorityIncomplete'
  | 'bubbleSizeAuthorityUnresolved'
  | 'bubbleLegendVocabularyUnresolved'
  | 'bubbleColorAuthorityUnresolved'
  | 'bubbleVisualContractIncomplete'
  | 'funnelProportionalBarApproximation'
  | 'funnelProjectionIncomplete'
  | 'waterfallRenderer'
  | 'waterfallProjectionIncomplete'
  | 'histogramRenderer'
  | 'histogramProjectionIncomplete'
  | 'paretoRenderer'
  | 'paretoProjectionIncomplete'
  | 'boxplotRenderer'
  | 'boxplotProjectionIncomplete'
  | 'preservedOnlyChartExFamily'
  | 'stockSourceProjectionIncomplete'
  | 'stockGlyphVisualContractIncomplete'
  | 'stockExactEvidenceIncomplete'
  | 'surface3dFilledApproximation'
  | 'surface3dWireframeApproximation'
  | 'contourFilledApproximation'
  | 'contourWireframeApproximation'
  | 'surfaceApproximation'
  | 'contourApproximation'
  | 'surfaceProjectionIncomplete'
  | 'contourProjectionIncomplete'
  | 'threeDApproximation'
  | 'bubbleLegendSeriesDomain'
  | 'radarLayoutFidelity'
  | 'radarAutoValueScaleFidelity'
  | 'radarBlankPolicyFidelity'
  | 'radarDeterministicApproximation'
  | 'radarMarkerStyleFidelity'
  | 'radarFillStyleFidelity'
  | 'radarStrokeStyleFidelity'
  | 'radarGridLabelStyleFidelity'
  | 'importedExactAuthorityMissing'
  | 'unsupportedImportStatus'
  | 'preservedPlaceholderImportStatus';

export type ChartFamilyExactAuthorityFamily =
  | 'barColumn'
  | 'pieDoughnut'
  | 'stock'
  | 'path'
  | 'xy'
  | 'bubble'
  | 'combo'
  | 'radar'
  | 'specialty';

export type ChartFamilyExactAuthoritySource =
  | 'nativeRenderer'
  | 'importedRendererEvidence'
  | 'excelDefault'
  | 'notApplicable';

export interface ChartFamilyExactAuthoritySnapshot {
  schemaVersion: 1;
  family: ChartFamilyExactAuthorityFamily;
  source: ChartFamilyExactAuthoritySource;
  evidence: string[];
  diagnostics?: string[];
}

/**
 * Public-safe resolved support contract for specialty chart families.
 *
 * This supplements `implementation.renderStatus`, which remains a broad
 * compatibility status. Consumers that need parity semantics should use this
 * versioned contract.
 */
export interface ChartFamilySupportSnapshot {
  schemaVersion: 1;
  family: string;
  sourceFamily?: string;
  supportLevel: ChartFamilySupportLevel;
  reason: ChartFamilySupportReason;
  diagnostics: string[];
  renderedAs?: string;
  exactAuthority?: ChartFamilyExactAuthoritySnapshot;
}

/** Workbook-level pivot chart projection summary used by render diagnostics. */
export interface PivotChartProjectionData {
  sourceRef?: string;
  pivotTableName?: string;
  pivotCacheId?: string | number;
  authority?: ChartSeriesProjectionAuthority;
  expectedImportedSeriesCount?: number;
  projectedSeriesCount?: number;
  renderedSeriesCount?: number;
  diagnostics?: ChartSeriesProjectionDiagnostic[];
}

/**
 * Individual series configuration (matches ChartSeriesData wire type)
 */
export interface SeriesConfig {
  name?: string;
  /** Live series-name cell reference imported from OOXML c:tx/c:strRef/c:f. */
  nameRef?: string;
  type?: string;
  color?: string;
  stockRole?: ChartSeriesStockRole;
  values?: string;
  valueCache?: ChartSeriesPointCache;
  valueSourceKind?: ChartSeriesDimensionSourceKind;
  categories?: string;
  xRole?: ChartSeriesXRole;
  categoryCache?: ChartSeriesPointCache;
  categoryLevels?: ChartSeriesCategoryLevelsCache;
  categorySourceKind?: ChartSeriesDimensionSourceKind;
  categorySourceType?: ChartSeriesCategorySourceType;
  categoryLabelFormat?: CategoryLabelFormat;
  bubbleSize?: string;
  bubbleSizeCache?: ChartSeriesPointCache;
  bubbleSizeSourceKind?: ChartSeriesDimensionSourceKind;
  /** 3-D bubble effect for this series. */
  bubble3d?: boolean;
  /** 3-D bubble effect for this series. */
  bubble3D?: boolean;
  smooth?: boolean;
  showLines?: boolean;
  explosion?: number;
  invertIfNegative?: boolean;
  yAxisIndex?: 0 | 1;
  showMarkers?: boolean;
  markerSize?: number;
  markerStyle?: MarkerStyle;
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
  /** Full marker border/outline format. */
  markerLineFormat?: ChartLineFormat;
  /** Whether this series is hidden/filtered from the chart. */
  filtered?: boolean;
  /** Original chart series index before filtering/projection. */
  sourceSeriesIndex?: number;
  /** Stable source key used to join extracted data back to this series. */
  sourceSeriesKey?: string;
  /** Visible/rendered series order after projection. */
  visibleOrder?: number;
  /** Stable key for projected pivot-chart series. */
  pivotSeriesKey?: string;
  /** Pivot data-field index when this series was projected from a data field. */
  pivotDataFieldIndex?: number;
  /** Data authority used to render this series. */
  projectionAuthority?: ChartSeriesProjectionAuthority;
  /** Projection/render diagnostics associated with this series. */
  projectionDiagnostics?: ChartSeriesProjectionDiagnostic[];
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

/**
 * Category-axis label formatting captured from imported chart category caches.
 * The base format applies to all category values; point overrides replace it by
 * category index.
 */
export interface CategoryLabelFormat {
  formatCode?: string;
  points?: CategoryPointLabelFormat[];
}

/** Per-category label number-format override. */
export interface CategoryPointLabelFormat {
  idx: number;
  formatCode?: string;
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
  invertIfNegative?: boolean;
  explosion?: number;
  bubble3d?: boolean;
  bubble3D?: boolean;
  fill?: string;
  border?: ChartBorder;
  lineFormat?: ChartLineFormat;
  dataLabel?: DataLabelConfig;
  visualFormat?: ChartFormat;
  // Additional point properties
  /** Readonly: computed value at this point (populated by get, ignored on set). */
  readonly value?: number | string;
  /** Per-point marker fill color. */
  markerBackgroundColor?: ChartColor;
  /** Per-point marker border color. */
  markerForegroundColor?: ChartColor;
  /** Per-point marker border/outline format. */
  markerLineFormat?: ChartLineFormat;
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

export interface ChartImageFrame {
  readonly exportWidth: number;
  readonly exportHeight: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly contentX: number;
  readonly contentY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export type ChartExportOptionsSnapshot =
  | {
      readonly kind: 'vector';
      readonly format: 'svg';
      readonly width: number;
      readonly height: number;
      readonly backgroundColor: string;
      readonly fittingMode: ImageFittingMode;
      readonly frame: ChartImageFrame;
    }
  | {
      readonly kind: 'raster';
      readonly format: 'png' | 'jpeg';
      readonly width: number;
      readonly height: number;
      readonly pixelRatio: number;
      readonly physicalWidth: number;
      readonly physicalHeight: number;
      readonly backgroundColor: string;
      readonly quality?: number;
      readonly fittingMode: ImageFittingMode;
      readonly frame: ChartImageFrame;
    };

export interface ChartRangeReferenceSnapshot {
  kind: string;
  source: 'identity' | 'a1';
  ref?: string;
  sheetName?: string;
  range: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

export interface ChartRangeDiagnosticSnapshot {
  kind: string;
  code: string;
  ref?: string;
  sheetName?: string;
  message: string;
}

export interface ResolvedChartAxisSnapshot {
  present: boolean;
  visible?: boolean;
  title?: string;
  axisType?: string;
  scaleType?: string;
  categoryType?: string;
  min?: number;
  max?: number;
  majorUnit?: number;
  minorUnit?: number;
  logBase?: number;
  displayUnit?: string;
  customDisplayUnit?: number;
  displayUnitLabel?: string;
  displayUnitLabelLayout?: ManualLayout;
  displayUnitLabelFormat?: ChartFormat;
  numberFormat?: string;
  linkNumberFormat?: boolean;
  position?: string;
  reverse?: boolean;
  tickMarks?: string;
  minorTickMarks?: string;
  tickLabelPosition?: string;
  tickLabelSpacing?: number;
  tickMarkSpacing?: number;
  crossBetween?: string;
  crossesAt?: 'automatic' | 'max' | 'min' | 'custom';
  crossesAtValue?: number;
  isBetweenCategories?: boolean;
  minorGridLines?: boolean;
  minorGridlineFormat?: ChartLineFormat;
  textOrientation?: number;
}

export interface ResolvedChartLegendSnapshot {
  present: boolean;
  visible?: boolean;
  position?: string;
  rendered?: ResolvedChartRenderedLegendSnapshot;
  entries: string[];
  visibleEntries: string[];
  entryVocabulary?: ChartLegendEntryVocabulary;
  entryLayer?: ChartSemanticLayer;
  entryIndexKind?: ChartLegendEntryIndexKind;
  entryItems?: ResolvedChartLegendEntrySnapshot[];
  visibleEntryItems?: ResolvedChartLegendEntrySnapshot[];
}

export interface ResolvedChartRenderedLegendSnapshot {
  present: boolean;
  visible?: boolean;
  markCount: number;
  sourceChannels?: string[];
  area?: ResolvedChartLayoutRectSnapshot;
  flow?: ResolvedChartRenderedLegendFlowSnapshot;
  entries?: ResolvedChartRenderedLegendEntrySnapshot[];
  mismatchReason?: string;
}

export type ResolvedChartRenderedLegendFlowOrient = 'horizontal' | 'vertical';
export type ResolvedChartRenderedLegendOverflowPolicy = 'none' | 'overflowVisible';

export interface ResolvedChartRenderedLegendEntryBoundsSnapshot {
  entryIndex: number;
  rowIndex: number;
  columnIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  symbolBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  labelBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  drawn: boolean;
  clipped: boolean;
}

export interface ResolvedChartRenderedLegendFlowSnapshot {
  orient: ResolvedChartRenderedLegendFlowOrient;
  entryCount: number;
  renderedEntryCount: number;
  visibleEntryCount: number;
  clippedEntryCount: number;
  rowCount: number;
  columnCount: number;
  rowGap: number;
  entryGap: number;
  contentWidth: number;
  contentHeight: number;
  overflowPolicy: ResolvedChartRenderedLegendOverflowPolicy;
  entries: ResolvedChartRenderedLegendEntryBoundsSnapshot[];
}

export interface ResolvedChartRenderedLegendEntrySnapshot {
  value?: unknown;
  text: string;
  symbolType?: string;
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  pointKey?: string;
  legendKey?: string;
  colorKey?: string;
  stockRole?: ChartSeriesStockRole | string;
}

export interface ResolvedChartLegendEntrySnapshot {
  index: number;
  text: string;
  visible: boolean;
  deleted?: boolean;
  vocabulary: ChartLegendEntryVocabulary;
  indexKind: ChartLegendEntryIndexKind;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  pointKey?: string;
  legendKey?: string;
  colorKey?: string;
  valueBandIndex?: number;
  stockRole?: ChartSeriesStockRole;
}

export interface ResolvedChartCategoryLevelSnapshot {
  level: number;
  labels: Array<string | null>;
}

export type ChartSeriesDimensionRenderAuthority =
  | 'live'
  | 'literal'
  | 'fallbackCache'
  | 'unavailable';

export type ResolvedChartColorAuthoritySource =
  | 'seriesColor'
  | 'seriesFormatFill'
  | 'seriesFormatLine'
  | 'pointFill'
  | 'pointVisualFormat'
  | 'markerForeground'
  | 'markerBackground'
  | 'chartStyleOwner'
  | 'workbookTheme'
  | 'themeRepeat'
  | 'configPalette'
  | 'excelStockRoleDefault'
  | 'defaultPalette'
  | 'unknown';

export interface ResolvedChartPaintAuthoritySnapshot {
  color?: string;
  source: ResolvedChartColorAuthoritySource;
  ownerKey?: string;
  explicit: boolean;
  fallback: boolean;
  themeSlot?: string;
}

export interface ResolvedChartPointColorAuthoritySnapshot {
  pointIndex: number;
  fill?: ResolvedChartPaintAuthoritySnapshot;
  stroke?: ResolvedChartPaintAuthoritySnapshot;
  markerFill?: ResolvedChartPaintAuthoritySnapshot;
  markerStroke?: ResolvedChartPaintAuthoritySnapshot;
}

export interface ResolvedChartColorAuthoritySnapshot {
  ownerKey: string;
  sourceSeriesIndex: number;
  renderedSeriesIndex?: number;
  color?: string;
  source: ResolvedChartColorAuthoritySource;
  explicit: boolean;
  fallback: boolean;
  themeSlot?: string;
  fill?: ResolvedChartPaintAuthoritySnapshot;
  stroke?: ResolvedChartPaintAuthoritySnapshot;
  markerFill?: ResolvedChartPaintAuthoritySnapshot;
  markerStroke?: ResolvedChartPaintAuthoritySnapshot;
  points?: ResolvedChartPointColorAuthoritySnapshot[];
}

export interface ResolvedChartSeriesSnapshot {
  index: number;
  order: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  visibleOrder?: number;
  pivotSeriesKey?: string;
  pivotDataFieldIndex?: number;
  projectionAuthority?: ChartSeriesProjectionAuthority;
  projectionDiagnostics?: ChartSeriesProjectionDiagnostic[];
  name: string;
  type?: string;
  axisGroup: 'primary' | 'secondary';
  xRole?: ChartSeriesXRole;
  stockRole?: ChartSeriesStockRole;
  showLines?: boolean;
  smooth?: boolean;
  showMarkers?: boolean;
  markerStyle?: MarkerStyle;
  renderLayerCount?: number;
  geometry?: ResolvedChartSeriesGeometrySnapshot;
  color?: string;
  colorAuthority?: ResolvedChartColorAuthoritySnapshot;
  source: {
    values?: string;
    categories?: string;
    bubbleSize?: string;
    stockRole?: ChartSeriesStockRole;
    valueSourceKind?: ChartSeriesDimensionSourceKind;
    categorySourceKind?: ChartSeriesDimensionSourceKind;
    bubbleSizeSourceKind?: ChartSeriesDimensionSourceKind;
  };
  renderAuthority: {
    values: ChartSeriesDimensionRenderAuthority;
    categories: ChartSeriesDimensionRenderAuthority;
    bubbleSize: ChartSeriesDimensionRenderAuthority;
  };
  xValues: Array<string | number | null>;
  categories: Array<string | number | null>;
  values: Array<number | null>;
  /** Values on the rendered layer after blank-cell display policy is applied. */
  renderedValues?: Array<number | null>;
  bubbleSizes: Array<number | null>;
  /** Source-length stock role values aligned to original source point indexes. */
  stockValues?: ResolvedChartStockRoleValuesSnapshot;
  blankMask: boolean[];
  pointCount: number;
  renderedPointCount: number;
  dataHash: string;
}

export type ResolvedChartCartesianXGeometryMode = 'categoryPoint' | 'dateSerial' | 'quantitative';

export interface ResolvedChartSeriesGeometrySnapshot {
  xMode: ResolvedChartCartesianXGeometryMode;
  xRole?: ChartSeriesXRole;
  axisGroup: 'primary' | 'secondary';
  stackGroup?: string;
  markerLayer?: boolean;
  bubbleSizeAuthority?: 'series';
}

export interface ResolvedChartSourceSeriesSnapshot {
  index: number;
  order: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  name?: string;
  type?: string;
  visibleOrder?: number;
  axisGroup?: 'primary' | 'secondary';
  xRole?: ChartSeriesXRole;
  stockRole?: ChartSeriesStockRole;
  source: {
    values?: string;
    categories?: string;
    bubbleSize?: string;
    stockRole?: ChartSeriesStockRole;
    valueSourceKind?: ChartSeriesDimensionSourceKind;
    categorySourceKind?: ChartSeriesDimensionSourceKind;
    bubbleSizeSourceKind?: ChartSeriesDimensionSourceKind;
  };
  renderAuthority?: {
    values: ChartSeriesDimensionRenderAuthority;
    categories: ChartSeriesDimensionRenderAuthority;
    bubbleSize: ChartSeriesDimensionRenderAuthority;
  };
  projectionDiagnostics?: ChartSeriesProjectionDiagnostic[];
}

export interface ResolvedChartDroppedSeriesSnapshot {
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  name?: string;
  reason: ChartSeriesProjectionDiagnosticReason;
  message?: string;
  projectedIntoSeriesIndex?: number;
  projectedIntoSourceSeriesKey?: string;
  projectedIntoRole?: ChartSeriesStockRole;
}

export interface ResolvedChartProjectedRoleMappingSnapshot {
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  stockRole: ChartSeriesStockRole;
  projectedSeriesIndex: number;
  projectedSourceSeriesKey: string;
}

export interface ResolvedChartStockRoleValuesSnapshot {
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}

export type ResolvedChartStockGlyphGeometryStatus = 'available' | 'unavailable';
export type ResolvedChartStockGlyphXMode = 'categoryPoint' | 'dateSerial' | 'quantitative';
export type ResolvedChartStockGlyphDirection = 'up' | 'down' | 'flat' | 'unknown';
export type ResolvedChartStockGlyphSegmentRole = 'highLowStem' | 'openTick' | 'closeTick';
export type ResolvedChartStockGlyphVisualStatus = 'available' | 'incomplete';
export type ResolvedChartStockVisualContractStatus = StockExactnessEvidenceStatus;
export type ResolvedChartStockGlyphPriceGlyphMode = 'hlcTick' | 'ohlcTick' | 'upDownBody';
export type ResolvedChartStockGlyphVisualRole =
  | 'volume'
  | 'highLowStem'
  | 'body'
  | 'openTick'
  | 'closeTick';
export type ResolvedChartStockGlyphVisualSource =
  | 'importedHighLowLines'
  | 'importedUpDownBars'
  | 'sourceSeriesFormat'
  | 'volumeSeriesFormat'
  | 'chartStyleDefault'
  | 'excelDefault';
export type ResolvedChartStockSourceRoleLayerMode = 'glyphInputOnly' | 'overlayLayer';

export interface ResolvedChartStockGlyphScaleSnapshot {
  field?: string;
  type?: string;
  domain?: Array<string | number | null>;
  range?: [number, number];
  tickValues?: Array<string | number | null>;
  tickStep?: number;
  scaleAuthorityStatus?: ResolvedChartStockVisualContractStatus;
  scaleAuthority?: string;
  scaleAuthorityReason?: string;
  zeroBaselinePolicy?: string;
  zeroBaselineReason?: string;
}

export interface ResolvedChartStockVolumeSurfaceSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  baselinePixel?: number;
}

export interface ResolvedChartStockGlyphSegmentSnapshot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  plotX1: number;
  plotY1: number;
  plotX2: number;
  plotY2: number;
  role: ResolvedChartStockGlyphSegmentRole;
}

export interface ResolvedChartStockGlyphVolumeRectSnapshot extends ResolvedChartStockVolumeSurfaceSnapshot {
  value: number;
  role: 'volumeBar';
}

export interface ResolvedChartStockGlyphBodyRectSnapshot extends ResolvedChartStockVolumeSurfaceSnapshot {
  openValue: number;
  closeValue: number;
  role: 'body';
  direction: ResolvedChartStockGlyphDirection;
}

export interface ResolvedChartStockGlyphStrokeVisualSnapshot {
  stroke: string;
  strokeOpacity?: number;
  strokeWidth: number;
  strokeDash?: number[];
  source: ResolvedChartStockGlyphVisualSource;
}

export interface ResolvedChartStockGlyphBodyVisualSnapshot {
  fill: string;
  fillOpacity?: number;
  border: string;
  borderOpacity?: number;
  borderWidth: number;
  source: ResolvedChartStockGlyphVisualSource;
}

export interface ResolvedChartStockGlyphVolumeVisualSnapshot extends ResolvedChartStockGlyphBodyVisualSnapshot {
  visualStatus?: ResolvedChartStockVisualContractStatus;
  visualStatusReason?: string;
  gapWidth: number;
  slotOccupancy: number;
  surfacePolicy: {
    type: 'plotFraction';
    fraction: number;
  };
}

export interface ResolvedChartStockSourceRoleMarkerVisualSnapshot {
  fill: string;
  stroke: string;
  strokeWidth: number;
  shape: string;
  size: number;
  source: ResolvedChartStockGlyphVisualSource;
}

export interface ResolvedChartStockSourceRoleVisualSnapshot {
  role: ChartSeriesStockRole;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  layerMode: ResolvedChartStockSourceRoleLayerMode;
  lineVisible: boolean;
  lineVisualStatus?: ResolvedChartStockVisualContractStatus;
  lineVisualStatusReason?: string;
  markerVisible: boolean;
  markerVisualStatus?: ResolvedChartStockVisualContractStatus;
  markerVisualStatusReason?: string;
  colorAuthorityStatus?: ResolvedChartStockVisualContractStatus;
  colorAuthoritySource?: string;
  colorAuthorityReason?: string;
  line: ResolvedChartStockGlyphStrokeVisualSnapshot;
  marker: ResolvedChartStockSourceRoleMarkerVisualSnapshot;
}

export interface ResolvedChartStockHighLowEndpointPolicySnapshot {
  type: 'sourceRoleExtents';
  roles: ChartSeriesStockRole[];
}

export interface ResolvedChartStockGlyphVisualSnapshot {
  visualStatus: ResolvedChartStockGlyphVisualStatus;
  visualStatusReason?: string;
  priceGlyphMode: ResolvedChartStockGlyphPriceGlyphMode;
  volumeAxisPolicy?: StockVolumeAxisPolicy;
  highLowEndpointPolicy?: ResolvedChartStockHighLowEndpointPolicySnapshot;
  gapWidth: number;
  slotOccupancy: number;
  drawOrder: ResolvedChartStockGlyphVisualRole[];
  highLowLine: ResolvedChartStockGlyphStrokeVisualSnapshot;
  openTick: ResolvedChartStockGlyphStrokeVisualSnapshot;
  closeTick: ResolvedChartStockGlyphStrokeVisualSnapshot;
  upBody: ResolvedChartStockGlyphBodyVisualSnapshot;
  downBody: ResolvedChartStockGlyphBodyVisualSnapshot;
  flatBody: ResolvedChartStockGlyphBodyVisualSnapshot;
  volume?: ResolvedChartStockGlyphVolumeVisualSnapshot;
  sourceRoleVisuals?: ResolvedChartStockSourceRoleVisualSnapshot[];
  importedHighLowLines?: boolean;
  importedUpDownBars?: boolean;
  styleSources: ResolvedChartStockGlyphVisualSource[];
}

export interface ResolvedChartStockGlyphPointSnapshot {
  pointIndex: number;
  category: string | number | null;
  xPixel: number;
  plotX: number;
  highPixel: number;
  lowPixel: number;
  openPixel?: number;
  closePixel?: number;
  direction: ResolvedChartStockGlyphDirection;
  stem: ResolvedChartStockGlyphSegmentSnapshot;
  openTick?: ResolvedChartStockGlyphSegmentSnapshot;
  closeTick?: ResolvedChartStockGlyphSegmentSnapshot;
  bodyRect?: ResolvedChartStockGlyphBodyRectSnapshot;
  volumeRect?: ResolvedChartStockGlyphVolumeRectSnapshot;
}

export interface ResolvedChartStockGlyphLayerSnapshot {
  layerIndex: number;
  markType: 'stockGlyph';
  subType: StockSubType;
  xMode: ResolvedChartStockGlyphXMode;
  xField?: string;
  openField?: string;
  highField: string;
  lowField: string;
  closeField: string;
  volumeField?: string;
  renderedPointCount: number;
  categoryPitch: number;
  glyphWidth: number;
  gapWidth?: number;
  slotOccupancy?: number;
  tickLength: number;
  volumeBarWidth?: number;
  priceScale?: ResolvedChartStockGlyphScaleSnapshot;
  volumeScale?: ResolvedChartStockGlyphScaleSnapshot;
  volumeAxisPolicy?: StockVolumeAxisPolicy;
  highLowEndpointPolicy?: ResolvedChartStockHighLowEndpointPolicySnapshot;
  volumeSurface?: ResolvedChartStockVolumeSurfaceSnapshot;
  visual?: ResolvedChartStockGlyphVisualSnapshot;
  points: ResolvedChartStockGlyphPointSnapshot[];
}

export interface ResolvedChartStockGlyphGeometrySnapshot {
  geometryStatus: ResolvedChartStockGlyphGeometryStatus;
  geometryStatusReason?: string;
  coordinateSystem?: 'chartPixel';
  chartWidth?: number;
  chartHeight?: number;
  plotArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  subType?: StockSubType;
  xMode?: ResolvedChartStockGlyphXMode;
  renderedPointCount?: number;
  categoryPitch?: number;
  glyphWidth?: number;
  gapWidth?: number;
  slotOccupancy?: number;
  tickLength?: number;
  volumeBarWidth?: number;
  priceScale?: ResolvedChartStockGlyphScaleSnapshot;
  volumeScale?: ResolvedChartStockGlyphScaleSnapshot;
  volumeAxisPolicy?: StockVolumeAxisPolicy;
  highLowEndpointPolicy?: ResolvedChartStockHighLowEndpointPolicySnapshot;
  volumeSurface?: ResolvedChartStockVolumeSurfaceSnapshot;
  visual?: ResolvedChartStockGlyphVisualSnapshot;
  layers?: ResolvedChartStockGlyphLayerSnapshot[];
  points?: ResolvedChartStockGlyphPointSnapshot[];
}

export type ResolvedChartApproximationGeometryStatus =
  | 'approximate'
  | 'traceMissing'
  | 'notApplicable';

export type ResolvedChartThreeDApproximationRenderer = 'pathDepthApproximation';
export type ResolvedChartThreeDApproximationDepthSource =
  | 'view3dDepthPercent'
  | 'gapDepth'
  | 'default';
export type ResolvedChartThreeDApproximationDepthClampStatus =
  | 'withinRange'
  | 'clampedMin'
  | 'clampedMax';
export type ResolvedChartThreeDApproximationFaceRole =
  | 'front'
  | 'back'
  | 'top'
  | 'side'
  | 'connector'
  | 'outer'
  | 'inner';
export type ResolvedChartThreeDBarShape =
  | 'box'
  | 'cylinder'
  | 'cone'
  | 'coneToMax'
  | 'pyramid'
  | 'pyramidToMax';

export interface ResolvedChartThreeDFaceCountsSnapshot {
  front: number;
  back: number;
  top: number;
  side: number;
  connector: number;
  outer: number;
  inner: number;
}

export interface ResolvedChartThreeDBarShapesSnapshot {
  chartShape?: ResolvedChartThreeDBarShape;
  seriesShapes?: Array<{
    seriesIndex?: number;
    sourceSeriesIndex?: number;
    sourceSeriesKey?: string;
    shape: ResolvedChartThreeDBarShape;
  }>;
  distinctShapes: ResolvedChartThreeDBarShape[];
}

export type ResolvedChartProjectionTraceCoordinateSpace = 'chartNormalized' | 'plotAreaNormalized';
export type ResolvedChartProjectionOccupancySource = 'generatedMarkBounds' | 'generatedPathBounds';

export interface ResolvedChartProjectionBoundsSnapshot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  areaFraction: number;
  coordinateSpace: ResolvedChartProjectionTraceCoordinateSpace;
}

export interface ResolvedChartProjectionOccupancySnapshot {
  columns: number;
  rows: number;
  densities: number[];
  source: ResolvedChartProjectionOccupancySource;
}

export interface ResolvedChartThreeDApproximationProjectionSnapshot {
  projectionAuthority: 'generatedApproximationTrace';
  allFaceBounds?: ResolvedChartProjectionBoundsSnapshot;
  frontFaceBounds?: ResolvedChartProjectionBoundsSnapshot;
  depthFaceBounds?: ResolvedChartProjectionBoundsSnapshot;
  faceFamilyOccupancy?: ResolvedChartProjectionOccupancySnapshot;
}

export interface ResolvedChartThreeDWallSurfaceStatusSnapshot {
  floor: 'absent' | 'preservedMetadataApproximateRenderer';
  sideWall: 'absent' | 'preservedMetadataApproximateRenderer';
  backWall: 'absent' | 'preservedMetadataApproximateRenderer';
  fidelity: 'metadataPreservedNotExcelEquivalent';
}

export interface ResolvedChartThreeDApproximationSnapshot {
  schemaVersion: 1;
  renderer: ResolvedChartThreeDApproximationRenderer;
  chartType: string;
  markFamily?: string;
  sourceFamily?: string;
  renderedMarkType?: string;
  view3d?: ChartView3DConfig;
  gapDepth?: number;
  depthSource?: ResolvedChartThreeDApproximationDepthSource;
  depthVector?: {
    x: number;
    y: number;
  };
  depthClampStatus?: ResolvedChartThreeDApproximationDepthClampStatus;
  barShapes?: ResolvedChartThreeDBarShapesSnapshot;
  sourceSeriesCount: number;
  sourcePointCount: number;
  renderablePointCount: number;
  markCount: number;
  faceCounts: ResolvedChartThreeDFaceCountsSnapshot;
  projection?: ResolvedChartThreeDApproximationProjectionSnapshot;
  wallSurfaceStatus: ResolvedChartThreeDWallSurfaceStatusSnapshot;
  geometryStatus: ResolvedChartApproximationGeometryStatus;
}

export type ResolvedChartSurfaceApproximationRenderer =
  | 'mogSurfaceApproximation'
  | 'mogContourApproximation';
export type ResolvedChartSurfaceApproximationMode = 'surface3d' | 'contour';
export type ResolvedChartSurfaceApproximationContractKind =
  | 'surface3dFilled'
  | 'surface3dWireframe'
  | 'contourFilled'
  | 'contourWireframe';
export type ResolvedChartSurfaceGridSource = 'seriesPointIndexGrid' | 'unavailable';
export type ResolvedChartSurfaceBandAuthority =
  | 'generatedFromAxisAndData'
  | 'fallback'
  | 'sourceBandFmtPreservedOnly';
export type ResolvedChartSurfacePlotAreaPolicy = 'squareTopView' | 'normalizedProjectedCube';

export interface ResolvedChartSurfaceGridSnapshot {
  rows: number;
  columns: number;
  finiteValueCount: number;
  missingCellCount: number;
  source: ResolvedChartSurfaceGridSource;
}

export interface ResolvedChartSurfaceValueDomainSnapshot {
  dataMin?: number;
  dataMax?: number;
  axisMin?: number;
  axisMax?: number;
  axisMajorUnit?: number;
}

export interface ResolvedChartSurfaceBandSnapshot {
  index: number;
  min: number;
  max: number;
  label: string;
  color: string;
}

export interface ResolvedChartSurfaceSourceBandFormatSnapshot {
  index: number;
  fillColor?: string;
  hasFormatting: boolean;
  source?: 'ooxmlBandFmt';
}

export interface ResolvedChartSurfaceBandsSnapshot {
  count: number;
  entries: ResolvedChartSurfaceBandSnapshot[];
  legendOrder: string[];
  authority: ResolvedChartSurfaceBandAuthority;
  sourceBandFormats?: ResolvedChartSurfaceSourceBandFormatSnapshot[];
}

export interface ResolvedChartSurfaceMarkCountsSnapshot {
  filledPatches: number;
  isolineSegments: number;
  wireSegments: number;
  frameMarks: number;
  totalDataMarks: number;
}

export interface ResolvedChartSurfaceDensitySnapshot {
  completeCellCount: number;
  finiteCellRatio: number;
  missingCellRatio: number;
  filledPatchesPerCompleteCell: number;
  isolineSegmentsPerCompleteCell: number;
  wireSegmentsPerValidEdge?: number;
  expectedWireSegments?: number;
  validGridEdgeCount?: number;
  thresholdCount?: number;
}

export interface ResolvedChartSurfaceProjectionSnapshot {
  projectionAuthority: 'generatedApproximationTrace';
  dataMarkBounds?: ResolvedChartProjectionBoundsSnapshot;
  frameBounds?: ResolvedChartProjectionBoundsSnapshot;
  topViewPlotBounds?: ResolvedChartProjectionBoundsSnapshot;
  dataOccupancy?: ResolvedChartProjectionOccupancySnapshot;
}

export interface ResolvedChartSurfaceApproximationSnapshot {
  schemaVersion: 1;
  renderer: ResolvedChartSurfaceApproximationRenderer;
  mode: ResolvedChartSurfaceApproximationMode;
  contractKind: ResolvedChartSurfaceApproximationContractKind;
  topView: boolean;
  wireframe: boolean;
  chartType: string;
  view3d?: ChartView3DConfig;
  grid: ResolvedChartSurfaceGridSnapshot;
  valueDomain: ResolvedChartSurfaceValueDomainSnapshot;
  bands: ResolvedChartSurfaceBandsSnapshot;
  markCounts: ResolvedChartSurfaceMarkCountsSnapshot;
  plotAreaPolicy: ResolvedChartSurfacePlotAreaPolicy;
  density?: ResolvedChartSurfaceDensitySnapshot;
  projection?: ResolvedChartSurfaceProjectionSnapshot;
  geometryStatus: ResolvedChartApproximationGeometryStatus;
}

export interface ResolvedChartStockRenderProjectionSnapshot {
  projectionType: 'stockGlyph';
  renderedSeriesIndex: number;
  renderedSourceSeriesKey: string;
  roles: ResolvedChartProjectedRoleMappingSnapshot[];
  subType?: StockSubType;
  xMode?: ResolvedChartStockGlyphXMode;
  geometryStatus?: ResolvedChartStockGlyphGeometryStatus;
  geometryStatusReason?: string;
  visualStatus?: ResolvedChartStockGlyphVisualStatus;
  visualStatusReason?: string;
  priceGlyphMode?: ResolvedChartStockGlyphPriceGlyphMode;
  stockSourceComposition?: StockSourceComposition;
  sourceRoleSemanticStatus?: ResolvedChartStockVisualContractStatus;
  sourceRoleSemanticSource?: string;
  sourceRoleSemanticReason?: string;
  volumeAxisPolicy?: StockVolumeAxisPolicy;
  highLowEndpointPolicy?: ResolvedChartStockHighLowEndpointPolicySnapshot;
  sourceRoleVisuals?: ResolvedChartStockSourceRoleVisualSnapshot[];
  sourceRoleLineLayerCount?: number;
  sourceRoleMarkerLayerCount?: number;
  priceScale?: ResolvedChartStockGlyphScaleSnapshot;
  gapWidth?: number;
  slotOccupancy?: number;
  glyphWidth?: number;
  tickLength?: number;
  volumeBarWidth?: number;
  volumeScale?: ResolvedChartStockGlyphScaleSnapshot;
  visual?: ResolvedChartStockGlyphVisualSnapshot;
  volumeSurface?: ResolvedChartStockVolumeSurfaceSnapshot;
  geometryPointCount?: number;
  /** Rendered-glyph-length role values filtered by renderedPointIndexes. */
  renderedRoleValues?: ResolvedChartStockRoleValuesSnapshot;
  /** Rendered-glyph-length categories filtered by renderedPointIndexes. */
  renderedCategories?: Array<string | number | null>;
  sourcePointCount?: number;
  renderedPointCount?: number;
  renderedPointIndexes?: number[];
  droppedPointIndexes?: number[];
  trailingBlankPointCount?: number;
  categorySourceSeriesKey?: string;
}

export interface ResolvedChartRadarPolarPointSnapshot {
  pointIndex: number;
  category: string | number | null;
  value: number;
  angle: number;
  radius: number;
  radiusRatio: number;
  x: number;
  y: number;
  markerVisible?: boolean;
  markerShape?: string;
  markerSize?: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
}

export interface ResolvedChartRadarPolarSeriesSnapshot {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  name: string;
  pointCount: number;
  renderedPointCount: number;
  blankPointIndexes: number[];
  closed: boolean;
  filled: boolean;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  strokeOpacity?: number;
  markers: boolean;
  markerVisible?: boolean;
  markerShape?: string;
  markerSize?: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
  points: ResolvedChartRadarPolarPointSnapshot[];
}

export type ResolvedChartRadarValueDomainAuthority = 'explicitAxis' | 'excelAuto' | 'fallback';
export type ResolvedChartRadarBlankPolicy = 'gap' | 'span' | 'zero';
export type ResolvedChartRadarBlankPolicyAuthority =
  | 'explicit'
  | 'excelDefault'
  | 'chartCacheLiveSourceBlank';

export interface ResolvedChartRenderedBlankProjectionEvidenceSnapshot {
  authority: Extract<ResolvedChartRadarBlankPolicyAuthority, 'chartCacheLiveSourceBlank'>;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  pointIndex: number;
  sourceValue: null;
  cacheValue: number;
  cacheRawValue: string;
}
export type ResolvedChartRadarStyleContractCategory =
  | 'marker'
  | 'fill'
  | 'stroke'
  | 'grid'
  | 'spokes'
  | 'categoryLabels'
  | 'valueLabels';
export type ResolvedChartRadarStyleContractFidelity =
  | 'exact'
  | 'deterministicApproximation'
  | 'unknown';
export type ResolvedChartRadarStyleSourceAuthority =
  | 'imported'
  | 'excelDefault'
  | 'mogDeclaredDefault'
  | 'notApplicable';
export type ResolvedChartRadarStyleContractValue = string | number | boolean | null;

export interface ResolvedChartRadarStyleContractEntrySnapshot {
  category: ResolvedChartRadarStyleContractCategory;
  fidelity: ResolvedChartRadarStyleContractFidelity;
  sourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  requiresHumanReview: boolean;
  rendered: Record<string, ResolvedChartRadarStyleContractValue>;
  reason?: string;
}

export interface ResolvedChartRadarStyleDiagnosticsSnapshot {
  autoValueScaleFidelity?: 'exact' | 'approximate' | 'unknown';
  fillStyleFidelity?: 'exact' | 'approximate' | 'unknown';
  markerStyleFidelity?: 'exact' | 'approximate' | 'unknown';
  strokeStyleFidelity?: 'exact' | 'approximate' | 'unknown';
  gridLabelStyleFidelity?: 'exact' | 'approximate' | 'unknown';
  reasons?: string[];
  contracts?: ResolvedChartRadarStyleContractEntrySnapshot[];
}

export interface ResolvedChartRadarProjectionSnapshot {
  projectionType: 'radarPolar';
  categoryOrder: Array<string | number | null>;
  categoryCount: number;
  startAngle: number;
  clockwise: boolean;
  valueDomain: [number, number];
  valueTicks?: number[];
  valueTickStep?: number;
  valueDomainAuthority?: ResolvedChartRadarValueDomainAuthority;
  explicitValueDomain?: boolean;
  explicitValueTickStep?: boolean;
  center: {
    x: number;
    y: number;
  };
  radius: {
    pixels: number;
    chartX: number;
    chartY: number;
  };
  displayBlanksAs?: ResolvedChartRadarBlankPolicy;
  blankPolicy: ResolvedChartRadarBlankPolicy;
  blankPolicyAuthority?: ResolvedChartRadarBlankPolicyAuthority;
  renderedBlankProjectionEvidence?: ResolvedChartRenderedBlankProjectionEvidenceSnapshot[];
  filled: boolean;
  fillOpacity?: number;
  markers: boolean;
  markerSize?: number;
  strokeWidth?: number;
  styleDiagnostics?: ResolvedChartRadarStyleDiagnosticsSnapshot;
  series: ResolvedChartRadarPolarSeriesSnapshot[];
}

export interface ResolvedChartSeriesProjectionSnapshot {
  authority: ChartSeriesProjectionAuthority;
  expectedImportedSeriesCount: number;
  projectedSeriesCount: number;
  renderedSeriesCount: number;
  renderedPointCountBySourceSeriesKey: Record<string, number>;
  droppedSeries: ResolvedChartDroppedSeriesSnapshot[];
  sourceSeries?: ResolvedChartSourceSeriesSnapshot[];
  sourceSeriesCount?: number;
  sourceRoleSeriesCount?: number;
  projectedRoleMappings?: ResolvedChartProjectedRoleMappingSnapshot[];
  stockRenderProjection?: ResolvedChartStockRenderProjectionSnapshot;
}

/** Normalized top-level chart layout rectangle in chart-relative coordinates. */
export interface ResolvedChartLayoutRectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Final top-level chart layout regions after chart grammar compilation. */
export interface ResolvedChartLayoutSnapshot {
  plotArea: ResolvedChartLayoutRectSnapshot;
  legend?: ResolvedChartLayoutRectSnapshot;
  title?: ResolvedChartLayoutRectSnapshot;
  dataTable?: ResolvedChartLayoutRectSnapshot;
  dataLabels?: ResolvedChartLayoutRectSnapshot;
}

/** Runtime sheet kind carried by chart diagnostics. */
export type ChartSheetKindSnapshot =
  | 'worksheet'
  | 'chartSheet'
  | 'dialogSheet'
  | 'macroSheet'
  | 'unsupported';

/** Source of authority for chart layout and render dimensions. */
export type ChartLayoutAuthority = 'embedded' | 'chartSheet';

/** Page context that can influence chart-sheet print/export output. */
export interface ChartPageContextSnapshot {
  pageSetup?: unknown;
  pageMargins?: unknown;
  headerFooter?: unknown;
}

/** Render frame used for size-aware chart compilation. */
export interface ChartRenderFrameSnapshot {
  kind: ChartLayoutAuthority;
  sheetId: string;
  chartId: string;
  width: number;
  height: number;
  windowViewId?: number;
  zoomToFit?: boolean;
  pageContext?: ChartPageContextSnapshot;
}

/** Absolute chart or plot area size in CSS pixels. */
export interface ChartAreaSizeSnapshot {
  width: number;
  height: number;
}

export type ResolvedChartPieDoughnutGeometryStatus = 'available' | 'unavailable';

export type ResolvedChartPieDoughnutVisualStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'unknown';

export type ResolvedChartPieDoughnutLayoutAuthority =
  | 'excelLikeAuto'
  | 'manualLayout'
  | 'genericFallback';

export type ResolvedChartPieDoughnutGeometryFamily =
  | 'pie'
  | 'doughnut'
  | 'ofPie'
  | 'pie3dApproximation';

export interface ResolvedChartPieDoughnutLayoutReservationSnapshot {
  top: number;
  right: number;
  bottom: number;
  left: number;
  radial: number;
}

export interface ResolvedChartPieDoughnutBoxSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResolvedChartPieDoughnutLegendOverflowPolicy = 'none' | 'overflowVisible';

export interface ResolvedChartPieDoughnutLegendEntryFlowSnapshot {
  index: number;
  text: string;
  pointIndex?: number;
  pointKey?: string;
  legendKey?: string;
  colorKey?: string;
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  rowIndex: number;
  columnIndex: number;
  bounds: ResolvedChartPieDoughnutBoxSnapshot;
  symbolBounds: ResolvedChartPieDoughnutBoxSnapshot;
  labelBounds: ResolvedChartPieDoughnutBoxSnapshot;
  drawn: boolean;
  clipped: boolean;
}

export interface ResolvedChartPieDoughnutLegendFlowSnapshot {
  position?: string;
  status: ResolvedChartPieDoughnutVisualStatus;
  statusReason?: string;
  area?: ResolvedChartPieDoughnutBoxSnapshot;
  orient?: ResolvedChartRenderedLegendFlowOrient;
  entryCount: number;
  renderedEntryCount: number;
  visibleEntryCount: number;
  clippedEntryCount: number;
  rowCount: number;
  columnCount: number;
  rowGap: number;
  entryGap: number;
  contentWidth: number;
  contentHeight: number;
  overflowPolicy: ResolvedChartPieDoughnutLegendOverflowPolicy;
  entries: ResolvedChartPieDoughnutLegendEntryFlowSnapshot[];
}

export type ResolvedChartPieDoughnutLeaderLinePolicy = 'none' | 'outsideLabels' | 'estimated';

export type ResolvedChartPieDoughnutCollisionPolicy =
  | 'notApplicable'
  | 'noneObserved'
  | 'observed'
  | 'estimated';

export type ResolvedChartPieDoughnutLabelOverflowPolicy =
  | 'notApplicable'
  | 'noneObserved'
  | 'observed'
  | 'estimated';

export type ResolvedChartPieDoughnutLabelMeasurementAuthority =
  | 'canvasMeasureText'
  | 'nativeRasterTextMeasure'
  | 'estimated';

export interface ResolvedChartPieDoughnutLabelLayoutEntrySnapshot {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex: number;
  pointKey?: string;
  text: string;
  position?: string;
  labelX?: number;
  labelY?: number;
  anchor?: { x: number; y: number };
  bounds?: ResolvedChartPieDoughnutBoxSnapshot;
  maxWidth?: number;
  font?: {
    family: string;
    size: number;
    weight?: string | number;
    style?: string;
  };
  lineHeight?: number;
  leaderVisible?: boolean;
  zeroValue?: boolean;
  nearZeroValue?: boolean;
  layoutTarget?: 'inner' | 'outer';
  coordinateSystem?: 'chartPixel';
  measurementAuthority?: ResolvedChartPieDoughnutLabelMeasurementAuthority;
}

export interface ResolvedChartPieDoughnutLabelLayoutSnapshot {
  status: ResolvedChartPieDoughnutVisualStatus;
  statusReason?: string;
  labelCount: number;
  renderedLabelCount: number;
  defaultLabelCount: number;
  zeroValueLabelCount: number;
  nearZeroValueLabelCount: number;
  outsideLabelCount: number;
  maxLabelTextLength: number;
  leaderLinePolicy: ResolvedChartPieDoughnutLeaderLinePolicy;
  collisionPolicy: ResolvedChartPieDoughnutCollisionPolicy;
  overflowPolicy: ResolvedChartPieDoughnutLabelOverflowPolicy;
  labels: ResolvedChartPieDoughnutLabelLayoutEntrySnapshot[];
}

export interface ResolvedChartPieDoughnutExplosionSliceEnvelopeSnapshot {
  seriesIndex: number;
  pointIndex: number;
  pointKey: string;
  explosionPercent: number;
  explosionOffset: number;
  arcBox: ResolvedChartPieDoughnutBoxSnapshot;
}

export interface ResolvedChartPieDoughnutExplosionEnvelopeSnapshot {
  status: ResolvedChartPieDoughnutVisualStatus;
  statusReason?: string;
  maxExplosionPercent: number;
  maxExplosionOffset: number;
  effectBleed: number;
  reservation: ResolvedChartPieDoughnutLayoutReservationSnapshot;
  unionBounds?: ResolvedChartPieDoughnutBoxSnapshot;
  slices: ResolvedChartPieDoughnutExplosionSliceEnvelopeSnapshot[];
}

export interface ResolvedChartPieDoughnutStyleFootprintSnapshot {
  status: ResolvedChartPieDoughnutVisualStatus;
  statusReason?: string;
  sliceStyleStatus: ResolvedChartPieDoughnutVisualStatus;
  sliceStyleStatusReason?: string;
  chartStyleId?: number;
  hasChartStyleContext: boolean;
  styleOwnerCount: number;
  styleContextStatus?: string;
  styleContextReason?: string;
  styleContextEffectFlags?: string[];
  unmodeledOwnerKeys?: string[];
  styleContextReservationMode?: string;
  modeledReservation?: {
    source: 'styleContext';
    effectBleed: number;
    mode?: string;
  };
  explicitSeriesFormatCount: number;
  explicitPointFormatCount: number;
  frameEffectFlags: string[];
  sliceEffectFlags: string[];
  effectBleed: number;
}

export interface ResolvedChartPieDoughnutSliceSnapshot {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  pointIndex: number;
  pointKey: string;
  legendKey: string;
  colorKey: string;
  displayLabel: string;
  category: string | number | null;
  value: number;
  sanitizedValue: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  angle: number;
  centerX: number;
  centerY: number;
  explodedCenterX: number;
  explodedCenterY: number;
  innerRadius: number;
  outerRadius: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  explosionPercent: number;
  explosionOffset: number;
  x: number;
  y: number;
  arcBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fill?: string;
  visible: boolean;
}

export interface ResolvedChartPieDoughnutRingSnapshot {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  ringIndex: number;
  innerRadius: number;
  outerRadius: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  slices: ResolvedChartPieDoughnutSliceSnapshot[];
}

export interface ResolvedChartPieDoughnutGeometrySnapshot {
  geometryStatus: ResolvedChartPieDoughnutGeometryStatus;
  geometryStatusReason?: string;
  coordinateSystem: 'chartPixel';
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  availableContentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  legendReservation: ResolvedChartPieDoughnutLayoutReservationSnapshot;
  labelReservation: ResolvedChartPieDoughnutLayoutReservationSnapshot;
  explosionReservation: ResolvedChartPieDoughnutLayoutReservationSnapshot;
  styleReservation: ResolvedChartPieDoughnutLayoutReservationSnapshot;
  arcBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  family: ResolvedChartPieDoughnutGeometryFamily;
  startAngle: number;
  clockwise: true;
  holeSize?: number;
  innerRadiusRatio: number;
  ringCount: number;
  centerX: number;
  centerY: number;
  rawRadius: number;
  radius: number;
  padding: number;
  layoutAuthority: ResolvedChartPieDoughnutLayoutAuthority;
  manualArcInsetProfile?: string;
  manualArcInsetStatus?: ResolvedChartPieDoughnutVisualStatus;
  manualArcInsetStatusReason?: string;
  arcFrameStatus: ResolvedChartPieDoughnutVisualStatus;
  arcFrameStatusReason?: string;
  radiusStatus: ResolvedChartPieDoughnutVisualStatus;
  radiusStatusReason?: string;
  legendLayoutStatus: ResolvedChartPieDoughnutVisualStatus;
  legendLayoutStatusReason?: string;
  labelLayoutStatus: ResolvedChartPieDoughnutVisualStatus;
  labelLayoutStatusReason?: string;
  explosionLayoutStatus: ResolvedChartPieDoughnutVisualStatus;
  explosionLayoutStatusReason?: string;
  styleFootprintStatus: ResolvedChartPieDoughnutVisualStatus;
  styleFootprintStatusReason?: string;
  sliceStyleStatus: ResolvedChartPieDoughnutVisualStatus;
  sliceStyleStatusReason?: string;
  ringBandStatus: ResolvedChartPieDoughnutVisualStatus;
  ringBandStatusReason?: string;
  holeSizeStatus: ResolvedChartPieDoughnutVisualStatus;
  holeSizeStatusReason?: string;
  ringOrderStatus: ResolvedChartPieDoughnutVisualStatus;
  ringOrderStatusReason?: string;
  legendFlow?: ResolvedChartPieDoughnutLegendFlowSnapshot;
  labelLayout?: ResolvedChartPieDoughnutLabelLayoutSnapshot;
  explosionEnvelope?: ResolvedChartPieDoughnutExplosionEnvelopeSnapshot;
  styleFootprint?: ResolvedChartPieDoughnutStyleFootprintSnapshot;
  rings: ResolvedChartPieDoughnutRingSnapshot[];
}

export interface ResolvedChartBarGeometryOffsetSnapshot {
  seriesIndex: number;
  offset: number;
}

export type ResolvedChartBarGeometryStatus = 'exact' | 'verifiedDefault' | 'approximate';
export type ResolvedChartBarPostRenderTraceStatus = 'available' | 'mismatch' | 'unavailable';
export type ResolvedChartBarPlotAreaAuthority =
  | 'manualLayout'
  | 'excelAutoModel'
  | 'barPostRenderTrace'
  | 'rendererAuto'
  | 'missing';
export type ResolvedChartBarCategoryPitchAuthority = ResolvedChartBarPlotAreaAuthority;
export type ResolvedChartBarValueAxisScaleSource =
  | 'explicit'
  | 'percentStackedDefault'
  | 'excelAutoModel'
  | 'heuristic'
  | 'missing';

export interface ResolvedChartBarTraceRectSnapshot {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  category?: string | number | null;
  value?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  clipRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clippingPolicy: 'preClipRectWithPlotAreaClip';
  baselinePixel?: number;
  categorySlotIndex?: number;
  slotOffset?: number;
  stackSign?: 'positive' | 'negative';
  stackCumulativeStart?: number;
  stackCumulativeEnd?: number;
}

export interface ResolvedChartBarTracePlotAreaSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResolvedChartBarRectangleReconciliationStatus = 'exact' | 'approximate' | 'missing';

export type ResolvedChartBarRectangleReconciliationAuthority =
  | 'excelOracleGeometry'
  | 'notApplicable';

export interface ResolvedChartBarRectangleDeltaSnapshot {
  sourceSeriesIndex?: number;
  seriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  categorySlotIndex?: number;
  stackSign?: 'positive' | 'negative';
  xDelta?: number;
  yDelta?: number;
  widthDelta?: number;
  heightDelta?: number;
  stackCumulativeStartDelta?: number;
  stackCumulativeEndDelta?: number;
  maxDelta: number;
}

export interface ResolvedChartBarGeometryDeltaSnapshot {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maxDelta: number;
}

export interface ResolvedChartBarRectangleReconciliationSnapshot {
  schemaVersion: 1;
  status: ResolvedChartBarRectangleReconciliationStatus;
  statusReason?: string;
  authority: ResolvedChartBarRectangleReconciliationAuthority;
  tolerancePx: number;
  excelPlotArea?: ResolvedChartBarTracePlotAreaSnapshot;
  mogPlotArea?: ResolvedChartBarTracePlotAreaSnapshot;
  plotAreaDelta?: ResolvedChartBarGeometryDeltaSnapshot;
  categoryPitchDelta?: number;
  barSizeDelta?: number;
  baselineDelta?: number;
  rectangleCount: number;
  matchedRectangleCount: number;
  maxRectangleDelta?: number;
  rectangleDeltas?: ResolvedChartBarRectangleDeltaSnapshot[];
}

export interface ResolvedChartBarGeometrySnapshot {
  groupKey?: string;
  orientation?: 'horizontal' | 'vertical';
  grouping: 'standard' | 'clustered' | 'stacked' | 'percentStacked';
  sourceGapWidth?: number;
  sourceOverlap?: number;
  gapWidth: number;
  overlap: number;
  gapWidthClamped?: boolean;
  overlapClamped?: boolean;
  seriesIndices: number[];
  yAxisIndex?: 0 | 1;
  axisGroup?: 'primary' | 'secondary';
  memberCount?: number;
  layerRole?: 'bar';
  seriesSlotOrder?: 'source' | 'reverse';
  categoryAxisRole?: 'x' | 'y';
  valueAxisRole?: 'x' | 'y';
  categoryPositionPolicy?: 'between' | 'onCategory' | 'centeredSingleton';
  categoryTickLabelSkip?: number;
  categoryTickMarkSkip?: number;
  categoryTickSkipSource?: 'explicit' | 'importedAuto' | 'rendererAuto' | 'none';
  categoryCrossing?: 'between' | 'midCat';
  valueCrossing?: 'automatic' | 'min' | 'max' | 'custom';
  valueCrossingValue?: number;
  baselineValue?: number;
  baselinePixel?: number;
  valueAxisDomain?: [number, number];
  valueAxisTickStep?: number;
  valueAxisTickCount?: number;
  percentDomain?: [number, number];
  percentAxisLabelPolicy?: 'percentFromHundred';
  categoryTickStatus?: ResolvedChartBarGeometryStatus;
  categoryTickStatusReason?: string;
  valueAxisScaleSource?: ResolvedChartBarValueAxisScaleSource;
  valueAxisScaleStatus?: ResolvedChartBarGeometryStatus;
  valueAxisScaleStatusReason?: string;
  axisLayoutStatus?: ResolvedChartBarGeometryStatus;
  axisLayoutStatusReason?: string;
  geometryStatus?: ResolvedChartBarGeometryStatus;
  geometryStatusReason?: string;
  plotAreaSource?: 'auto' | 'manual';
  plotAreaAuthority?: ResolvedChartBarPlotAreaAuthority;
  categoryPitchAuthority?: ResolvedChartBarCategoryPitchAuthority;
  categoryPitchStatus?: ResolvedChartBarGeometryStatus;
  categoryPitchStatusReason?: string;
  categoryAxisLength?: number;
  visibleCategoryCount?: number;
  categoryPitch?: number;
  barSize?: number;
  offsets?: ResolvedChartBarGeometryOffsetSnapshot[];
  traceStatus?: ResolvedChartBarPostRenderTraceStatus;
  traceStatusReason?: string;
  tracePlotArea?: ResolvedChartBarTracePlotAreaSnapshot;
  traceCategoryPitch?: number;
  traceBarSize?: number;
  traceOffsets?: ResolvedChartBarGeometryOffsetSnapshot[];
  traceRectangleCount?: number;
  rectangles?: ResolvedChartBarTraceRectSnapshot[];
  rectangleReconciliation?: ResolvedChartBarRectangleReconciliationSnapshot;
}

export interface ResolvedChartCartesianValueAxisGeometrySnapshot {
  axisGroup: 'primary' | 'secondary';
  axisRole?: 'primaryYValue' | 'secondaryYValue';
  domain?: [number, number];
  includeZero: boolean;
  explicitDomain: boolean;
  scaleAuthority?: ResolvedChartCartesianScaleAuthority;
  tickStep?: number;
  percentAxisLabelPolicy?: ResolvedChartCartesianPercentAxisLabelPolicy;
  axisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
  axisLayoutStatusReason?: string;
  valueAxisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  source?: ResolvedChartCartesianAxisSourceSnapshot;
  renderedAxisOrient?: ResolvedChartCartesianRenderedAxisOrient;
  axisVisualStatus?: ResolvedChartXYVisualContractStatus;
  axisVisualStatusReason?: string;
  crossingStatus?: ResolvedChartXYVisualContractStatus;
  crossingStatusReason?: string;
  crossing?: ResolvedChartCartesianAxisCrossingSnapshot;
  reservationStatus?: ResolvedChartXYVisualContractStatus;
  reservationStatusReason?: string;
  tickValues?: Array<string | number | null>;
  range?: [number, number];
  plotRange?: [number, number];
  scaleConsistencyStatus?: 'consistent' | 'planTraceMismatch';
  scaleConsistencyReason?: string;
  plannedDomain?: [number, number];
  renderedDomain?: [number, number];
  plannedTickStep?: number;
  renderedTickStep?: number;
}

export type ResolvedChartCartesianGeometryStatus = 'available' | 'unavailable';

export type ResolvedChartCartesianAxisRole =
  | 'categoryX'
  | 'dateCategoryX'
  | 'xValue'
  | 'primaryYValue'
  | 'secondaryYValue';

export type ResolvedChartCartesianScaleAuthority = 'explicitDomain' | 'excelAutoDomain';
export type ResolvedChartCartesianAxisTickSkipSource =
  | 'explicit'
  | 'importedAuto'
  | 'rendererAuto'
  | 'none';
export type ResolvedChartCartesianPercentAxisLabelPolicy = 'percentFromHundred';
export type ResolvedChartCartesianAxisLayoutStatus = 'exact' | 'verifiedDefault' | 'approximate';
export type ResolvedChartXYVisualContractStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';
export type ResolvedChartCartesianRenderedAxisOrient = 'top' | 'bottom' | 'left' | 'right';
export type ResolvedChartCartesianAxisPeerKind = 'quantitative' | 'categoryPoint' | 'dateSerial';
export type ResolvedChartCartesianAxisCategoryCrossingApplication =
  | 'applied'
  | 'notApplicableQuantitativePeer'
  | 'defaultBetween'
  | 'defaultMidCat';
export type ResolvedChartCartesianAxisCrossingEffectiveMode =
  | 'automaticValue'
  | 'min'
  | 'max'
  | 'customValue'
  | 'categoryEdge'
  | 'categoryCenter'
  | 'defaultEdge';

export interface ResolvedChartCartesianAxisCrossingSnapshot {
  sourceCrossing?: 'automatic' | 'min' | 'max' | 'custom';
  sourceCrossingValue?: number;
  sourceCategoryCrossing?: 'between' | 'midCat';
  categoryCrossingApplication?: ResolvedChartCartesianAxisCategoryCrossingApplication;
  peerAxisKind?: ResolvedChartCartesianAxisPeerKind;
  plannedPixel?: number;
  renderedPixel?: number;
  plannedPlotPosition?: number;
  renderedPlotPosition?: number;
  deltaPx?: number;
  effectiveMode?: ResolvedChartCartesianAxisCrossingEffectiveMode;
}

export type ResolvedChartCartesianPathOrder = 'source' | 'xAscending';
export type ResolvedChartCartesianLayerRole = 'linePath' | 'marker' | 'areaFill' | 'bubble';
export type ResolvedChartCartesianSizeAuthority = 'bubbleSize' | 'markerStyle' | 'fixedMarkSize';
export type ResolvedChartAreaSurfaceExtentPolicy =
  | 'pointCaps'
  | 'plotEdgeCaps'
  | 'centeredSingleton';
export type ResolvedChartAreaSurfaceExtentStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';
export type ResolvedChartAreaSurfaceStyleStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';
export type ResolvedChartCartesianPointAuthorityFamily = 'path' | 'scatter';
export type ResolvedChartCartesianPointAuthoritySource = 'importedRendererEvidence';
export type ResolvedChartCartesianPointAuthorityStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';

export interface ResolvedChartPathPlotFrameSnapshot {
  renderedPlotArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  normalizedPlotArea?: ResolvedChartLayoutRectSnapshot;
  reservations?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  reservationStatus?: ResolvedChartCartesianAxisLayoutStatus;
  reservationStatusReason?: string;
  preReconcileAxisLength?: number;
  postReconcileAxisLength?: number;
  preReconcileCategoryPitch?: number;
  postReconcileCategoryPitch?: number;
}

export interface ResolvedChartAreaSurfaceStyleSnapshot {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  fill?: string;
  fillPaintType?: string;
  fillOpacity?: number;
  stroke?: string;
  strokePaintType?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  strokeOpacity?: number;
  styleStatus: ResolvedChartAreaSurfaceStyleStatus;
  styleStatusReason?: string;
}

export interface ResolvedChartAreaSurfaceExtentSnapshot {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  segmentIndex: number;
  pointCount: number;
  policy: ResolvedChartAreaSurfaceExtentPolicy;
  firstPointX: number;
  lastPointX: number;
  leftCapX: number;
  rightCapX: number;
  firstPointPlotX: number;
  lastPointPlotX: number;
  leftCapPlotX: number;
  rightCapPlotX: number;
  clippingPolicy: 'clipToPlotBounds';
  extentStatus: ResolvedChartAreaSurfaceExtentStatus;
  extentStatusReason?: string;
}

export interface ResolvedChartCartesianAxisSourceSnapshot {
  axisPosition?: string;
  crossing?: 'automatic' | 'max' | 'min' | 'custom';
  crossingValue?: number;
  crossBetween?: string;
  isBetweenCategories?: boolean;
  reverse?: boolean;
  scaleType?: string;
  logBase?: number;
  explicitMin?: number;
  explicitMax?: number;
  majorUnit?: number;
  minorUnit?: number;
  tickLabelPosition?: string;
}

export interface ResolvedChartCartesianScaleGeometrySnapshot {
  field?: string;
  type?: string;
  axisOrient?: 'top' | 'bottom' | 'left' | 'right';
  domain?: Array<string | number | null>;
  range?: [number, number];
  plotRange?: [number, number];
  tickValues?: Array<string | number | null>;
  tickStep?: number;
  valueAxisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  scaleConsistencyStatus?: 'consistent' | 'planTraceMismatch';
  scaleConsistencyReason?: string;
  pathAxisLayout?: ResolvedChartCartesianCategoryXGeometrySnapshot['pathAxisLayout'];
}

export interface ResolvedChartCartesianPointGeometrySnapshot {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  category?: string | number | null;
  xValue?: number;
  yValue?: number;
  normalizedSize?: number;
  rawBubbleSize?: number;
  sourceBlank?: boolean;
  xPixel: number;
  yPixel: number;
  plotX: number;
  plotY: number;
  chartX: number;
  chartY: number;
  renderedArea?: number;
  renderedRadius?: number;
  clipToPlotArea?: boolean;
  layerIndex?: number;
  markType?: string;
  layerRole?: ResolvedChartCartesianLayerRole;
  sizeAuthority?: ResolvedChartCartesianSizeAuthority;
  segmentIndex?: number;
  pathIndex?: number;
  stackSign?: 'positive' | 'negative';
  stackValue?: number;
  percentValue?: number;
  baselinePixel?: number;
  topPixel?: number;
  bottomPixel?: number;
  baselinePlotY?: number;
  topPlotY?: number;
  bottomPlotY?: number;
}

export interface ResolvedChartCartesianLayerGeometrySnapshot {
  layerIndex: number;
  markType: string;
  layerRole?: ResolvedChartCartesianLayerRole;
  sizeAuthority?: ResolvedChartCartesianSizeAuthority;
  pathOrder?: ResolvedChartCartesianPathOrder;
  xField?: string;
  yField?: string;
  sizeField?: string;
  xAxisRole?: Extract<ResolvedChartCartesianAxisRole, 'categoryX' | 'dateCategoryX' | 'xValue'>;
  yAxisRole?: Extract<ResolvedChartCartesianAxisRole, 'primaryYValue' | 'secondaryYValue'>;
  xScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  yScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  sizeScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  pointCount: number;
  seriesIndices: number[];
  areaSurfaceStyles?: ResolvedChartAreaSurfaceStyleSnapshot[];
  areaSurfaceExtents?: ResolvedChartAreaSurfaceExtentSnapshot[];
  area?: {
    baselinePixel?: number;
    baselinePlotY?: number;
  };
}

export interface ResolvedChartCartesianCategoryXGeometrySnapshot {
  mode: 'categoryPoint' | 'dateSerial';
  axisRole?: 'categoryX' | 'dateCategoryX';
  domain: Array<string | number>;
  pointCount: number;
  scaleAuthority?: ResolvedChartCartesianScaleAuthority;
  source?: ResolvedChartCartesianAxisSourceSnapshot;
  positionPolicy?: 'between' | 'onCategory' | 'centeredSingleton';
  pathAxisLayout?: {
    categoryTickLabelSkip?: number;
    categoryTickMarkSkip?: number;
    categoryTickSkipSource?: ResolvedChartCartesianAxisTickSkipSource;
    axisLength?: number;
    categoryPitch?: number;
    labelBudget?: number;
    projectedLabelWidth?: number;
    visibleLabelCount?: number;
    axisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
    axisLayoutStatusReason?: string;
    categoryAxisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
    categoryAxisLayoutStatusReason?: string;
    categoryPitchStatus?: ResolvedChartCartesianAxisLayoutStatus;
    categoryPitchStatusReason?: string;
    categoryTickStatus?: ResolvedChartCartesianAxisLayoutStatus;
    categoryTickStatusReason?: string;
    valueAxisLayoutStatus?: ResolvedChartCartesianAxisLayoutStatus;
    valueAxisLayoutStatusReason?: string;
    reservationStatus?: ResolvedChartCartesianAxisLayoutStatus;
    reservationStatusReason?: string;
  };
  stableKeys: boolean;
  range?: [number, number];
  plotRange?: [number, number];
}

export interface ResolvedChartCartesianQuantitativeXGeometrySnapshot {
  mode: 'quantitative';
  axisRole?: 'xValue';
  domain?: [number, number];
  field: string;
  includeZero?: boolean;
  explicitDomain?: boolean;
  scaleAuthority?: ResolvedChartCartesianScaleAuthority;
  tickStep?: number;
  source?: ResolvedChartCartesianAxisSourceSnapshot;
  renderedAxisOrient?: ResolvedChartCartesianRenderedAxisOrient;
  axisVisualStatus?: ResolvedChartXYVisualContractStatus;
  axisVisualStatusReason?: string;
  crossingStatus?: ResolvedChartXYVisualContractStatus;
  crossingStatusReason?: string;
  crossing?: ResolvedChartCartesianAxisCrossingSnapshot;
  reservationStatus?: ResolvedChartXYVisualContractStatus;
  reservationStatusReason?: string;
  tickValues?: Array<string | number | null>;
  range?: [number, number];
  plotRange?: [number, number];
}

export interface ResolvedChartAreaGeometrySnapshot {
  stackMode: 'none' | 'zero' | 'normalize' | 'center';
  baseline: number;
  percentDomain?: [number, number];
  groups: Array<{
    axisGroup: 'primary' | 'secondary';
    xRole: ChartSeriesXRole;
    groupKey?: string;
    memberCount?: number;
    seriesIndices: number[];
    hiddenGeometrySeriesIndices?: number[];
  }>;
}

export interface ResolvedChartBubbleGeometrySnapshot {
  sizeRepresents: 'area' | 'w';
  bubbleScale: number;
  showNegBubbles: boolean;
  maxRenderableMagnitude: number;
  sizeDomain?: [number, number];
  sizeRange?: [number, number];
  maxRenderedArea: number;
  maxRenderedRadius?: number;
  normalizedSizeField: string;
  rawSizeField: string;
  clippingPolicy?: 'clipToPlotArea' | 'overflowPlotArea';
  sizeScaleAuthority?: 'excelBubbleScale';
}

export interface ResolvedChartCartesianPointAuthoritySnapshot {
  schemaVersion: 1;
  family: ResolvedChartCartesianPointAuthorityFamily;
  source: ResolvedChartCartesianPointAuthoritySource;
  status: ResolvedChartCartesianPointAuthorityStatus;
  statusReason?: string;
  seriesIndices: number[];
  layerIndices: number[];
  sourcePointCount: number;
  renderedPointCount: number;
  plotFrameStatus?: ResolvedChartCartesianPointAuthorityStatus;
  xAxisStatus?: ResolvedChartCartesianPointAuthorityStatus;
  valueAxisStatus?: ResolvedChartCartesianPointAuthorityStatus;
  scaleConsistencyStatus?: ResolvedChartCartesianPointAuthorityStatus;
  layerOrderStatus?: ResolvedChartCartesianPointAuthorityStatus;
  pointGeometryStatus?: ResolvedChartCartesianPointAuthorityStatus;
  styleStatus?: ResolvedChartCartesianPointAuthorityStatus;
  areaSurfaceStatus?: ResolvedChartCartesianPointAuthorityStatus;
  markerGeometryStatus?: ResolvedChartCartesianPointAuthorityStatus;
  markerGlyphStatus?: ResolvedChartCartesianPointAuthorityStatus;
  interpolationStatus?: ResolvedChartCartesianPointAuthorityStatus;
  diagnostics: string[];
}

export type ResolvedChartCartesianComboLayerAuthoritySource = 'importedRendererEvidence';
export type ResolvedChartCartesianComboLayerAuthorityStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';

export interface ResolvedChartCartesianComboLayerAuthoritySnapshot {
  schemaVersion: 1;
  source: ResolvedChartCartesianComboLayerAuthoritySource;
  status: ResolvedChartCartesianComboLayerAuthorityStatus;
  statusReason?: string;
  diagnostics: string[];
  barSeriesIndices: number[];
  nonBarSeriesIndices: number[];
  pathSeriesIndices: number[];
  scatterSeriesIndices: number[];
  bubbleSeriesIndices: number[];
  barGeometryGroupKeys: string[];
  layerIndices: number[];
  plotFrameStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  barGeometryStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  nonBarPointAuthorityStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  axisOwnershipStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  valueAxisStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  scaleConsistencyStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  layerOrderStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  legendOrderStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
  styleStatus?: ResolvedChartCartesianComboLayerAuthorityStatus;
}

export interface ResolvedChartCartesianGeometrySnapshot {
  geometryStatus?: ResolvedChartCartesianGeometryStatus;
  coordinateSystem?: 'chartPixel';
  chartWidth?: number;
  chartHeight?: number;
  plotArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pathPlotFrame?: ResolvedChartPathPlotFrameSnapshot;
  x: {
    modes: ResolvedChartCartesianXGeometryMode[];
    category?: ResolvedChartCartesianCategoryXGeometrySnapshot;
    quantitative?: ResolvedChartCartesianQuantitativeXGeometrySnapshot;
  };
  valueAxes: ResolvedChartCartesianValueAxisGeometrySnapshot[];
  layers?: ResolvedChartCartesianLayerGeometrySnapshot[];
  area?: ResolvedChartAreaGeometrySnapshot;
  bubble?: ResolvedChartBubbleGeometrySnapshot;
  pointAuthority?: ResolvedChartCartesianPointAuthoritySnapshot[];
  comboAuthority?: ResolvedChartCartesianComboLayerAuthoritySnapshot;
  series: Array<{
    seriesIndex: number;
    type: string;
    xRole: ChartSeriesXRole;
    xMode: ResolvedChartCartesianXGeometryMode;
    axisGroup: 'primary' | 'secondary';
    showLines?: boolean;
    showMarkers?: boolean;
    sourceShowLines?: boolean;
    lineVisibleInk?: boolean;
    lineNoFill?: boolean;
    lineZeroWidth?: boolean;
    lineStroke?: string;
    lineStrokeWidth?: number;
    lineDash?: number[];
    lineOpacity?: number;
    lineInterpolation?: 'linear' | 'monotone';
    lineVisualStatus?: ResolvedChartXYVisualContractStatus;
    lineVisualStatusReason?: string;
    sourceShowMarkers?: boolean;
    markerVisibleInk?: boolean;
    markerShape?: string;
    markerSize?: number;
    markerFill?: string;
    markerStroke?: string;
    markerStrokeWidth?: number;
    markerOpacity?: number;
    markerVisualStatus?: ResolvedChartXYVisualContractStatus;
    markerVisualStatusReason?: string;
    blankMarkerPolicy?: 'notApplicable' | 'suppressSourceBlankMarkers';
    blankMarkerPolicyStatus?: ResolvedChartXYVisualContractStatus;
    blankMarkerPolicyStatusReason?: string;
    sourceBlankPointCount?: number;
    zeroProjectedSourceBlankPointCount?: number;
    sourceBlankMarkerGeometryCount?: number;
    suppressedSourceBlankMarkerCount?: number;
    markerEligiblePointCount?: number;
    bubbleVisibleInk?: boolean;
    bubbleVisualStatus?: ResolvedChartXYVisualContractStatus;
    bubbleVisualStatusReason?: string;
    colorAuthorityStatus?: ResolvedChartXYVisualContractStatus;
    colorAuthoritySource?: string;
    colorAuthorityReason?: string;
    stackGroup?: string;
    markerLayer?: boolean;
    bubbleSizeAuthority?: 'series';
    layers?: number[];
    pointGeometry?: ResolvedChartCartesianPointGeometrySnapshot[];
    areaGeometry?: {
      baselinePixel?: number;
      baselinePlotY?: number;
      points: ResolvedChartCartesianPointGeometrySnapshot[];
    };
    areaSurfaceStyle?: ResolvedChartAreaSurfaceStyleSnapshot;
    areaSurfaceExtent?: ResolvedChartAreaSurfaceExtentSnapshot;
    markerGeometry?: {
      points: ResolvedChartCartesianPointGeometrySnapshot[];
    };
    bubbleGeometry?: {
      sizeDomain?: [number, number];
      sizeRange?: [number, number];
      maxRenderedArea?: number;
      maxRenderedRadius?: number;
      clippingPolicy?: 'clipToPlotArea' | 'overflowPlotArea';
      points: ResolvedChartCartesianPointGeometrySnapshot[];
    };
  }>;
}

/** Package identity/authority metadata for import/export diagnostics. */
export interface ChartPackageAuthoritySnapshot {
  source?: string;
  fingerprint?: string;
  status?: 'current' | 'stale' | 'unknown';
  details?: unknown;
}

export interface ResolvedChartSpecSnapshot {
  schemaVersion: 1;
  chartId: string;
  sheetId: string;
  sheetKind?: ChartSheetKindSnapshot;
  layoutAuthority?: ChartLayoutAuthority;
  renderFrame?: ChartRenderFrameSnapshot;
  chartArea?: ChartAreaSizeSnapshot;
  plotArea?: ChartAreaSizeSnapshot;
  pageContext?: ChartPageContextSnapshot;
  packageAuthority?: ChartPackageAuthoritySnapshot;
  chartObject: {
    id: string;
    name?: string;
    anchorRow?: number;
    anchorCol?: number;
    width?: number;
    height?: number;
    widthPt?: number;
    heightPt?: number;
  };
  export: ChartExportOptionsSnapshot;
  implementation: {
    renderAuthority: 'chartBridge';
    renderStatus: 'renderable';
    familySupport?: ChartFamilySupportSnapshot;
    compilerPathId: 'ts-grammar' | 'wasm-transforms+ts-grammar';
    compilerInputHash: string;
    compilerVersion: 1;
  };
  resolved: {
    chartType: string;
    subType?: string;
    grouping?: 'standard' | 'clustered' | 'stacked' | 'percentStacked';
    title: {
      present: boolean;
      text?: string;
    };
    legend: ResolvedChartLegendSnapshot;
    axes: {
      category?: ResolvedChartAxisSnapshot;
      value?: ResolvedChartAxisSnapshot;
      xValue?: ResolvedChartAxisSnapshot;
      yValue?: ResolvedChartAxisSnapshot;
      secondaryCategory?: ResolvedChartAxisSnapshot;
      secondaryValue?: ResolvedChartAxisSnapshot;
      series?: ResolvedChartAxisSnapshot;
    };
    series: ResolvedChartSeriesSnapshot[];
    seriesProjection: ResolvedChartSeriesProjectionSnapshot;
    categories: Array<string | number | null>;
    categoryLevels?: ResolvedChartCategoryLevelSnapshot[];
    layout?: ResolvedChartLayoutSnapshot;
    plot: {
      displayBlanksAs?: 'gap' | 'zero' | 'span';
      plotVisibleOnly?: boolean;
      gapWidth?: number;
      gapDepth?: number;
      overlap?: number;
      barGeometry?: ResolvedChartBarGeometrySnapshot[];
      cartesianGeometry?: ResolvedChartCartesianGeometrySnapshot;
      pieDoughnutGeometry?: ResolvedChartPieDoughnutGeometrySnapshot;
      stockGlyphGeometry?: ResolvedChartStockGlyphGeometrySnapshot;
      radarProjection?: ResolvedChartRadarProjectionSnapshot;
      threeDApproximation?: ResolvedChartThreeDApproximationSnapshot;
      surfaceApproximation?: ResolvedChartSurfaceApproximationSnapshot;
    };
    ranges: {
      dataRange: ChartRangeReferenceSnapshot | null;
      categoryRange: ChartRangeReferenceSnapshot | null;
      seriesRange: ChartRangeReferenceSnapshot | null;
      seriesReferences: Array<{
        index: number;
        name?: ChartRangeReferenceSnapshot | null;
        values: ChartRangeReferenceSnapshot | null;
        categories: ChartRangeReferenceSnapshot | null;
        bubbleSize?: ChartRangeReferenceSnapshot | null;
      }>;
      diagnostics: ChartRangeDiagnosticSnapshot[];
    };
    dataHashes: {
      categoriesHash: string;
      seriesHash: string;
    };
  };
  diagnostics: {
    compiler: string[];
    unsupportedFeatures: string[];
  };
}

/** Dimension identifiers for series data access. */
export type ChartSeriesDimension = 'categories' | 'values' | 'bubbleSizes';

/** Leader line formatting for data labels. */
export interface ChartLeaderLinesFormat {
  format: ChartLineFormat;
}

/** Chart-level line feature such as drop lines, high-low lines, or series lines. */
export interface ChartLineSettings {
  visible?: boolean;
  format?: ChartLineFormat;
}

/** Up/down bar settings for line and stock charts. */
export interface UpDownBarsConfig {
  gapWidth?: number;
  upFormat?: ChartFormat;
  downFormat?: ChartFormat;
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

/** 3D view metadata preserved from OOXML. Rendered by the 2D backend as an approximation. */
export interface ChartView3DConfig {
  rotX?: number;
  rotY?: number;
  depthPercent?: number;
  rAngAx?: boolean;
  perspective?: number;
  heightPercent?: number;
}

/** Source surface band formatting preserved from OOXML for approximation evidence. */
export interface ChartSurfaceBandFormat {
  index: number;
  fillColor?: string;
  hasFormatting: boolean;
  source?: 'ooxmlBandFmt';
}

// =============================================================================
// Public API Types
// =============================================================================

/**
 * Public chart configuration -- the shape used by the unified API surface.
 *
 * This contains all user-facing fields for creating/updating charts.
 * Internal-only fields (CellId anchors, table linking cache)
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
  /** Chart width in points. */
  width: number;
  /** Chart height in points. */
  height: number;
  /** Layout authority for render diagnostics. */
  layoutAuthority?: ChartLayoutAuthority;

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
  dropLines?: ChartLineSettings;
  highLowLines?: ChartLineSettings;
  seriesLines?: ChartLineSettings;
  upDownBars?: UpDownBarsConfig;
  stockSourceComposition?: StockSourceComposition;

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
  /**
   * Gap depth between 3D bar/column series as percentage (0-500).
   * Consumed by approximate 3D renderers and preserved for import/export.
   */
  gapDepth?: number;
  /** Overlap between bars/columns (-100 to 100). Applied to clustered bar/column types. */
  overlap?: number;
  /** Hole size for doughnut charts as percentage (10-90) */
  doughnutHoleSize?: number;
  /** First slice angle for pie/doughnut charts in degrees (0-360) */
  firstSliceAngle?: number;
  /** Bubble scale for bubble charts as percentage (0-300) */
  bubbleScale?: number;
  /** Whether to render negative/zero bubble sizes. */
  showNegBubbles?: boolean;
  /** Whether bubble values represent area or width/diameter. */
  sizeRepresents?: 'area' | 'w';
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
  hierarchy?: HierarchyChartConfig;

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
  /** Manual plot-area layout imported from OOXML. */
  plotLayout?: ManualLayout;
  /** Manual title layout imported from OOXML. */
  titleLayout?: ManualLayout;
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
  /** Pivot/import projection metadata used by render and snapshot diagnostics. */
  pivotProjection?: PivotChartProjectionData;

  // 3D metadata preserved from OOXML and consumed only by approximate
  // 3D/surface renderers unless an exact contract says otherwise.
  view3d?: ChartView3DConfig;
  /** Preserved floor metadata; approximate renderers may use it only as non-Excel-equivalent context. */
  floorFormat?: ChartFormat;
  /** Preserved side-wall metadata; approximate renderers may use it only as non-Excel-equivalent context. */
  sideWallFormat?: ChartFormat;
  /** Preserved back-wall metadata; approximate renderers may use it only as non-Excel-equivalent context. */
  backWallFormat?: ChartFormat;

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
  barShape?: 'box' | 'cylinder' | 'cone' | 'coneToMax' | 'pyramid' | 'pyramidToMax';

  /**
   * Extensible extra data for enriched chart configurations.
   * Contains additional chart-specific settings (e.g., chartTitle font, chartArea fill)
   * that are stored on the chart but not part of the core config schema.
   */
  extra?: unknown;

  // Position aliases preserved for imported chart metadata.
  /** @deprecated Use height. */
  heightPt?: number;
  /** @deprecated Use width. */
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
  /** Source surface band formatting preserved for approximate surface/contour evidence. */
  surfaceBandFormats?: ChartSurfaceBandFormat[];

  // Color scheme (Group L)
  /** Chart color scheme index */
  colorScheme?: number;

  /**
   * Workbook theme context for chart rendering. Kernel attaches this before
   * compilation so charts-core can resolve theme references after chart style
   * and color-map precedence, instead of receiving pre-mutated CSS strings.
   */
  workbookTheme?: ChartWorkbookThemeData;

  /** Unresolved imported style context consumed by the chart style resolver. */
  chartStyleContext?: ChartStyleContext;
}

/**
 * Chart as returned by get/list operations.
 *
 * Extends ChartConfig with identity and metadata fields.
 */
export interface Chart extends ChartConfig {
  id: string;
  sheetId?: string;
  /** Read-only drawing stack order metadata. Use zOrder updates to change it. */
  zIndex?: number;
  createdAt?: number;
  updatedAt?: number;
}
