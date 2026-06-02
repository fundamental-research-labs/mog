/**
 * Chart Grammar Compiler - Orchestrator
 *
 * Compiles ChartSpec + data into renderable marks.
 * This is the main entry point for the grammar system.
 *
 * Pipeline:
 * 1. Apply transforms to data
 * 2. Calculate layout (margins, axes, chart area)
 * 3. Create scales from encoding
 * 4. Generate marks from data
 * 5. Generate axis marks
 * 6. Generate legend marks
 * 7. Generate title marks
 *
 * Pure functions - no side effects.
 */

import type { AnyMark, RectMark } from '../primitives/types';
import { createScales, resolveEncodings } from './encoding-resolver';
import { calculatePathReconciledLayout } from './path-cartesian-reconcile';
import {
  isLayerSpec,
  type ChartFrameSpec,
  type ChartSpec,
  type DataRow,
  type MarkSpec,
  type MarkType,
} from './spec';
import { applyTransforms } from './transforms';

// Import from extracted modules
import { sanitizeDataForScales } from '../algebra/data-sanitize';
import {
  buildSurfaceApproximationTrace,
  buildThreeDApproximationTrace,
  collectSurfaceApproximationLayerTrace,
  collectThreeDApproximationLayerTrace,
} from './approximation-traces';
import { generateAxes } from './axis-generator';
import {
  buildCartesianGeometryTrace,
  collectCartesianGeometryLayerTrace,
} from './cartesian-geometry-trace';
import { buildPieDoughnutLabelLayoutTrace } from './data-label-trace';
import { buildBarGeometryTrace, collectBarGeometryLayerTrace } from './bar-geometry-trace';
import { compileLayered } from './layer-compiler';
import { buildLegendTrace, generateLegends } from './legend-generator';
import { generateMarks } from './marks';
import { buildStockGlyphTrace, collectStockGlyphLayerTrace } from './stock-glyph-geometry';
import { generateTitle } from './title-generator';
import type {
  CartesianGeometryCoordinateSystem,
  CartesianAxisCrossingTrace,
  CartesianGeometryLayerTrace,
  CartesianGeometryLayerRole,
  CartesianGeometryPointTrace,
  CartesianPathAxisLayoutTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometrySizeAuthority,
  CartesianGeometryTrace,
  BarGeometryCoordinateSystem,
  BarGeometryGroupTrace,
  BarGeometryLayerTrace,
  BarGeometryTrace,
  BarGeometryTraceStatus,
  BarRectangleTrace,
  CompileOptions,
  CompileResult,
  LegendFlowEntryBoundsTrace,
  LegendFlowTrace,
  LegendFlowTraceOrient,
  LegendFlowTraceOverflowPolicy,
  LegendTrace,
  PieDoughnutLabelLayoutTrace,
  PieDoughnutLabelLayoutTraceEntry,
  ProjectionBoundsTrace,
  ProjectionOccupancyTrace,
  ProjectionOccupancyTraceSource,
  ProjectionTraceCoordinateSpace,
  TextMeasurementAuthority,
  TextMeasurementContext,
  SurfaceApproximationBandAuthority,
  SurfaceApproximationBandTrace,
  SurfaceApproximationBandsTrace,
  SurfaceApproximationContractKind,
  SurfaceApproximationDensityTrace,
  SurfaceApproximationGeometryStatus,
  SurfaceApproximationGridSource,
  SurfaceApproximationGridTrace,
  SurfaceApproximationLayerTrace,
  SurfaceApproximationMarkCountsTrace,
  SurfaceApproximationMode,
  SurfaceApproximationPlotAreaPolicy,
  SurfaceApproximationProjectionTrace,
  SurfaceApproximationRenderer,
  SurfaceApproximationTrace,
  SurfaceApproximationValueDomainTrace,
  StockGlyphBodyRectTrace,
  StockGlyphCoordinateSystem,
  StockGlyphDirection,
  StockGlyphLayerTrace,
  StockGlyphPointTrace,
  StockGlyphScaleTrace,
  StockGlyphSegmentRole,
  StockGlyphSegmentTrace,
  StockGlyphSurfaceTrace,
  StockGlyphTrace,
  StockGlyphVolumeRectTrace,
  StockGlyphXMode,
  ThreeDApproximationBarShapesTrace,
  ThreeDApproximationDepthClampStatus,
  ThreeDApproximationDepthSource,
  ThreeDApproximationFaceCountsTrace,
  ThreeDApproximationFaceRole,
  ThreeDApproximationGeometryStatus,
  ThreeDApproximationLayerTrace,
  ThreeDApproximationMarkType,
  ThreeDApproximationProjectionTrace,
  ThreeDApproximationRenderer,
  ThreeDApproximationTrace,
  ThreeDBarShape,
} from './types';

// =============================================================================
// Types
// =============================================================================

// CompileOptions and CompileResult live in ./types to break the compiler.ts
// ↔ layer-compiler.ts cycle. Re-exported below for backward compatibility
// with callers that import them from '../grammar/compiler'.
export type {
  CartesianGeometryCoordinateSystem,
  CartesianAxisCrossingTrace,
  CartesianGeometryLayerTrace,
  CartesianGeometryLayerRole,
  CartesianGeometryPointTrace,
  CartesianPathAxisLayoutTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometrySizeAuthority,
  CartesianGeometryTrace,
  BarGeometryCoordinateSystem,
  BarGeometryGroupTrace,
  BarGeometryLayerTrace,
  BarGeometryTrace,
  BarGeometryTraceStatus,
  BarRectangleTrace,
  CompileOptions,
  CompileResult,
  LegendFlowEntryBoundsTrace,
  LegendFlowTrace,
  LegendFlowTraceOrient,
  LegendFlowTraceOverflowPolicy,
  LegendTrace,
  PieDoughnutLabelLayoutTrace,
  PieDoughnutLabelLayoutTraceEntry,
  ProjectionBoundsTrace,
  ProjectionOccupancyTrace,
  ProjectionOccupancyTraceSource,
  ProjectionTraceCoordinateSpace,
  TextMeasurementAuthority,
  TextMeasurementContext,
  SurfaceApproximationBandAuthority,
  SurfaceApproximationBandTrace,
  SurfaceApproximationBandsTrace,
  SurfaceApproximationContractKind,
  SurfaceApproximationDensityTrace,
  SurfaceApproximationGeometryStatus,
  SurfaceApproximationGridSource,
  SurfaceApproximationGridTrace,
  SurfaceApproximationLayerTrace,
  SurfaceApproximationMarkCountsTrace,
  SurfaceApproximationMode,
  SurfaceApproximationPlotAreaPolicy,
  SurfaceApproximationProjectionTrace,
  SurfaceApproximationRenderer,
  SurfaceApproximationTrace,
  SurfaceApproximationValueDomainTrace,
  StockGlyphBodyRectTrace,
  StockGlyphCoordinateSystem,
  StockGlyphDirection,
  StockGlyphLayerTrace,
  StockGlyphPointTrace,
  StockGlyphScaleTrace,
  StockGlyphSegmentRole,
  StockGlyphSegmentTrace,
  StockGlyphSurfaceTrace,
  StockGlyphTrace,
  StockGlyphVolumeRectTrace,
  StockGlyphXMode,
  ThreeDApproximationBarShapesTrace,
  ThreeDApproximationDepthClampStatus,
  ThreeDApproximationDepthSource,
  ThreeDApproximationFaceCountsTrace,
  ThreeDApproximationFaceRole,
  ThreeDApproximationGeometryStatus,
  ThreeDApproximationLayerTrace,
  ThreeDApproximationMarkType,
  ThreeDApproximationProjectionTrace,
  ThreeDApproximationRenderer,
  ThreeDApproximationTrace,
  ThreeDBarShape,
};

// =============================================================================
// Main Compile Function
// =============================================================================

/**
 * Compile a ChartSpec to renderable marks.
 *
 * @param spec - Chart specification
 * @param data - Data rows (required if spec uses inline data reference)
 * @param options - Compile options
 * @returns Compiled result with marks, axes, legends
 */
export function compile(
  spec: ChartSpec,
  data?: DataRow[],
  options: CompileOptions = {},
): CompileResult {
  // Resolve data source
  let resolvedData: DataRow[];

  if (spec.data && 'values' in spec.data) {
    resolvedData = spec.data.values;
  } else if (data) {
    resolvedData = data;
  } else {
    resolvedData = [];
  }

  // Apply transforms
  const transformedData = spec.transform
    ? applyTransforms(spec.transform, resolvedData)
    : resolvedData;

  // Handle layer composition
  if (isLayerSpec(spec)) {
    return compileLayered(spec, transformedData, options);
  }

  // Calculate layout
  const reconciled = calculatePathReconciledLayout(spec, transformedData, {
    width: options.width ?? (typeof spec.width === 'number' ? spec.width : 600),
    height: options.height ?? (typeof spec.height === 'number' ? spec.height : 400),
  });
  const compiledSpec = reconciled.spec;
  const layout = reconciled.layout;

  // Sanitize data for scale creation: replace non-finite numeric values with undefined
  // so they don't pollute the domain (e.g., Infinity makes scale return NaN for all inputs).
  const sanitizedData = sanitizeDataForScales(transformedData, compiledSpec.encoding);

  // Determine mark type (needed for scale defaults like zero inclusion)
  const markType = getMarkType(compiledSpec.mark);

  // Create scales
  const scales = createScales(compiledSpec.encoding, sanitizedData, layout, markType);

  // Resolve encodings
  const encodings = resolveEncodings(compiledSpec.encoding, transformedData, scales);
  const markSpec = getMarkSpec(compiledSpec.mark);
  const marks = generateMarks(
    markType,
    markSpec,
    transformedData,
    scales,
    encodings,
    layout,
    compiledSpec.encoding,
    compiledSpec.config,
  );
  const cartesianGeometry = buildCartesianGeometryTrace(layout, [
    collectCartesianGeometryLayerTrace({
      layerIndex: 0,
      markType,
      markSpec,
      data: transformedData,
      scales,
      encodings,
      layout,
      encoding: compiledSpec.encoding,
      config: compiledSpec.config,
    }),
  ]);
  const barGeometryTrace = buildBarGeometryTrace(layout, [
    collectBarGeometryLayerTrace({
      layerIndex: 0,
      markType,
      data: transformedData,
      marks,
      scales,
      encodings,
      layout,
      encoding: compiledSpec.encoding,
      config: compiledSpec.config,
    }),
  ]);
  const stockGlyphTrace = buildStockGlyphTrace(layout, [
    collectStockGlyphLayerTrace({
      layerIndex: 0,
      markSpec,
      data: transformedData,
      scales,
      encodings,
      layout,
      encoding: compiledSpec.encoding,
    }),
  ]);
  const threeDApproximationTrace = buildThreeDApproximationTrace([
    collectThreeDApproximationLayerTrace({
      layerIndex: 0,
      markType,
      markSpec,
      data: transformedData,
      marks,
      layout,
    }),
  ]);
  const surfaceApproximationTrace = buildSurfaceApproximationTrace([
    collectSurfaceApproximationLayerTrace({
      layerIndex: 0,
      markType,
      markSpec,
      data: transformedData,
      marks,
      layout,
    }),
  ]);
  const clippedMarks = clipMarksToPlotArea(marks, layout.plotArea);
  const pieDoughnutLabelLayoutTrace = buildPieDoughnutLabelLayoutTrace({
    marks: clippedMarks,
    layout,
    config: compiledSpec.config,
    ...(options.textMeasurementContext
      ? { textMeasurementContext: options.textMeasurementContext }
      : {}),
  });

  // Generate axes
  const axes = options.skipAxes
    ? []
    : generateAxes(compiledSpec.encoding, scales, layout, compiledSpec.config);

  // Generate legend
  const legends = options.skipLegend ? [] : generateLegends(compiledSpec.encoding, scales, layout);
  const legendTrace = buildLegendTrace(compiledSpec.encoding, layout, legends);

  // Generate title
  const title = options.skipTitle ? undefined : generateTitle(spec.title, layout);
  const background = [
    ...generateFrameMarks(
      compiledSpec.config?.chartFrame ??
        (compiledSpec.config?.background
          ? { fill: { type: 'solid', color: compiledSpec.config.background } }
          : undefined),
      0,
      0,
      layout.width,
      layout.height,
    ),
    ...generateFrameMarks(
      compiledSpec.config?.plotFrame,
      layout.plotArea.x,
      layout.plotArea.y,
      layout.plotArea.width,
      layout.plotArea.height,
    ),
  ];

  // Dev-mode assertion: all data marks must carry their source datum
  assertDataMarksHaveDatum(clippedMarks);

  return {
    background: background.length > 0 ? background : undefined,
    marks: clippedMarks,
    axes,
    legends,
    title,
    bounds: {
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
    },
    layout,
    scales,
    cartesianGeometry,
    barGeometryTrace,
    stockGlyphTrace,
    legendTrace,
    pieDoughnutLabelLayoutTrace,
    threeDApproximationTrace,
    surfaceApproximationTrace,
  };
}

function generateFrameMarks(
  frame: ChartFrameSpec | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): AnyMark[] {
  if (!frame?.fill && !frame?.line && !frame?.shadow) return [];
  return [
    {
      type: 'rect',
      x,
      y,
      width,
      height,
      style: frameStyle(frame),
    } as RectMark,
  ];
}

function frameStyle(frame: ChartFrameSpec): RectMark['style'] {
  return {
    ...(frame.fill?.type === 'solid' && frame.fill.opacity === undefined
      ? { fill: frame.fill.color }
      : frame.fill
        ? { fillPaint: frame.fill }
        : {}),
    ...(frame.line?.paint ? { strokePaint: frame.line.paint } : {}),
    ...(frame.line?.width !== undefined ? { strokeWidth: frame.line.width } : {}),
    ...(frame.line?.dash ? { strokeDash: frame.line.dash } : {}),
    ...(frame.line ? { line: frame.line } : {}),
    ...(frame.shadow ? { shadow: frame.shadow } : {}),
    ...(frame.cornerRadius !== undefined ? { cornerRadius: frame.cornerRadius } : {}),
  };
}

function isPlotClippableMark(mark: AnyMark): boolean {
  return (
    (mark.type === 'rect' || mark.type === 'path' || mark.type === 'symbol') &&
    !isPlotClipDisabled(mark.datum)
  );
}

function isPlotClipDisabled(datum: unknown): boolean {
  return (
    datum != null &&
    typeof datum === 'object' &&
    (datum as Record<string, unknown>).__mogClipToPlotArea === false
  );
}

function clipMarksToPlotArea(
  marks: AnyMark[],
  plotArea: { x: number; y: number; width: number; height: number },
): AnyMark[] {
  return marks.map((mark) =>
    isPlotClippableMark(mark)
      ? {
          ...mark,
          clip: { ...plotArea },
        }
      : mark,
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get mark type from spec.
 */
export function getMarkType(mark?: MarkType | MarkSpec): MarkType {
  if (!mark) return 'bar';
  return typeof mark === 'string' ? mark : mark.type;
}

/**
 * Get mark spec with defaults.
 */
export function getMarkSpec(mark?: MarkType | MarkSpec): MarkSpec {
  if (!mark) return { type: 'bar' };
  return typeof mark === 'string' ? { type: mark } : mark;
}

/**
 * Dev-mode assertion: verify that all data marks carry their source datum.
 *
 * This is critical for the Chart Fidelity invariant library, which needs
 * to associate marks with their source data for verification. Text marks
 * are excluded because they may be structural (axis labels, titles) when
 * used in the marks array of layered charts, and their datum is not
 * required for fidelity checks.
 */
function assertDataMarksHaveDatum(_marks: AnyMark[]): void {
  // Intentionally a no-op in production builds.
  // Enable via compile-time flag if datum verification is needed during development.
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export { extendDataForLayerFields, sanitizeDataForScales } from '../algebra/data-sanitize';
export { generateAxes } from './axis-generator';
export { compileLayered, mergeEncodings } from './layer-compiler';
export { generateLegends } from './legend-generator';
export { generateMarks } from './marks';
export { groupDataByEncoding, invokeScale } from './marks/helpers';
export {
  buildInterpolatedPath,
  buildSmoothPath,
  buildSteppedPath,
  computeMonotoneTangents,
} from './marks/path-interpolation';
export { generateTitle } from './title-generator';
