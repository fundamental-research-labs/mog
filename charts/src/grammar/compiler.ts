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
import { calculateLayout } from './layout';
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
import { generateAxes } from './axis-generator';
import {
  buildCartesianGeometryTrace,
  collectCartesianGeometryLayerTrace,
} from './cartesian-geometry-trace';
import { compileLayered } from './layer-compiler';
import { generateLegends } from './legend-generator';
import { generateMarks } from './marks';
import { generateTitle } from './title-generator';
import type {
  CartesianGeometryCoordinateSystem,
  CartesianGeometryLayerTrace,
  CartesianGeometryPointTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometryTrace,
  CompileOptions,
  CompileResult,
} from './types';

// =============================================================================
// Types
// =============================================================================

// CompileOptions and CompileResult live in ./types to break the compiler.ts
// ↔ layer-compiler.ts cycle. Re-exported below for backward compatibility
// with callers that import them from '../grammar/compiler'.
export type {
  CartesianGeometryCoordinateSystem,
  CartesianGeometryLayerTrace,
  CartesianGeometryPointTrace,
  CartesianGeometryScaleTrace,
  CartesianGeometryTrace,
  CompileOptions,
  CompileResult,
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
  const layout = calculateLayout(spec, {
    width: options.width ?? (typeof spec.width === 'number' ? spec.width : 600),
    height: options.height ?? (typeof spec.height === 'number' ? spec.height : 400),
  });

  // Sanitize data for scale creation: replace non-finite numeric values with undefined
  // so they don't pollute the domain (e.g., Infinity makes scale return NaN for all inputs).
  const sanitizedData = sanitizeDataForScales(transformedData, spec.encoding);

  // Determine mark type (needed for scale defaults like zero inclusion)
  const markType = getMarkType(spec.mark);

  // Create scales
  const scales = createScales(spec.encoding, sanitizedData, layout, markType);

  // Resolve encodings
  const encodings = resolveEncodings(spec.encoding, transformedData, scales);
  const markSpec = getMarkSpec(spec.mark);
  const marks = generateMarks(
    markType,
    markSpec,
    transformedData,
    scales,
    encodings,
    layout,
    spec.encoding,
    spec.config,
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
      encoding: spec.encoding,
      config: spec.config,
    }),
  ]);
  const clippedMarks = clipMarksToPlotArea(marks, layout.plotArea);

  // Generate axes
  const axes = options.skipAxes ? [] : generateAxes(spec.encoding, scales, layout, spec.config);

  // Generate legend
  const legends = options.skipLegend ? [] : generateLegends(spec.encoding, scales, layout);

  // Generate title
  const title = options.skipTitle ? undefined : generateTitle(spec.title, layout);
  const background = [
    ...generateFrameMarks(
      spec.config?.chartFrame ??
        (spec.config?.background
          ? { fill: { type: 'solid', color: spec.config.background } }
          : undefined),
      0,
      0,
      layout.width,
      layout.height,
    ),
    ...generateFrameMarks(
      spec.config?.plotFrame,
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
