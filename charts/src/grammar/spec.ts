/**
 * ChartSpec Type Definitions - Vega-Lite Compatible Grammar of Graphics
 *
 * This file defines the specification format for declarative chart creation.
 * The format is inspired by Vega-Lite for AI compatibility and expressiveness.
 *
 * Type hierarchy:
 *   BaseSpec          -- shared fields (title, data, transform, width, height, config, etc.)
 *     UnitSpec        -- single mark + encoding (e.g., a bar chart)
 *     LayerSpec       -- multiple overlaid marks (e.g., combo chart)
 *   ChartSpec = UnitSpec | LayerSpec
 *
 * Pure types only - no runtime code (except type guards).
 */

import type {
  EffectSpec,
  LineStyleSpec,
  PaintSpec,
  ShadowSpec,
  TextRunSpec,
} from '../primitives/types';

// =============================================================================
// Data Types
// =============================================================================

/**
 * A single row of data for chart rendering.
 */
export type DataRow = Record<string, unknown>;

/**
 * Inline data values.
 */
export interface InlineData {
  values: DataRow[];
}

/**
 * Reference to a cell range (A1 notation - resolved to CellIdRange by engine/).
 */
export interface RangeData {
  range: string;
}

/**
 * CRDT-safe cell ID range reference (used internally after resolution).
 */
export interface CellIdRangeData {
  cellIdRange: {
    sheetId: string;
    startCellId: string;
    endCellId: string;
  };
}

/**
 * Data source for a chart.
 */
export type DataSource = InlineData | RangeData | CellIdRangeData;

// =============================================================================
// Transform Types
// =============================================================================

/**
 * Filter predicate specification.
 */
export interface FilterSpec {
  field: string;
  equal?: unknown;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  oneOf?: unknown[];
  range?: [number, number];
}

/**
 * Aggregation specification.
 */
export interface AggregateSpec {
  groupby: string[];
  aggregate: Array<{
    op: 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count' | 'variance' | 'stdev';
    field?: string;
    as: string;
  }>;
}

/**
 * Binning specification.
 */
export interface BinSpec {
  field: string;
  as: string;
  maxbins?: number;
  step?: number;
  nice?: boolean;
}

/**
 * Sort specification.
 */
export interface SortSpec {
  field: string;
  order?: 'ascending' | 'descending';
}

/**
 * Calculate (derive new field) specification.
 */
export interface CalculateSpec {
  calculate: string;
  as: string;
}

/**
 * Fold (pivot long) specification.
 */
export interface FoldSpec {
  fold: string[];
  as: [string, string];
}

/**
 * Regression transform specification.
 */
export interface RegressionSpec {
  regression: string;
  on: string;
  method?: 'linear' | 'log' | 'exp' | 'pow' | 'quad' | 'poly';
  order?: number;
  as?: [string, string];
  _showEquation?: boolean;
  _showR2?: boolean;
  _movingAveragePeriod?: number;
}

/**
 * Density estimation specification.
 */
export interface DensitySpec {
  density: string;
  bandwidth?: number;
  extent?: [number, number];
  steps?: number;
  as?: [string, string];
}

/**
 * Discriminant for transform variants.
 * Required on every Transform to enable discriminated union dispatch.
 */
export type TransformType =
  | 'filter'
  | 'aggregate'
  | 'bin'
  | 'sort'
  | 'calculate'
  | 'fold'
  | 'regression'
  | 'density';

/**
 * Discriminated union of all transform types.
 * Every variant requires a `type` discriminant for explicit dispatch.
 */
export type Transform =
  | { type: 'filter'; filter: FilterSpec | string }
  | { type: 'aggregate'; aggregate: AggregateSpec[] }
  | { type: 'bin'; bin: BinSpec }
  | { type: 'sort'; sort: SortSpec[] }
  | (CalculateSpec & { type: 'calculate' })
  | (FoldSpec & { type: 'fold' })
  | (RegressionSpec & { type: 'regression' })
  | (DensitySpec & { type: 'density' });

// =============================================================================
// Transform Type Guards
// =============================================================================

/** Check if a Transform is a filter transform. */
export function isFilterTransform(
  t: Transform,
): t is { type: 'filter'; filter: FilterSpec | string } {
  return 'filter' in t;
}

/** Check if a Transform is an aggregate transform. */
export function isAggregateTransform(
  t: Transform,
): t is { type: 'aggregate'; aggregate: AggregateSpec[] } {
  return 'aggregate' in t;
}

/** Check if a Transform is a bin transform. */
export function isBinTransform(t: Transform): t is { type: 'bin'; bin: BinSpec } {
  return 'bin' in t;
}

/** Check if a Transform is a sort transform. */
export function isSortTransform(t: Transform): t is { type: 'sort'; sort: SortSpec[] } {
  return 'sort' in t;
}

/** Check if a Transform is a calculate transform. */
export function isCalculateTransform(t: Transform): t is CalculateSpec & { type: 'calculate' } {
  return 'calculate' in t;
}

/** Check if a Transform is a fold transform. */
export function isFoldTransform(t: Transform): t is FoldSpec & { type: 'fold' } {
  return 'fold' in t;
}

/** Check if a Transform is a regression transform. */
export function isRegressionTransform(t: Transform): t is RegressionSpec & { type: 'regression' } {
  return 'regression' in t;
}

/** Check if a Transform is a density transform. */
export function isDensityTransform(t: Transform): t is DensitySpec & { type: 'density' } {
  return 'density' in t;
}

// =============================================================================
// Scale Types
// =============================================================================

/**
 * Scale type options.
 */
export type ScaleType =
  | 'linear'
  | 'log'
  | 'pow'
  | 'sqrt'
  | 'symlog'
  | 'time'
  | 'utc'
  | 'ordinal'
  | 'band'
  | 'point'
  | 'quantile'
  | 'quantize'
  | 'threshold';

/**
 * Scale specification.
 */
export interface ScaleSpec {
  type?: ScaleType;
  domain?: unknown[] | 'unaggregated';
  range?: unknown[];
  nice?: boolean | number;
  zero?: boolean;
  reverse?: boolean;
  clamp?: boolean;
  padding?: number;
  paddingInner?: number;
  paddingOuter?: number;
  exponent?: number;
  base?: number;
  scheme?: string;
}

// =============================================================================
// Axis Types
// =============================================================================

/**
 * Axis orientation options.
 */
export type AxisOrient = 'top' | 'bottom' | 'left' | 'right';
export type AxisLabelPosition = 'nextTo' | 'low' | 'high' | 'none';
export type AxisTickMark = 'none' | 'out' | 'in' | 'cross';
export type AxisCategoryCrossing = 'between' | 'midCat';

export type AxisTickIntervalUnit = 'day' | 'month' | 'year';

export interface AxisTickInterval {
  unit: AxisTickIntervalUnit;
  step: number;
}

/**
 * Axis specification.
 */
export interface AxisSpec {
  title?: string | null;
  titleFontSize?: number;
  titleFontFamily?: string;
  titleColor?: string;
  titlePadding?: number;
  labels?: boolean;
  labelFontSize?: number;
  labelFontFamily?: string;
  labelColor?: string;
  labelAngle?: number;
  labelPadding?: number;
  labelOverlap?: boolean | 'parity' | 'greedy';
  labelPosition?: AxisLabelPosition;
  tickLabelSkip?: number;
  ticks?: boolean;
  tickMark?: AxisTickMark;
  tickMarkSkip?: number;
  tickCount?: number;
  tickSize?: number;
  tickColor?: string;
  tickWidth?: number;
  tickStep?: number;
  tickInterval?: AxisTickInterval;
  grid?: boolean;
  gridColor?: string;
  gridWidth?: number;
  gridOpacity?: number;
  gridDash?: number[];
  minorTicks?: boolean;
  minorTickMark?: AxisTickMark;
  minorTickSize?: number;
  minorTickColor?: string;
  minorTickWidth?: number;
  minorTickStep?: number;
  minorTickInterval?: AxisTickInterval;
  minorGrid?: boolean;
  minorGridColor?: string;
  minorGridWidth?: number;
  minorGridOpacity?: number;
  minorGridDash?: number[];
  crossesAt?: 'automatic' | 'min' | 'max' | 'custom';
  crossesAtValue?: number;
  categoryCrossing?: AxisCategoryCrossing;
  format?: string;
  displayUnitFactor?: number;
  displayUnitLabel?: string;
  linkNumberFormat?: boolean;
  /** Per-category format code keyed by the raw category value. */
  labelFormatByValue?: Record<string, string>;
  /** Per-category display text keyed by the raw category value. */
  labelTextByValue?: Record<string, string>;
  /** Per-category hierarchical display labels, ordered from parent to child. */
  multiLevelLabelsByValue?: Record<string, string[]>;
  formatType?: 'number' | 'time';
  orient?: AxisOrient;
  offset?: number;
  domain?: boolean;
  domainColor?: string;
  domainWidth?: number;
}

// =============================================================================
// Legend Types
// =============================================================================

/**
 * Legend orientation options.
 */
export type LegendOrient =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'none';

export type LegendSymbolType =
  | 'area'
  | 'circle'
  | 'square'
  | 'line'
  | 'cross'
  | 'diamond'
  | 'triangle-up'
  | 'triangle-down';

export interface LegendEntrySpec {
  /** Backing color-scale value for this legend entry. */
  value: string;
  /** Display label, when it differs from the backing value. */
  label?: string;
  /** Entry-specific symbol shape, used by mixed-family combo charts. */
  symbolType?: LegendSymbolType;
  /** Rendered series index for provenance/debugging. */
  seriesIndex?: number;
  /** Source workbook series index, when known. */
  sourceSeriesIndex?: number;
  /** Stable source workbook series key, when known. */
  sourceSeriesKey?: string;
}

/**
 * Legend specification.
 */
export interface LegendSpec {
  title?: string | null;
  titleFontSize?: number;
  titleFontFamily?: string;
  titleColor?: string;
  orient?: LegendOrient;
  /** Whether the legend should be drawn over the plot area without reserving space. */
  overlay?: boolean;
  direction?: 'horizontal' | 'vertical';
  labelFontSize?: number;
  labelFontFamily?: string;
  labelColor?: string;
  /** Explicit legend entries to render when they differ from the backing scale domain. */
  values?: string[];
  /** Ordered, styled legend entries to render. */
  entries?: LegendEntrySpec[];
  /** Reverse legend entry order, used by stacked charts to match stack top-to-bottom. */
  reverse?: boolean;
  symbolSize?: number;
  symbolType?: LegendSymbolType;
  offset?: number;
  padding?: number;
}

// =============================================================================
// Channel/Encoding Types
// =============================================================================

/**
 * Field data type options.
 */
export type FieldType = 'quantitative' | 'ordinal' | 'nominal' | 'temporal';

/**
 * Aggregation operation options.
 */
export type AggregateOp =
  | 'sum'
  | 'mean'
  | 'median'
  | 'min'
  | 'max'
  | 'count'
  | 'variance'
  | 'stdev';

/**
 * Time unit options for temporal data.
 */
export type TimeUnit =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'dayofyear'
  | 'date'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'milliseconds'
  | 'yearmonth'
  | 'yearmonthdate'
  | 'monthdate';

/**
 * Channel specification for encoding data to visual properties.
 */
export interface ChannelSpec {
  /** Field name in the data */
  field?: string;
  /** Data type */
  type?: FieldType;
  /** Aggregation operation */
  aggregate?: AggregateOp;
  /** Enable binning */
  bin?: boolean | { maxbins?: number; step?: number };
  /** Time unit for temporal data */
  timeUnit?: TimeUnit;
  /** Scale specification */
  scale?: ScaleSpec | null;
  /** Axis specification (null to hide) */
  axis?: AxisSpec | null;
  /** Secondary axis sharing this channel's scale. */
  secondaryAxis?: AxisSpec | null;
  /** Legend specification (null to hide) */
  legend?: LegendSpec | null;
  /** Channel title */
  title?: string | null;
  /** Value format string */
  format?: string;
  /** Constant value (instead of field mapping) */
  value?: unknown;
  /** Sort order or field */
  sort?: 'ascending' | 'descending' | SortSpec | null;
}

/**
 * Encoding specification - maps data fields to visual channels.
 */
export interface EncodingSpec {
  /** X position channel */
  x?: ChannelSpec;
  /** Y position channel */
  y?: ChannelSpec;
  /** Secondary X endpoint channel for ranged marks */
  x2?: ChannelSpec;
  /** Secondary Y endpoint channel for ranged marks */
  y2?: ChannelSpec;
  /** X offset for grouped charts */
  xOffset?: ChannelSpec;
  /** Y offset for grouped charts */
  yOffset?: ChannelSpec;
  /** Color channel */
  color?: ChannelSpec;
  /** Fill color channel */
  fill?: ChannelSpec;
  /** Stroke color channel */
  stroke?: ChannelSpec;
  /** Opacity channel */
  opacity?: ChannelSpec;
  /** Size channel */
  size?: ChannelSpec;
  /** Shape channel */
  shape?: ChannelSpec;
  /** Text channel */
  text?: ChannelSpec;
  /** Tooltip channel(s) */
  tooltip?: ChannelSpec | ChannelSpec[];
  /** Theta (angle) for arc marks */
  theta?: ChannelSpec;
  /** Radius for arc marks */
  radius?: ChannelSpec;
  /** Inner radius for arc marks */
  innerRadius?: ChannelSpec;
  /** Order channel for stacking/layering */
  order?: ChannelSpec;
  /** Detail channel for grouping without color */
  detail?: ChannelSpec;
  /** Facet row */
  row?: ChannelSpec;
  /** Facet column */
  column?: ChannelSpec;
}

// =============================================================================
// Mark Types
// =============================================================================

/**
 * Mark type options.
 */
export type MarkType =
  | 'bar'
  | 'bar3d'
  | 'line'
  | 'line3d'
  | 'area'
  | 'area3d'
  | 'point'
  | 'circle'
  | 'square'
  | 'arc'
  | 'arc3d'
  | 'rect'
  | 'rule'
  | 'text'
  | 'tick'
  | 'trail'
  | 'boxplot'
  | 'histogram'
  | 'violin'
  | 'contour'
  | 'radar'
  | 'surface3d';

/**
 * One filled value band in a top-view surface/contour chart.
 */
export interface ContourBandSpec {
  min: number;
  max: number;
  label: string;
  color: string;
}

/**
 * 3-D view metadata used by surface charts.
 */
export interface SurfaceView3DSpec {
  rotX?: number;
  rotY?: number;
  depthPercent?: number;
  rAngAx?: boolean;
  perspective?: number;
  heightPercent?: number;
}

export interface Plot3DSpec {
  family?: 'bar' | 'line' | 'area' | 'pie';
  orientation?: 'horizontal' | 'vertical';
  barShape?: 'box' | 'cylinder' | 'cone' | 'coneToMax' | 'pyramid' | 'pyramidToMax';
  gapDepth?: number;
  view3d?: SurfaceView3DSpec;
}

/**
 * Line interpolation options.
 */
export type Interpolate =
  | 'linear'
  | 'linear-closed'
  | 'step'
  | 'step-before'
  | 'step-after'
  | 'basis'
  | 'basis-open'
  | 'basis-closed'
  | 'cardinal'
  | 'cardinal-open'
  | 'cardinal-closed'
  | 'monotone';

/**
 * Mark specification with styling options.
 */
export interface MarkSpec {
  type: MarkType;
  /** Fill color */
  color?: string;
  /** Fill color */
  fill?: string;
  /** Fill paint */
  fillPaint?: PaintSpec;
  /** Stroke color */
  stroke?: string;
  /** Stroke paint */
  strokePaint?: PaintSpec;
  /** Stroke width */
  strokeWidth?: number;
  /** Full line style */
  line?: LineStyleSpec;
  /** Stroke dash pattern */
  strokeDash?: number[];
  /** Datum field for direct fill color */
  fillField?: string;
  /** Datum field for direct stroke color */
  strokeField?: string;
  /** Datum field for stroke width */
  strokeWidthField?: string;
  /** Datum field for direct x position */
  xField?: string;
  /** Datum field for direct y position */
  yField?: string;
  /** Datum field for direct secondary x position */
  x2Field?: string;
  /** Datum field for direct secondary y position */
  y2Field?: string;
  /** Coordinate system for direct mark fields. */
  coordinateSystem?:
    | 'plotFraction'
    | 'plotRadiusFraction'
    | 'chartFraction'
    | 'dataTableFraction'
    | 'pixel';
  /** Opacity (0-1) */
  opacity?: number;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
  /** Stroke opacity (0-1) */
  strokeOpacity?: number;
  /** Corner radius for bars */
  cornerRadius?: number;
  /** Corner radius for top-left */
  cornerRadiusTopLeft?: number;
  /** Corner radius for top-right */
  cornerRadiusTopRight?: number;
  /** Corner radius for bottom-left */
  cornerRadiusBottomLeft?: number;
  /** Corner radius for bottom-right */
  cornerRadiusBottomRight?: number;
  /** Size (for point, circle marks) */
  size?: number;
  /** Shape (for point marks: circle, square, diamond, etc.) */
  shape?: string;
  /** Font size (for text marks) */
  fontSize?: number;
  /** Font family (for text marks) */
  fontFamily?: string;
  /** Font weight (for text marks) */
  fontWeight?: 'normal' | 'bold' | number;
  /** Font style (for text marks) */
  fontStyle?: 'normal' | 'italic';
  /** Horizontal text alignment */
  align?: 'left' | 'center' | 'right';
  /** Vertical text baseline */
  textBaseline?: 'top' | 'middle' | 'bottom' | 'alphabetic' | 'hanging';
  /** Horizontal text pixel offset */
  dx?: number;
  /** Vertical text pixel offset */
  dy?: number;
  /** Text rotation angle in degrees */
  angle?: number;
  /** Datum field for horizontal text pixel offset */
  dxField?: string;
  /** Datum field for vertical text pixel offset */
  dyField?: string;
  /** Datum field for horizontal text alignment */
  alignField?: string;
  /** Datum field for vertical text baseline */
  baselineField?: string;
  /** Datum field for text fill color */
  colorField?: string;
  /** Datum field for font size */
  fontSizeField?: string;
  /** Datum field for text rotation angle */
  angleField?: string;
  /** Align text/rule category coordinates to the clustered bar slot for the datum's series. */
  alignToBarSlot?: boolean;
  /** Line interpolation method */
  interpolate?: Interpolate;
  /** Line tension (for cardinal interpolation) */
  tension?: number;
  /** Line baseline for areas */
  baseline?: number;
  /** Canvas-renderable effects */
  effects?: EffectSpec;
  /** Show points on lines */
  point?: boolean | { color?: string; size?: number; filled?: boolean };
  /** Skip point marks whose scaled x/y positions are not finite. */
  skipInvalidPositions?: boolean;
  /** Tick orientation when a tick mark has both x and y encodings. */
  orient?: 'horizontal' | 'vertical';
  /** Inner radius for arc marks (0-1 ratio or pixels) */
  innerRadius?: number;
  /** Outer radius for arc marks */
  outerRadius?: number;
  /** Pad angle between arcs */
  padAngle?: number;
  /** First arc slice angle in radians using the arc mark convention. */
  startAngle?: number;
  /** Tooltip enabled */
  tooltip?: boolean | { content?: 'data' | 'encoding' };
  /** Show KDE density curve overlay (histogram mark only) */
  density?: boolean;
  /** Filled value bands for top-view surface/contour marks. */
  contourBands?: ContourBandSpec[];
  /** Render top-view surface chart as contour isolines only. */
  contourWireframe?: boolean;
  /** Projected 3-D view settings for surface marks. */
  surfaceView3d?: SurfaceView3DSpec;
  /** Projected 3-D plot settings for non-surface chart families. */
  chart3d?: Plot3DSpec;
  /** Imported histogram bin count. */
  binCount?: number;
  /** Imported histogram bin width. */
  binWidth?: number;
  /** Imported histogram lower bound. */
  underflowBinValue?: number;
  /** Imported histogram upper bound. */
  overflowBinValue?: number;
  /** Show boxplot outlier points. */
  showOutlierPoints?: boolean;
  /** Show boxplot mean markers. */
  showMeanMarkers?: boolean;
  /** Show boxplot mean line. */
  showMeanLine?: boolean;
  /** Boxplot quartile calculation method. */
  quartileMethod?: string;
  /** Exploded slice index for pie charts (consumed by OOXML exporter) */
  _explodedIndex?: number;
  /** Exploded slice indices for pie charts (consumed by OOXML exporter) */
  _explodedIndices?: number[];
}

// =============================================================================
// Title Types
// =============================================================================

/**
 * Title specification.
 */
export interface TitleSpec {
  text: string;
  richText?: TextRunSpec[];
  anchor?: 'start' | 'middle' | 'end';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  color?: string;
  fill?: PaintSpec;
  shadow?: ShadowSpec;
  underline?: boolean;
  strikethrough?: boolean;
  offset?: number;
  orient?: 'top' | 'bottom';
  subtitle?: string;
  subtitleFontSize?: number;
  subtitleColor?: string;
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Stack mode options.
 */
export type StackMode = 'zero' | 'normalize' | 'center' | false;

export interface ChartFrameSpec {
  fill?: PaintSpec;
  line?: LineStyleSpec;
  shadow?: ShadowSpec;
  cornerRadius?: number;
  diagnostics?: string[];
}

export type ManualLayoutTargetSpec = 'inner' | 'outer';

export type ManualLayoutModeSpec = 'edge' | 'factor';

export interface ManualLayoutSpec {
  layoutTarget?: ManualLayoutTargetSpec;
  xMode?: ManualLayoutModeSpec;
  yMode?: ManualLayoutModeSpec;
  wMode?: ManualLayoutModeSpec;
  hMode?: ManualLayoutModeSpec;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type BarGeometryGrouping = 'standard' | 'clustered' | 'stacked' | 'percentStacked';

export type BarGeometryOrientation = 'horizontal' | 'vertical';

export type BarSeriesSlotOrder = 'source' | 'reverse';

export interface BarGeometrySpec {
  /** Horizontal bars use the y category axis; vertical columns use the x category axis. */
  orientation?: BarGeometryOrientation;
  /** Excel/OOXML bar grouping mode used for category slot layout. */
  grouping: BarGeometryGrouping;
  /** Source gap width when explicitly supplied by the chart config. */
  sourceGapWidth?: number;
  /** Source overlap when explicitly supplied by the chart config. */
  sourceOverlap?: number;
  /** Render-effective Excel gap width, clamped to 0..500. */
  gapWidth: number;
  /** Render-effective Excel overlap, clamped to -100..100. */
  overlap: number;
  /** Whether the source gap width was outside Excel's render range. */
  gapWidthClamped?: boolean;
  /** Whether the source overlap was outside Excel's render range. */
  overlapClamped?: boolean;
  /** Stable series indices owned by this geometry group when known. */
  seriesIndices?: number[];
  /** Render order for clustered series slots within one category. */
  seriesSlotOrder?: BarSeriesSlotOrder;
}

/**
 * Chart configuration options.
 */
export interface ConfigSpec {
  /** Stack mode for bar/area charts */
  stack?: StackMode;
  /** Excel blank-cell plotting mode. */
  displayBlanksAs?: 'gap' | 'zero' | 'span';
  /** Whether hidden rows/columns are excluded from chart plots. */
  plotVisibleOnly?: boolean;
  /** Excel/OOXML bar-category gap width as a percentage of one bar width */
  gapWidth?: number;
  /** Excel/OOXML intra-category series overlap percentage (-100 to 100) */
  overlap?: number;
  /** Render-normalized Excel bar/column category slot geometry. */
  barGeometry?: BarGeometrySpec;
  /** Background color */
  background?: string;
  /** Paint-aware chart frame rendered behind all chart content. */
  chartFrame?: ChartFrameSpec;
  /** Paint-aware plot-area frame rendered behind data/grid content. */
  plotFrame?: ChartFrameSpec;
  /** Padding around the chart */
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** Default mark styles */
  mark?: Partial<MarkSpec>;
  /** Default axis configuration */
  axis?: Partial<AxisSpec>;
  /** Default legend configuration */
  legend?: Partial<LegendSpec>;
  /** Color scheme name */
  scheme?: string;
  /** Custom color range */
  range?: { category?: string[]; ordinal?: string[]; ramp?: string[] };
  /** Bubble scale percentage for OOXML bubble charts. */
  bubbleScale?: number;
  /** Whether OOXML bubble charts should preserve negative/zero bubbles. */
  showNegBubbles?: boolean;
  /** Whether OOXML bubble values represent symbol area or width/diameter. */
  sizeRepresents?: 'area' | 'w';
  /** Whether OOXML bubble series should use the 3D bubble flag. */
  bubble3DEffect?: boolean;
  /** Layout hints computed from imported workbook chart semantics. */
  layoutHints?: {
    leftYAxisLabelWidth?: number;
    rightYAxisLabelWidth?: number;
    /** @deprecated Use side-specific y-axis label widths. */
    yAxisLabelWidth?: number;
    bottomMargin?: number;
    /** Category tick labels are drawn next to an in-plot value-axis crossing. */
    xAxisLabelsInsidePlot?: boolean;
    /** Category tick labels are drawn next to an in-plot value-axis crossing. */
    yAxisLabelsInsidePlot?: boolean;
    manualPlotArea?: ManualLayoutSpec;
    manualTitle?: ManualLayoutSpec;
    manualLegend?: ManualLayoutSpec;
    dataTable?: {
      rowCount: number;
      height: number;
    };
  };
}

// =============================================================================
// Base Spec (shared fields for all spec variants)
// =============================================================================

/**
 * Fields shared by all chart specification variants (unit, layer).
 *
 * This is the base set of fields that appear on every spec, regardless
 * of whether it's a single-mark unit spec or a multi-mark layer spec.
 *
 * Unimplemented Vega-Lite fields (hconcat, vconcat, facet, selection, params)
 * have been intentionally removed. They can be re-added when implemented.
 */
export interface BaseSpec {
  /** Schema version */
  $schema?: string;

  /** Chart title */
  title?: string | TitleSpec;

  /** Chart description */
  description?: string;

  /** Data source */
  data?: DataSource;

  /** Data transforms */
  transform?: Transform[];

  /** Width (pixels or 'container') */
  width?: number | 'container';

  /** Height (pixels or 'container') */
  height?: number | 'container';

  /** Auto-resize mode */
  autosize?:
    | 'pad'
    | 'fit'
    | 'fit-x'
    | 'fit-y'
    | 'none'
    | {
        type?: 'pad' | 'fit' | 'fit-x' | 'fit-y' | 'none';
        contains?: 'content' | 'padding';
        resize?: boolean;
      };

  /** Configuration options */
  config?: ConfigSpec;

  /** Theme name */
  theme?: string;

  /** Scale/axis resolution for layered charts (e.g., dual-axis) */
  resolve?: {
    scale?: Partial<
      Record<'x' | 'y' | 'color' | 'size' | 'opacity' | 'shape', 'shared' | 'independent'>
    >;
    axis?: Partial<Record<'x' | 'y', 'shared' | 'independent'>>;
  };
}

// =============================================================================
// Discriminated Spec Subtypes
// =============================================================================

/**
 * Unit specification - a single mark type with encodings.
 *
 * This is the most common spec type, representing a single chart
 * (e.g., a bar chart, line chart, scatter plot).
 *
 * The `mark` field is required conceptually but kept optional for backward
 * compatibility: many code paths build specs incrementally (e.g., base-chart
 * builders) and only set `mark` at the end via `toSpec()`.
 */
export interface UnitSpec extends BaseSpec {
  /** Mark type or specification */
  mark?: MarkType | MarkSpec;

  /** Visual encodings */
  encoding?: EncodingSpec;

  /** Layered composition - present only on LayerSpec, optional here for union compatibility */
  layer?: ChartSpec[];
}

/**
 * Layer specification - multiple marks overlaid.
 *
 * Used for combo charts (bar + line), annotations, and complex visualizations.
 * The `layer` field is required (non-optional) in a LayerSpec.
 *
 * A LayerSpec can also carry `encoding` for shared encodings inherited by
 * all layers (e.g., a shared x-axis encoding applied to all layer items).
 */
export interface LayerSpec extends BaseSpec {
  /** Layered composition (multiple marks overlaid) */
  layer: ChartSpec[];

  /** Shared encoding inherited by all layers */
  encoding?: EncodingSpec;

  /** Mark type - present only on UnitSpec, optional here for union compatibility */
  mark?: MarkType | MarkSpec;
}

// =============================================================================
// Main ChartSpec Type
// =============================================================================

/**
 * Complete chart specification - either a unit spec or a layer spec.
 *
 * This is the primary type used throughout the codebase. It is a union of
 * UnitSpec and LayerSpec, so all shared fields from BaseSpec are available
 * on both variants, plus variant-specific fields (mark/encoding for unit,
 * layer for layer specs).
 *
 * Use the `isLayerSpec()` and `isUnitSpec()` type guards to narrow.
 */
export type ChartSpec = UnitSpec | LayerSpec;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a ChartSpec is a LayerSpec (has a `layer` array).
 */
export function isLayerSpec(spec: ChartSpec): spec is LayerSpec {
  return 'layer' in spec && Array.isArray((spec as LayerSpec).layer);
}

/**
 * Check if a ChartSpec is a UnitSpec (no `layer` array).
 * All ChartSpecs without a layer array are considered unit specs.
 */
export function isUnitSpec(spec: ChartSpec): spec is UnitSpec {
  return !isLayerSpec(spec);
}

// =============================================================================
// Layout Types (Used by compiler)
// =============================================================================

/**
 * Computed layout dimensions for rendering.
 */
export interface Layout {
  /** Total width */
  width: number;
  /** Total height */
  height: number;
  /** Plot area bounds */
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Margin around plot area */
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Title area (if present) */
  title?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Legend area (if present) */
  legend?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Data table area (if present) */
  dataTable?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// =============================================================================
// Export Convenience Types
// =============================================================================

/**
 * Builder result - the ChartSpec that can be compiled.
 */
export type ChartBuilderResult = ChartSpec;

/**
 * Helper type for extracting field names from data.
 */
export type FieldName<T> = T extends DataRow ? keyof T & string : string;
