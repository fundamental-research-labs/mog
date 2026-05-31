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
import { generateAxes, generateYAxis } from './axis-generator';
import { createScales, resolveEncodings, type ScaleMap } from './encoding-resolver';
import { calculateLayout } from './layout';
import { generateLegends } from './legend-generator';
import { generateMarks } from './marks';
import type { AxisOrient, DataRow, EncodingSpec, LayerSpec, MarkSpec, MarkType } from './spec';
import { generateTitle } from './title-generator';
import { applyTransforms } from './transforms';
import type { CompileOptions, CompileResult } from './types';

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
  const layout = calculateLayout(spec, {
    width: options.width ?? (typeof spec.width === 'number' ? spec.width : 600),
    height: options.height ?? (typeof spec.height === 'number' ? spec.height : 400),
  });

  // Merge top-level shared encodings and layer encodings to create shared scales.
  const mergedEncoding = mergeEncodings([spec.encoding, ...spec.layer.map((l) => l.encoding)]);
  const mergedData = spec.layer.flatMap((layer) => {
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
  const scaleData = extendDataForLayerFields(mergedData, mergedEncoding, spec.layer);

  // Sanitize data for scale creation: replace non-finite numeric values with undefined
  // so they don't pollute the domain (e.g., Infinity in data causes scale to return NaN
  // for all inputs, making every layer produce zero marks).
  const sanitizedMergedData = sanitizeDataForScales(scaleData, mergedEncoding);
  // Use first layer's mark type for shared scale defaults (e.g., zero inclusion)
  const firstLayerMark = spec.layer && spec.layer.length > 0 ? spec.layer[0].mark : undefined;
  const firstLayerMarkType = getMarkType(firstLayerMark);
  const scales = createScales(mergedEncoding, sanitizedMergedData, layout, firstLayerMarkType);

  // Compile each layer
  const allMarks: AnyMark[] = [];
  const independentYAxes: AnyMark[] = [];
  const emittedIndependentYAxes = new Set<AxisOrient>();
  const hasIndependentY = spec.resolve?.scale?.y === 'independent';

  for (const layerItem of spec.layer) {
    const layerUnit = layerItem;
    const layerData = layerUnit.data && 'values' in layerUnit.data ? layerUnit.data.values : data;

    const transformedLayerData = layerUnit.transform
      ? applyTransforms(layerUnit.transform, layerData)
      : layerData;

    const markType = getMarkType(layerUnit.mark);
    const markSpec = getMarkSpec(layerUnit.mark);
    let layerScales: ScaleMap = scales;

    if (hasIndependentY && layerUnit.encoding?.y) {
      const sanitizedLayerData = sanitizeDataForScales(transformedLayerData, layerUnit.encoding);
      const independentScales = createScales(
        layerUnit.encoding,
        sanitizedLayerData,
        layout,
        markType,
      );
      layerScales = { ...scales, y: independentScales.y ?? scales.y };

      if (spec.resolve?.axis?.y === 'independent' && layerUnit.encoding.y.axis !== null) {
        const orient = yAxisOrient(layerUnit.encoding);
        if (!emittedIndependentYAxes.has(orient) && layerScales.y) {
          independentYAxes.push(
            ...generateYAxis(layerUnit.encoding.y, layerScales.y, layout, spec.config?.axis),
          );
          emittedIndependentYAxes.add(orient);
        }
      }
    }

    const layerEncodings = resolveEncodings(layerUnit.encoding, transformedLayerData, layerScales);

    const layerMarks = generateMarks(
      markType,
      markSpec,
      transformedLayerData,
      layerScales,
      layerEncodings,
      layout,
      layerUnit.encoding,
      spec.config,
    );

    allMarks.push(...layerMarks);
  }

  // Generate shared axes and legends
  const axes = options.skipAxes
    ? []
    : [
        ...generateAxes(
          hasIndependentY ? withoutYEncoding(mergedEncoding) : mergedEncoding,
          scales,
          layout,
          spec.config,
        ),
        ...independentYAxes,
      ];
  const legends = options.skipLegend ? [] : generateLegends(mergedEncoding, scales, layout);
  const title = options.skipTitle ? undefined : generateTitle(spec.title, layout);
  const background = generateBackground(spec.config?.background, layout.width, layout.height);

  // Dev-mode assertion: all data marks must carry their source datum
  const clippedMarks = clipMarksToPlotArea(allMarks, layout.plotArea);

  assertDataMarksHaveDatum(clippedMarks);

  return {
    background,
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
  };
}

function generateBackground(
  fill: string | undefined,
  width: number,
  height: number,
): AnyMark[] | undefined {
  if (!fill) return undefined;
  return [
    {
      type: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      style: { fill },
    } as RectMark,
  ];
}

function isPlotClippableMark(mark: AnyMark): boolean {
  return mark.type === 'rect' || mark.type === 'path' || mark.type === 'symbol';
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
export function mergeEncodings(encodings: (EncodingSpec | undefined)[]): EncodingSpec {
  const merged: Record<string, unknown> = {};

  for (const encoding of encodings) {
    if (!encoding) continue;

    for (const [key, value] of Object.entries(encoding)) {
      if (value && !(key in merged)) {
        merged[key] = value;
      }
    }
  }

  return merged as EncodingSpec;
}
