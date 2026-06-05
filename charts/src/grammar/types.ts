/**
 * Shared types for the grammar compiler pipeline.
 *
 * Extracted from compiler.ts to break the cycle:
 *   compiler.ts -> layer-compiler.ts -> compiler.ts (for CompileOptions/CompileResult)
 *
 * Both compiler.ts and layer-compiler.ts import these shared types from here,
 * and compiler.ts re-exports them for backward compatibility with callers that
 * import CompileOptions / CompileResult from '../grammar/compiler'.
 */

import type { AnyMark } from '../primitives/types';
import type { ScaleMap } from './encoding-resolver';
import type {
  AreaSurfaceExtentPolicy,
  AreaSurfaceExtentStatus,
  AxisLayoutStatus,
  AxisOrient,
  AxisTickSkipSource,
  FieldType,
  Layout,
  MarkType,
  PathOrder,
  Plot3DSpec,
  StockGlyphSubType,
  StockGlyphHighLowEndpointPolicySpec,
  StockGlyphVisualContractStatus,
  StockGlyphVisualSpec,
  SurfaceView3DSpec,
  StockGlyphVolumeAxisPolicy,
} from './spec';

export type CartesianGeometryCoordinateSystem = 'chartPixel';
export type CartesianGeometryLayerRole = 'linePath' | 'marker' | 'areaFill' | 'bubble';
export type CartesianGeometrySizeAuthority = 'bubbleSize' | 'markerStyle' | 'fixedMarkSize';
export type CartesianAreaSurfaceStyleStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'missing';

export interface CartesianAreaSurfaceStyleTrace {
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
  styleStatus: CartesianAreaSurfaceStyleStatus;
  styleStatusReason?: string;
}

export interface CartesianAreaSurfaceExtentTrace {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  segmentIndex: number;
  pointCount: number;
  policy: AreaSurfaceExtentPolicy;
  firstPointX: number;
  lastPointX: number;
  leftCapX: number;
  rightCapX: number;
  firstPointPlotX: number;
  lastPointPlotX: number;
  leftCapPlotX: number;
  rightCapPlotX: number;
  clippingPolicy: 'clipToPlotBounds';
  extentStatus: AreaSurfaceExtentStatus;
  extentStatusReason?: string;
}

export interface CartesianGeometryScaleTrace {
  field?: string;
  type?: FieldType;
  axisOrient?: AxisOrient;
  domain?: Array<string | number | null>;
  range?: [number, number];
  tickValues?: Array<string | number | null>;
  tickStep?: number;
  crossing?: CartesianAxisCrossingTrace;
  pathAxisLayout?: CartesianPathAxisLayoutTrace;
}

export type CartesianAxisCrossingPeerScaleKind = 'quantitative' | 'categoryPoint' | 'dateSerial';
export type CartesianAxisCrossingEffectiveMode =
  | 'automaticValue'
  | 'min'
  | 'max'
  | 'customValue'
  | 'categoryEdge'
  | 'categoryCenter'
  | 'defaultEdge';

export interface CartesianAxisCrossingTrace {
  axisRole: 'x' | 'y';
  axisOrient: AxisOrient;
  peerScaleKind: CartesianAxisCrossingPeerScaleKind;
  effectiveMode: CartesianAxisCrossingEffectiveMode;
  renderedPixel: number;
  renderedPlotPosition: number;
  sourceCrossing?: 'automatic' | 'min' | 'max' | 'custom';
  sourceCrossingValue?: number;
  sourceCategoryCrossing?: 'between' | 'midCat';
  categoryCrossingApplication?: 'applied' | 'notApplicableQuantitativePeer';
}

export interface CartesianPathAxisLayoutTrace {
  categoryTickLabelSkip?: number;
  categoryTickMarkSkip?: number;
  categoryTickSkipSource?: AxisTickSkipSource;
  axisLength?: number;
  categoryPitch?: number;
  labelBudget?: number;
  projectedLabelWidth?: number;
  visibleLabelCount?: number;
  axisLayoutStatus?: AxisLayoutStatus;
  axisLayoutStatusReason?: string;
  categoryAxisLayoutStatus?: AxisLayoutStatus;
  categoryAxisLayoutStatusReason?: string;
  valueAxisLayoutStatus?: AxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  reservationStatus?: AxisLayoutStatus;
  reservationStatusReason?: string;
}

export interface CartesianGeometryPointTrace {
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

export interface CartesianGeometryLayerTrace {
  layerIndex: number;
  markType: MarkType;
  layerRole?: CartesianGeometryLayerRole;
  sizeAuthority?: CartesianGeometrySizeAuthority;
  pathOrder?: PathOrder;
  xField?: string;
  yField?: string;
  sizeField?: string;
  xScale?: CartesianGeometryScaleTrace;
  yScale?: CartesianGeometryScaleTrace;
  sizeScale?: CartesianGeometryScaleTrace;
  points: CartesianGeometryPointTrace[];
  areaSurfaceStyles?: CartesianAreaSurfaceStyleTrace[];
  areaSurfaceExtents?: CartesianAreaSurfaceExtentTrace[];
  area?: {
    baselinePixel?: number;
    baselinePlotY?: number;
  };
}

export interface CartesianGeometryTrace {
  coordinateSystem: CartesianGeometryCoordinateSystem;
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layers: CartesianGeometryLayerTrace[];
}

export type BarGeometryCoordinateSystem = 'chartPixel';
export type BarGeometryTraceStatus = 'available' | 'mismatch' | 'unavailable';
export type BarGeometryClippingPolicy = 'preClipRectWithPlotAreaClip';

export interface BarRectangleTrace {
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
  clippingPolicy: BarGeometryClippingPolicy;
  baselinePixel?: number;
  categorySlotIndex?: number;
  slotOffset?: number;
  stackSign?: 'positive' | 'negative';
  stackCumulativeStart?: number;
  stackCumulativeEnd?: number;
}

export interface BarGeometryGroupTrace {
  groupKey: string;
  seriesIndices: number[];
  axisGroup?: 'primary' | 'secondary';
  memberCount: number;
  categoryCount: number;
  categoryAxisLength: number;
  categoryPitch: number;
  barSize: number;
  offsets: Array<{
    seriesIndex: number;
    offset: number;
  }>;
  baselinePixel?: number;
  traceStatus: BarGeometryTraceStatus;
  traceStatusReason?: string;
  rectangleCount: number;
  rectangles: BarRectangleTrace[];
}

export interface BarGeometryLayerTrace {
  layerIndex: number;
  markType: 'bar';
  orientation: 'horizontal' | 'vertical';
  grouping: 'standard' | 'clustered' | 'stacked' | 'percentStacked';
  categoryAxisRole?: 'x' | 'y';
  valueAxisRole?: 'x' | 'y';
  categoryField?: string;
  valueField?: string;
  categoryDomain: Array<string | number | null>;
  categoryScale?: {
    range?: [number, number];
    step?: number;
    bandwidth?: number;
  };
  valueScale?: {
    range?: [number, number];
  };
  stackMode?: 'zero' | 'center' | 'normalize';
  groups: BarGeometryGroupTrace[];
}

export interface BarGeometryTrace {
  schemaVersion: 1;
  coordinateSystem: BarGeometryCoordinateSystem;
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layers: BarGeometryLayerTrace[];
}

export type StockGlyphCoordinateSystem = 'chartPixel';
export type StockGlyphXMode = 'categoryPoint' | 'dateSerial' | 'quantitative';
export type StockGlyphDirection = 'up' | 'down' | 'flat' | 'unknown';
export type StockGlyphSegmentRole = 'highLowStem' | 'openTick' | 'closeTick';

export interface StockGlyphScaleTrace {
  field?: string;
  type?: FieldType;
  domain?: Array<string | number | null>;
  range?: [number, number];
  tickValues?: Array<string | number | null>;
  tickStep?: number;
  scaleAuthorityStatus?: StockGlyphVisualContractStatus;
  scaleAuthority?: string;
  scaleAuthorityReason?: string;
  zeroBaselinePolicy?: string;
  zeroBaselineReason?: string;
}

export interface StockGlyphSurfaceTrace {
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

export interface StockGlyphSegmentTrace {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  plotX1: number;
  plotY1: number;
  plotX2: number;
  plotY2: number;
  role: StockGlyphSegmentRole;
}

export interface StockGlyphVolumeRectTrace extends StockGlyphSurfaceTrace {
  value: number;
  role: 'volumeBar';
}

export interface StockGlyphBodyRectTrace extends StockGlyphSurfaceTrace {
  openValue: number;
  closeValue: number;
  role: 'body';
  direction: StockGlyphDirection;
}

export interface StockGlyphPointTrace {
  pointIndex: number;
  category: string | number | null;
  xPixel: number;
  plotX: number;
  highPixel: number;
  lowPixel: number;
  openPixel?: number;
  closePixel?: number;
  direction: StockGlyphDirection;
  stem: StockGlyphSegmentTrace;
  openTick?: StockGlyphSegmentTrace;
  closeTick?: StockGlyphSegmentTrace;
  bodyRect?: StockGlyphBodyRectTrace;
  volumeRect?: StockGlyphVolumeRectTrace;
}

export interface StockGlyphLayerTrace {
  layerIndex: number;
  markType: 'stockGlyph';
  subType: StockGlyphSubType;
  xMode: StockGlyphXMode;
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
  priceScale?: StockGlyphScaleTrace;
  volumeScale?: StockGlyphScaleTrace;
  volumeAxisPolicy?: StockGlyphVolumeAxisPolicy;
  highLowEndpointPolicy?: StockGlyphHighLowEndpointPolicySpec;
  volumeSurface?: StockGlyphSurfaceTrace;
  visual?: StockGlyphVisualSpec;
  points: StockGlyphPointTrace[];
}

export interface StockGlyphTrace {
  coordinateSystem: StockGlyphCoordinateSystem;
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  subType: StockGlyphSubType;
  xMode: StockGlyphXMode;
  renderedPointCount: number;
  categoryPitch: number;
  glyphWidth: number;
  gapWidth?: number;
  slotOccupancy?: number;
  tickLength: number;
  volumeBarWidth?: number;
  priceScale?: StockGlyphScaleTrace;
  volumeScale?: StockGlyphScaleTrace;
  volumeAxisPolicy?: StockGlyphVolumeAxisPolicy;
  highLowEndpointPolicy?: StockGlyphHighLowEndpointPolicySpec;
  volumeSurface?: StockGlyphSurfaceTrace;
  visual?: StockGlyphVisualSpec;
  layers: StockGlyphLayerTrace[];
  points: StockGlyphPointTrace[];
}

export interface LegendTrace {
  renderedPresent: boolean;
  renderedVisible: boolean;
  generatedMarkCount: number;
  sourceChannels: string[];
  flow?: LegendFlowTrace;
  renderedEntries?: Array<{
    value: unknown;
    label: string;
    symbolType?: string;
    seriesIndex?: number;
    sourceSeriesIndex?: number;
    sourceSeriesKey?: string;
    pointIndex?: number;
    pointKey?: string;
    legendKey?: string;
    colorKey?: string;
    stockRole?: string;
  }>;
  chartWidth: number;
  chartHeight: number;
  area?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type LegendFlowTraceOrient = 'horizontal' | 'vertical';
export type LegendFlowTraceOverflowPolicy = 'none' | 'overflowVisible';

export interface LegendFlowEntryBoundsTrace {
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

export interface LegendFlowTrace {
  orient: LegendFlowTraceOrient;
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
  overflowPolicy: LegendFlowTraceOverflowPolicy;
  entries: LegendFlowEntryBoundsTrace[];
}

export type TextMeasurementAuthority = 'canvasMeasureText' | 'estimated';
export type TextMeasurementContext = CanvasRenderingContext2D;

export interface PieDoughnutLabelLayoutTraceEntry {
  seriesIndex: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex: number;
  pointKey?: string;
  ringIndex?: number;
  text: string;
  position?: string;
  labelX: number;
  labelY: number;
  anchor: {
    x: number;
    y: number;
  };
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  maxWidth?: number;
  font: {
    family: string;
    size: number;
    weight?: string | number;
    style?: string;
  };
  lineHeight?: number;
  leaderVisible: boolean;
  zeroValue: boolean;
  nearZeroValue: boolean;
  layoutTarget?: 'inner' | 'outer';
  coordinateSystem: 'chartPixel';
  measurementAuthority: TextMeasurementAuthority;
}

export interface PieDoughnutLabelLayoutTrace {
  schemaVersion: 1;
  coordinateSystem: 'chartPixel';
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  family: 'pie' | 'doughnut';
  labels: PieDoughnutLabelLayoutTraceEntry[];
}

export type ThreeDApproximationMarkType = 'bar3d' | 'line3d' | 'area3d' | 'arc3d';
export type ThreeDApproximationRenderer = 'pathDepthApproximation';
export type ThreeDApproximationDepthSource = 'view3dDepthPercent' | 'gapDepth' | 'default';
export type ThreeDApproximationDepthClampStatus = 'withinRange' | 'clampedMin' | 'clampedMax';
export type ThreeDApproximationGeometryStatus = 'approximate' | 'traceMissing' | 'notApplicable';
export type ThreeDApproximationFaceRole =
  | 'front'
  | 'back'
  | 'top'
  | 'side'
  | 'connector'
  | 'outer'
  | 'inner';

export type ThreeDBarShape = NonNullable<Plot3DSpec['barShape']>;

export interface ThreeDApproximationFaceCountsTrace {
  front: number;
  back: number;
  top: number;
  side: number;
  connector: number;
  outer: number;
  inner: number;
}

export interface ThreeDApproximationBarShapesTrace {
  chartShape?: ThreeDBarShape;
  seriesShapes?: Array<{
    seriesIndex?: number;
    sourceSeriesIndex?: number;
    sourceSeriesKey?: string;
    shape: ThreeDBarShape;
  }>;
  distinctShapes: ThreeDBarShape[];
}

export type ProjectionTraceCoordinateSpace = 'chartNormalized' | 'plotAreaNormalized';
export type ProjectionOccupancyTraceSource = 'generatedMarkBounds' | 'generatedPathBounds';

export interface ProjectionBoundsTrace {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  areaFraction: number;
  coordinateSpace: ProjectionTraceCoordinateSpace;
}

export interface ProjectionOccupancyTrace {
  columns: number;
  rows: number;
  densities: number[];
  source: ProjectionOccupancyTraceSource;
}

export interface ThreeDApproximationProjectionTrace {
  projectionAuthority: 'generatedApproximationTrace';
  allFaceBounds?: ProjectionBoundsTrace;
  frontFaceBounds?: ProjectionBoundsTrace;
  depthFaceBounds?: ProjectionBoundsTrace;
  faceFamilyOccupancy?: ProjectionOccupancyTrace;
}

export interface ThreeDApproximationLayerTrace {
  layerIndex: number;
  renderer: ThreeDApproximationRenderer;
  markType: ThreeDApproximationMarkType;
  markFamily?: Plot3DSpec['family'];
  sourceFamily?: string;
  renderedMarkType: ThreeDApproximationMarkType;
  view3d?: SurfaceView3DSpec;
  gapDepth?: number;
  depthSource: ThreeDApproximationDepthSource;
  depthVector: {
    x: number;
    y: number;
  };
  depthClampStatus: ThreeDApproximationDepthClampStatus;
  barShapes?: ThreeDApproximationBarShapesTrace;
  sourceSeriesCount: number;
  sourcePointCount: number;
  renderablePointCount: number;
  markCount: number;
  faceCounts: ThreeDApproximationFaceCountsTrace;
  projection?: ThreeDApproximationProjectionTrace;
  geometryStatus: ThreeDApproximationGeometryStatus;
}

export interface ThreeDApproximationTrace {
  schemaVersion: 1;
  renderer: ThreeDApproximationRenderer;
  layers: ThreeDApproximationLayerTrace[];
  markCount: number;
  faceCounts: ThreeDApproximationFaceCountsTrace;
  projection?: ThreeDApproximationProjectionTrace;
  geometryStatus: ThreeDApproximationGeometryStatus;
}

export type SurfaceApproximationRenderer = 'mogSurfaceApproximation' | 'mogContourApproximation';
export type SurfaceApproximationMode = 'surface3d' | 'contour';
export type SurfaceApproximationContractKind =
  | 'surface3dFilled'
  | 'surface3dWireframe'
  | 'contourFilled'
  | 'contourWireframe';
export type SurfaceApproximationGeometryStatus = 'approximate' | 'traceMissing' | 'notApplicable';
export type SurfaceApproximationGridSource = 'seriesPointIndexGrid' | 'unavailable';
export type SurfaceApproximationBandAuthority =
  | 'generatedFromAxisAndData'
  | 'fallback'
  | 'sourceBandFmtPreservedOnly';
export type SurfaceApproximationPlotAreaPolicy = 'squareTopView' | 'normalizedProjectedCube';

export interface SurfaceApproximationGridTrace {
  rows: number;
  columns: number;
  finiteValueCount: number;
  missingCellCount: number;
  source: SurfaceApproximationGridSource;
}

export interface SurfaceApproximationValueDomainTrace {
  dataMin?: number;
  dataMax?: number;
  axisMin?: number;
  axisMax?: number;
  axisMajorUnit?: number;
}

export interface SurfaceApproximationBandTrace {
  index: number;
  min: number;
  max: number;
  label: string;
  color: string;
}

export interface SurfaceApproximationSourceBandFormatTrace {
  index: number;
  fillColor?: string;
  hasFormatting: boolean;
  source?: 'ooxmlBandFmt';
}

export interface SurfaceApproximationBandsTrace {
  count: number;
  entries: SurfaceApproximationBandTrace[];
  legendOrder: string[];
  authority: SurfaceApproximationBandAuthority;
  sourceBandFormats?: SurfaceApproximationSourceBandFormatTrace[];
}

export interface SurfaceApproximationMarkCountsTrace {
  filledPatches: number;
  isolineSegments: number;
  wireSegments: number;
  frameMarks: number;
  totalDataMarks: number;
}

export interface SurfaceApproximationDensityTrace {
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

export interface SurfaceApproximationProjectionTrace {
  projectionAuthority: 'generatedApproximationTrace';
  dataMarkBounds?: ProjectionBoundsTrace;
  frameBounds?: ProjectionBoundsTrace;
  topViewPlotBounds?: ProjectionBoundsTrace;
  dataOccupancy?: ProjectionOccupancyTrace;
}

export interface SurfaceApproximationLayerTrace {
  layerIndex: number;
  renderer: SurfaceApproximationRenderer;
  mode: SurfaceApproximationMode;
  contractKind: SurfaceApproximationContractKind;
  markType: 'surface3d' | 'contour';
  chartType?: string;
  topView: boolean;
  wireframe: boolean;
  view3d?: SurfaceView3DSpec;
  grid: SurfaceApproximationGridTrace;
  valueDomain: SurfaceApproximationValueDomainTrace;
  bands: SurfaceApproximationBandsTrace;
  markCounts: SurfaceApproximationMarkCountsTrace;
  plotAreaPolicy: SurfaceApproximationPlotAreaPolicy;
  density?: SurfaceApproximationDensityTrace;
  projection?: SurfaceApproximationProjectionTrace;
  geometryStatus: SurfaceApproximationGeometryStatus;
}

export interface SurfaceApproximationTrace {
  schemaVersion: 1;
  renderer: SurfaceApproximationRenderer;
  mode: SurfaceApproximationMode;
  contractKind: SurfaceApproximationContractKind;
  layers: SurfaceApproximationLayerTrace[];
  grid: SurfaceApproximationGridTrace;
  valueDomain: SurfaceApproximationValueDomainTrace;
  bands: SurfaceApproximationBandsTrace;
  markCounts: SurfaceApproximationMarkCountsTrace;
  plotAreaPolicy: SurfaceApproximationPlotAreaPolicy;
  density?: SurfaceApproximationDensityTrace;
  projection?: SurfaceApproximationProjectionTrace;
  geometryStatus: SurfaceApproximationGeometryStatus;
}

/**
 * Compiled chart result.
 */
export interface CompileResult {
  /** Background marks that must render before all chart content */
  background?: AnyMark[];
  /** Data marks (bars, lines, points, etc.) */
  marks: AnyMark[];
  /** Axis marks (lines, ticks, labels) */
  axes: AnyMark[];
  /** Legend marks */
  legends: AnyMark[];
  /** Title marks */
  title?: AnyMark[];
  /** Chart bounds */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Layout information */
  layout: Layout;
  /** Scales used */
  scales: ScaleMap;
  /** Compiler-derived Cartesian point geometry, when applicable */
  cartesianGeometry?: CartesianGeometryTrace;
  /** Compiler-derived 2-D bar/column rectangle evidence, when applicable. */
  barGeometryTrace?: BarGeometryTrace;
  /** Compiler-derived stock glyph geometry, when applicable */
  stockGlyphTrace?: StockGlyphTrace;
  /** Compiler-derived legend layout/mark evidence. */
  legendTrace?: LegendTrace;
  /** Compiler-derived pie/doughnut data-label layout evidence. */
  pieDoughnutLabelLayoutTrace?: PieDoughnutLabelLayoutTrace;
  /** Compiler-derived 3-D approximation evidence, when applicable. */
  threeDApproximationTrace?: ThreeDApproximationTrace;
  /** Compiler-derived surface/contour approximation evidence, when applicable. */
  surfaceApproximationTrace?: SurfaceApproximationTrace;
}

/**
 * Compilation options.
 */
export interface CompileOptions {
  /** Override chart dimensions */
  width?: number;
  height?: number;
  /** Default colors */
  colors?: string[];
  /** Skip axis generation */
  skipAxes?: boolean;
  /** Skip legend generation */
  skipLegend?: boolean;
  /** Skip title generation */
  skipTitle?: boolean;
  /** Canvas text measurement context used for renderer-equivalent label bounds. */
  textMeasurementContext?: TextMeasurementContext;
}
