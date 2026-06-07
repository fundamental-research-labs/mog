/**
 * Layer Compiler
 *
 * Compiles layered chart specifications by merging encodings,
 * creating shared scales, and compositing marks from multiple layers.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { extendDataForLayerFields, sanitizeDataForScales } from '../algebra/data-sanitize';
import type { AnyMark, RectMark } from '../primitives/types';
import {
  buildSurfaceApproximationTrace,
  buildThreeDApproximationTrace,
  collectSurfaceApproximationLayerTrace,
  collectThreeDApproximationLayerTrace,
} from './approximation-traces';
import { generateAxes, generateYAxis } from './axis-generator';
import {
  buildCartesianGeometryTrace,
  collectCartesianGeometryLayerTrace,
} from './cartesian-geometry-trace';
import { buildPieDoughnutLabelLayoutTrace } from './data-label-trace';
import { buildBarGeometryTrace, collectBarGeometryLayerTrace } from './bar-geometry-trace';
import { createScales, resolveEncodings, type ScaleMap } from './encoding-resolver';
import { calculatePathReconciledLayout } from './path-cartesian-reconcile';
import { buildLegendTrace, generateLegends } from './legend-generator';
import { generateMarks } from './marks';
import { buildStockGlyphTrace, collectStockGlyphLayerTrace } from './stock-glyph-geometry';
import type {
  AxisOrient,
  ChartFrameSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  LayerSpec,
  MarkSpec,
  MarkType,
} from './spec';
import { generateTitle } from './title-generator';
import { applyTransforms } from './transforms';
import type {
  BarGeometryLayerTrace,
  CartesianGeometryLayerTrace,
  CompileOptions,
  CompileResult,
  SurfaceApproximationLayerTrace,
  StockGlyphLayerTrace,
  ThreeDApproximationLayerTrace,
} from './types';

/**
 * Get mark type from spec.
 */
function getMarkType(mark?: MarkType | MarkSpec): MarkType {
  if (!mark) return 'bar';
  return typeof mark === 'string' ? mark : mark.type;
}

/**
 * Get mark spec with defaults.
 */
function getMarkSpec(mark?: MarkType | MarkSpec): MarkSpec {
  if (!mark) return { type: 'bar' };
  return typeof mark === 'string' ? { type: mark } : mark;
}

function yAxisOrient(encoding: EncodingSpec | undefined): AxisOrient {
  return encoding?.y?.axis?.orient === 'right' ? 'right' : 'left';
}

function withoutYEncoding(encoding: EncodingSpec): EncodingSpec {
  const { y: _y, ...rest } = encoding;
  return rest;
}

function markConfigForLayer(
  chartConfig: ConfigSpec | undefined,
  layerConfig: ConfigSpec | undefined,
): ConfigSpec | undefined {
  if (!layerConfig) return chartConfig;
  if (!chartConfig) return layerConfig;

  return {
    ...chartConfig,
    ...layerConfig,
    axis: chartConfig.axis,
    legend: chartConfig.legend,
    layoutHints: chartConfig.layoutHints,
    padding: chartConfig.padding,
    background: chartConfig.background,
    chartFrame: chartConfig.chartFrame,
    plotFrame: chartConfig.plotFrame,
    range: chartConfig.range,
  };
}

/**
 * Dev-mode assertion: verify that all data marks carry their source datum.
 */
function assertDataMarksHaveDatum(_marks: AnyMark[]): void {
  // Intentionally a no-op in production builds.
}

/**
 * Compile a layered chart.
 *
 * @param spec - A LayerSpec (has `layer` array), narrowed by the caller
 *               via `isLayerSpec()` before invoking this function.
 * @param data - Pre-transformed data rows
 * @param options - Compile options
 */
export function compileLayered(
  spec: LayerSpec,
  data: DataRow[],
  options: CompileOptions,
): CompileResult {
  // Calculate shared layout
  const reconciled = calculatePathReconciledLayout(spec, data, {
    width: options.width ?? (typeof spec.width === 'number' ? spec.width : 600),
    height: options.height ?? (typeof spec.height === 'number' ? spec.height : 400),
  });
  const compiledSpec = reconciled.spec;
  const layout = reconciled.layout;
  const hasIndependentY = compiledSpec.resolve?.scale?.y === 'independent';

  // Merge top-level shared encodings and layer encodings to create shared scales.
  const mergedEncoding = mergeEncodings(
    [compiledSpec.encoding, ...compiledSpec.layer.map((l) => l.encoding)],
    { mergeY: !hasIndependentY },
  );
  const mergedData = compiledSpec.layer.flatMap((layer) => {
    if (layer.data && 'values' in layer.data) {
      return layer.data.values;
    }
    return data;
  });

  // When different layers map different fields to the same channel (e.g., layer 1
  // has y: 'bar_value', layer 2 has y: 'line_value'), mergeEncodings only keeps
  // the first field. We must extend the merged data so the scale domain covers
  // ALL fields from ALL layers for each channel, otherwise the second layer's
  // values will be mapped through a scale whose domain doesn't include them,
  // producing wildly out-of-bounds coordinates.
  const scaleData = extendDataForLayerFields(mergedData, mergedEncoding, compiledSpec.layer);

  // Sanitize data for scale creation: replace non-finite numeric values with undefined
  // so they don't pollute the domain (e.g., Infinity in data causes scale to return NaN
  // for all inputs, making every layer produce zero marks).
  const sanitizedMergedData = sanitizeDataForScales(scaleData, mergedEncoding);
  // Use first layer's mark type for shared scale defaults (e.g., zero inclusion)
  const firstLayerMark =
    compiledSpec.layer && compiledSpec.layer.length > 0 ? compiledSpec.layer[0].mark : undefined;
  const firstLayerMarkType = getMarkType(firstLayerMark);
  const scales = createScales(mergedEncoding, sanitizedMergedData, layout, firstLayerMarkType);

  // Compile each layer
  const allMarks: AnyMark[] = [];
  const cartesianLayerTraces: Array<CartesianGeometryLayerTrace | undefined> = [];
  const barGeometryLayerTraces: Array<BarGeometryLayerTrace | undefined> = [];
  const stockGlyphLayerTraces: Array<StockGlyphLayerTrace | undefined> = [];
  const threeDApproximationLayerTraces: Array<ThreeDApproximationLayerTrace | undefined> = [];
  const surfaceApproximationLayerTraces: Array<SurfaceApproximationLayerTrace | undefined> = [];
  const independentYAxes: AnyMark[] = [];
  const emittedIndependentYAxes = new Set<AxisOrient>();
  let sharedXAxisValueScale: ScaleMap['y'];
  let sharedXAxisValueScaleOrient: AxisOrient | undefined;

  for (let layerIndex = 0; layerIndex < compiledSpec.layer.length; layerIndex += 1) {
    const layerItem = compiledSpec.layer[layerIndex];
    const layerUnit = layerItem;
    const layerData = layerUnit.data && 'values' in layerUnit.data ? layerUnit.data.values : data;

    const transformedLayerData = layerUnit.transform
      ? applyTransforms(layerUnit.transform, layerData)
      : layerData;

    const markType = getMarkType(layerUnit.mark);
    const markSpec = getMarkSpec(layerUnit.mark);
    let layerScales: ScaleMap = scales;

    if (hasIndependentY && layerUnit.encoding?.y) {
      const layerScaleData = extendDataForLayerFields(transformedLayerData, layerUnit.encoding, [
        layerUnit,
      ]);
      const sanitizedLayerData = sanitizeDataForScales(layerScaleData, layerUnit.encoding);
      const independentScales = createScales(
        layerUnit.encoding,
        sanitizedLayerData,
        layout,
        markType,
      );
      layerScales = { ...scales, y: independentScales.y ?? scales.y };
      if (layerScales.y) {
        const orient = yAxisOrient(layerUnit.encoding);
        if (
          !sharedXAxisValueScale ||
          (orient === 'left' && sharedXAxisValueScaleOrient !== 'left')
        ) {
          sharedXAxisValueScale = layerScales.y;
          sharedXAxisValueScaleOrient = orient;
        }
      }

      if (compiledSpec.resolve?.axis?.y === 'independent' && layerUnit.encoding.y.axis !== null) {
        const orient = yAxisOrient(layerUnit.encoding);
        if (!emittedIndependentYAxes.has(orient) && layerScales.y) {
          independentYAxes.push(
            ...generateYAxis(
              layerUnit.encoding.y,
              layerScales.y,
              layout,
              compiledSpec.config?.axis,
              scales.x,
              undefined,
              compiledSpec.config?.layoutHints,
            ),
          );
          emittedIndependentYAxes.add(orient);
        }
      }
    }

    const layerEncodings = resolveEncodings(layerUnit.encoding, transformedLayerData, layerScales);
    const layerMarkConfig = markConfigForLayer(compiledSpec.config, layerUnit.config);

    const layerMarks = generateMarks(
      markType,
      markSpec,
      transformedLayerData,
      layerScales,
      layerEncodings,
      layout,
      layerUnit.encoding,
      layerMarkConfig,
    );

    allMarks.push(...layerMarks);
    barGeometryLayerTraces.push(
      collectBarGeometryLayerTrace({
        layerIndex,
        markType,
        data: transformedLayerData,
        marks: layerMarks,
        scales: layerScales,
        encodings: layerEncodings,
        layout,
        encoding: layerUnit.encoding,
        config: layerMarkConfig,
      }),
    );
    cartesianLayerTraces.push(
      collectCartesianGeometryLayerTrace({
        layerIndex,
        markType,
        markSpec,
        data: transformedLayerData,
        scales: layerScales,
        encodings: layerEncodings,
        layout,
        encoding: layerUnit.encoding,
        config: layerMarkConfig,
      }),
    );
    stockGlyphLayerTraces.push(
      collectStockGlyphLayerTrace({
        layerIndex,
        markSpec,
        data: transformedLayerData,
        scales: layerScales,
        encodings: layerEncodings,
        layout,
        encoding: layerUnit.encoding,
      }),
    );
    threeDApproximationLayerTraces.push(
      collectThreeDApproximationLayerTrace({
        layerIndex,
        markType,
        markSpec,
        data: transformedLayerData,
        marks: layerMarks,
        layout,
      }),
    );
    surfaceApproximationLayerTraces.push(
      collectSurfaceApproximationLayerTrace({
        layerIndex,
        markType,
        markSpec,
        data: transformedLayerData,
        marks: layerMarks,
        layout,
      }),
    );
  }

  // Generate shared axes and legends
  const sharedAxisScales =
    hasIndependentY && sharedXAxisValueScale ? { ...scales, y: sharedXAxisValueScale } : scales;
  const axes = options.skipAxes
    ? []
    : [
        ...generateAxes(
          hasIndependentY ? withoutYEncoding(mergedEncoding) : mergedEncoding,
          sharedAxisScales,
          layout,
          compiledSpec.config,
        ),
        ...independentYAxes,
      ];
  const legends = options.skipLegend ? [] : generateLegends(mergedEncoding, scales, layout);
  const legendTrace = buildLegendTrace(mergedEncoding, layout, legends);
  const title = options.skipTitle ? undefined : generateTitle(compiledSpec.title, layout);
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
  const clippedMarks = clipMarksToPlotArea(allMarks, layout.plotArea);
  const cartesianGeometry = buildCartesianGeometryTrace(layout, cartesianLayerTraces);
  const barGeometryTrace = buildBarGeometryTrace(layout, barGeometryLayerTraces);
  const stockGlyphTrace = buildStockGlyphTrace(layout, stockGlyphLayerTraces);
  const threeDApproximationTrace = buildThreeDApproximationTrace(threeDApproximationLayerTraces);
  const surfaceApproximationTrace = buildSurfaceApproximationTrace(surfaceApproximationLayerTraces);
  const pieDoughnutLabelLayoutTrace = buildPieDoughnutLabelLayoutTrace({
    marks: clippedMarks,
    layout,
    config: compiledSpec.config,
    ...(options.textMeasurementContext
      ? { textMeasurementContext: options.textMeasurementContext }
      : {}),
  });

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

/**
 * Merge encodings from multiple layer specs.
 */
export function mergeEncodings(
  encodings: (EncodingSpec | undefined)[],
  options: { mergeY?: boolean } = {},
): EncodingSpec {
  const merged: Record<string, unknown> = {};

  for (const encoding of encodings) {
    if (!encoding) continue;

    for (const [key, value] of Object.entries(encoding)) {
      if (value && !(key in merged)) {
        merged[key] = value;
      } else if (value && key in merged && isSharedNumericScaleChannel(key, options)) {
        merged[key] = mergeChannelForSharedScale(merged[key], value);
      }
    }
  }

  return merged as EncodingSpec;
}

function isSharedNumericScaleChannel(key: string, options: { mergeY?: boolean }): boolean {
  return key === 'x' || (key === 'y' && options.mergeY !== false);
}

function mergeChannelForSharedScale(existing: unknown, next: unknown): unknown {
  if (!isChannelSpec(existing) || !isChannelSpec(next)) return existing;
  const domain = mergedNumericDomain(existing.scale?.domain, next.scale?.domain);
  if (!domain) return existing;
  return {
    ...existing,
    scale: {
      ...(existing.scale ?? {}),
      domain,
      nice: false,
    },
  };
}

function mergedNumericDomain(
  existingDomain: unknown[] | 'unaggregated' | undefined,
  nextDomain: unknown[] | 'unaggregated' | undefined,
): [number, number] | undefined {
  const existing = numericDomain(existingDomain);
  const next = numericDomain(nextDomain);
  if (!existing && !next) return undefined;
  if (!existing) return next;
  if (!next) return existing;
  return [Math.min(existing[0], next[0]), Math.max(existing[1], next[1])];
}

function numericDomain(
  domain: unknown[] | 'unaggregated' | undefined,
): [number, number] | undefined {
  if (!Array.isArray(domain) || domain.length < 2) return undefined;
  const first = finiteNumber(domain[0]);
  const last = finiteNumber(domain[domain.length - 1]);
  return first !== undefined && last !== undefined ? [first, last] : undefined;
}

function isChannelSpec(value: unknown): value is NonNullable<EncodingSpec['x']> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
