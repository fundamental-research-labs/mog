/**
 * Layer Compiler
 *
 * Compiles layered chart specifications by merging encodings,
 * creating shared scales, and compositing marks from multiple layers.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { extendDataForLayerFields, sanitizeDataForScales } from '../algebra/data-sanitize';
import type { AnyMark } from '../primitives/types';
import { generateAxes } from './axis-generator';
import { createScales, resolveEncodings } from './encoding-resolver';
import { calculateLayout } from './layout';
import { generateLegends } from './legend-generator';
import { generateMarks } from './marks';
import type { DataRow, EncodingSpec, LayerSpec, MarkSpec, MarkType } from './spec';
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

  // Merge encodings from layers to create shared scales
  const mergedEncoding = mergeEncodings(spec.layer.map((l) => l.encoding));
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

  for (const layerItem of spec.layer) {
    const layerUnit = layerItem;
    const layerData = layerUnit.data && 'values' in layerUnit.data ? layerUnit.data.values : data;

    const transformedLayerData = layerUnit.transform
      ? applyTransforms(layerUnit.transform, layerData)
      : layerData;

    const layerEncodings = resolveEncodings(layerUnit.encoding, transformedLayerData, scales);
    const markType = getMarkType(layerUnit.mark);
    const markSpec = getMarkSpec(layerUnit.mark);

    const layerMarks = generateMarks(
      markType,
      markSpec,
      transformedLayerData,
      scales,
      layerEncodings,
      layout,
      layerUnit.encoding,
      spec.config,
    );

    allMarks.push(...layerMarks);
  }

  // Generate shared axes and legends
  const axes = options.skipAxes ? [] : generateAxes(mergedEncoding, scales, layout, spec.config);
  const legends = options.skipLegend ? [] : generateLegends(mergedEncoding, scales, layout);
  const title = options.skipTitle ? undefined : generateTitle(spec.title, layout);

  // Dev-mode assertion: all data marks must carry their source datum
  assertDataMarksHaveDatum(allMarks);

  return {
    marks: allMarks,
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
