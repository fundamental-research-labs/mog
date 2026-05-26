/**
 * Mark Generation - Dispatcher and Re-exports
 *
 * Central entry point for all mark generators. The generateMarks function
 * dispatches to the appropriate generator based on mark type.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec, MarkType } from '../spec';
import { generateArcMarks } from './arc';
import { generateAreaMarks } from './area';
import { generateBarMarks } from './bar';
import { generateBoxPlotMarks } from './boxplot';
import { generateHistogramMarks } from './histogram';
import { generateLineMarks } from './line';
import { generatePointMarks } from './point';
import { generateRectMarks } from './rect';
import { generateRuleMarks } from './rule';
import { generateTextMarks } from './text';
import { generateTickMarks } from './tick';
import { generateViolinMarks } from './violin';

/**
 * Generate marks based on mark type.
 */
export function generateMarks(
  markType: MarkType,
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  config?: ConfigSpec,
): AnyMark[] {
  switch (markType) {
    case 'bar':
      return generateBarMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'line':
      return generateLineMarks(markSpec, data, scales, encodings, layout, encoding);
    case 'area':
      return generateAreaMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'point':
    case 'circle':
    case 'square':
      return generatePointMarks(markSpec, data, scales, encodings, layout);
    case 'arc':
      return generateArcMarks(markSpec, data, scales, encodings, layout);
    case 'rect':
      return generateRectMarks(markSpec, data, scales, encodings, layout);
    case 'rule':
      return generateRuleMarks(markSpec, data, scales, encodings, layout);
    case 'text':
      return generateTextMarks(markSpec, data, scales, encodings, layout);
    case 'tick':
      return generateTickMarks(markSpec, data, scales, encodings, layout);
    case 'boxplot':
      return generateBoxPlotMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'histogram':
      return generateHistogramMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'violin':
      return generateViolinMarks(markSpec, data, scales, encodings, layout, encoding, config);
    default:
      return [];
  }
}

// Re-export individual generators for direct access
export { generateArcMarks } from './arc';
export { generateAreaMarks } from './area';
export { generateBarMarks } from './bar';
export { generateBoxPlotMarks } from './boxplot';
export { generateHistogramMarks } from './histogram';
export { generateLineMarks } from './line';
export { generatePointMarks } from './point';
export { generateRectMarks } from './rect';
export { generateRuleMarks } from './rule';
export { generateTextMarks } from './text';
export { generateTickMarks } from './tick';
export { generateViolinMarks } from './violin';

// Re-export helpers and path interpolation
export { groupDataByEncoding, invokeScale } from './helpers';
export {
  buildInterpolatedPath,
  buildSmoothPath,
  buildSteppedPath,
  computeMonotoneTangents,
} from './path-interpolation';
