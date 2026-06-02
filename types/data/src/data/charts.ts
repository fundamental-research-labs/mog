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
  dashStyle?: 'solid' | 'dot' | 'dash' | 'dashDot' | 'longDash' | 'longDashDot' | 'longDashDotDot';
  transparency?: number;
  /** Explicit OOXML a:ln/a:noFill. Absent line formatting is not an explicit no-line. */
  noFill?: boolean;
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

/** Imported stock chart source role for HLC/OHLC and volume stock charts. */
export type ChartSeriesStockRole = 'volume' | 'open' | 'high' | 'low' | 'close';

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
  | 'surfaceApproximation'
  | 'contourApproximation'
  | 'surfaceProjectionIncomplete'
  | 'contourProjectionIncomplete'
  | 'threeDApproximation'
  | 'bubbleLegendSeriesDomain'
  | 'radarLayoutFidelity'
  | 'radarAutoValueScaleFidelity'
  | 'radarMarkerStyleFidelity'
  | 'radarFillStyleFidelity'
  | 'radarGridLabelStyleFidelity'
  | 'unsupportedImportStatus'
  | 'preservedPlaceholderImportStatus';

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
  categoryLabelFormat?: CategoryLabelFormat;
  bubbleSize?: string;
  bubbleSizeCache?: ChartSeriesPointCache;
  bubbleSizeSourceKind?: ChartSeriesDimensionSourceKind;
  smooth?: boolean;
  showLines?: boolean;
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

export interface ChartExportOptionsSnapshot {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  pixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  backgroundColor: string;
  quality?: number;
}

export interface ChartRangeReferenceSnapshot {
  kind: string;
  source: 'identity' | 'a1';
  ref?: string;
  range: {
    sheetId?: string;
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
  entries: string[];
  visibleEntries: string[];
  entryVocabulary?: ChartLegendEntryVocabulary;
  entryLayer?: ChartSemanticLayer;
  entryIndexKind?: ChartLegendEntryIndexKind;
  entryItems?: ResolvedChartLegendEntrySnapshot[];
  visibleEntryItems?: ResolvedChartLegendEntrySnapshot[];
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
  markerStyle?: string;
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

export type ResolvedChartCartesianXGeometryMode =
  | 'categoryPoint'
  | 'dateSerial'
  | 'quantitative';

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

export interface ResolvedChartStockRenderProjectionSnapshot {
  projectionType: 'stockGlyph';
  renderedSeriesIndex: number;
  renderedSourceSeriesKey: string;
  roles: ResolvedChartProjectedRoleMappingSnapshot[];
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
  fillOpacity?: number;
  markers: boolean;
  markerShape?: string;
  points: ResolvedChartRadarPolarPointSnapshot[];
}

export type ResolvedChartRadarValueDomainAuthority = 'explicitAxis' | 'excelAuto' | 'fallback';

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
  blankPolicy: 'skip' | 'zero';
  filled: boolean;
  fillOpacity?: number;
  markers: boolean;
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

export type ResolvedChartPieDoughnutGeometryFamily =
  | 'pie'
  | 'doughnut'
  | 'ofPie'
  | 'pie3dApproximation';

export interface ResolvedChartPieDoughnutSliceSnapshot {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  pointIndex: number;
  category: string | number | null;
  value: number;
  sanitizedValue: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  angle: number;
  centerX: number;
  centerY: number;
  explosionPercent: number;
  explosionOffset: number;
  x: number;
  y: number;
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
  radius: number;
  padding: number;
  rings: ResolvedChartPieDoughnutRingSnapshot[];
}

export interface ResolvedChartBarGeometryOffsetSnapshot {
  seriesIndex: number;
  offset: number;
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
  axisLayoutStatus?: 'exact' | 'verifiedDefault' | 'approximate';
  axisLayoutStatusReason?: string;
  geometryStatus?: 'exact' | 'verifiedDefault' | 'approximate';
  plotAreaSource?: 'auto' | 'manual';
  categoryAxisLength?: number;
  visibleCategoryCount?: number;
  categoryPitch?: number;
  barSize?: number;
  offsets?: ResolvedChartBarGeometryOffsetSnapshot[];
}

export interface ResolvedChartCartesianValueAxisGeometrySnapshot {
  axisGroup: 'primary' | 'secondary';
  axisRole?: 'primaryYValue' | 'secondaryYValue';
  domain?: [number, number];
  includeZero: boolean;
  explicitDomain: boolean;
  scaleAuthority?: ResolvedChartCartesianScaleAuthority;
  tickStep?: number;
  source?: ResolvedChartCartesianAxisSourceSnapshot;
  tickValues?: Array<string | number | null>;
  range?: [number, number];
  plotRange?: [number, number];
}

export type ResolvedChartCartesianGeometryStatus = 'available' | 'unavailable';

export type ResolvedChartCartesianAxisRole =
  | 'categoryX'
  | 'dateCategoryX'
  | 'xValue'
  | 'primaryYValue'
  | 'secondaryYValue';

export type ResolvedChartCartesianScaleAuthority = 'explicitDomain' | 'excelAutoDomain';

export interface ResolvedChartCartesianAxisSourceSnapshot {
  axisPosition?: string;
  crossing?: 'automatic' | 'max' | 'min' | 'custom';
  crossingValue?: number;
  crossBetween?: string;
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
  segmentIndex?: number;
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
  xField?: string;
  yField?: string;
  sizeField?: string;
  xAxisRole?: Extract<
    ResolvedChartCartesianAxisRole,
    'categoryX' | 'dateCategoryX' | 'xValue'
  >;
  yAxisRole?: Extract<
    ResolvedChartCartesianAxisRole,
    'primaryYValue' | 'secondaryYValue'
  >;
  xScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  yScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  sizeScale?: ResolvedChartCartesianScaleGeometrySnapshot;
  pointCount: number;
  seriesIndices: number[];
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
  x: {
    modes: ResolvedChartCartesianXGeometryMode[];
    category?: ResolvedChartCartesianCategoryXGeometrySnapshot;
    quantitative?: ResolvedChartCartesianQuantitativeXGeometrySnapshot;
  };
  valueAxes: ResolvedChartCartesianValueAxisGeometrySnapshot[];
  layers?: ResolvedChartCartesianLayerGeometrySnapshot[];
  area?: ResolvedChartAreaGeometrySnapshot;
  bubble?: ResolvedChartBubbleGeometrySnapshot;
  series: Array<{
    seriesIndex: number;
    type: string;
    xRole: ChartSeriesXRole;
    xMode: ResolvedChartCartesianXGeometryMode;
    axisGroup: 'primary' | 'secondary';
    showLines?: boolean;
    showMarkers?: boolean;
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
      radarProjection?: ResolvedChartRadarProjectionSnapshot;
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
  /** Layout authority for render diagnostics; embedded charts keep width/height as cell counts. */
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
  /** Gap depth between 3D bar/column series as percentage (0-500). Preserved for import/export. */
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

  // 3D preserve-only metadata
  view3d?: ChartView3DConfig;
  floorFormat?: ChartFormat;
  sideWallFormat?: ChartFormat;
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
  createdAt?: number;
  updatedAt?: number;
}
