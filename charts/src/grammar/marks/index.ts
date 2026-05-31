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
import { generateBar3DMarks } from './bar-3d';
import { generateBarMarks } from './bar';
import { generateBoxPlotMarks } from './boxplot';
import { generateContourMarks } from './contour';
import {
  depthEnhanceArcMarks,
  depthEnhanceAreaPathMarks,
  depthEnhanceLinePathMarks,
} from './depth-3d';
import { generateHistogramMarks } from './histogram';
import { generateLineMarks } from './line';
import { generatePointMarks } from './point';
import { generateRadarMarks } from './radar';
import { generateRectMarks } from './rect';
import { generateRuleMarks } from './rule';
import { generateSurface3DMarks } from './surface-3d';
import { generateTextMarks } from './text';
import { generateTickMarks } from './tick';
import { generateViolinMarks } from './violin';
import { depthOptionsFor3DPlot, with3DMetadata } from './plot-3d';

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
    case 'bar3d':
      return generateBar3DMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'line':
      return generateLineMarks(markSpec, data, scales, encodings, layout, encoding);
    case 'line3d': {
      const lineMarks = generateLineMarks(
        { ...markSpec, type: 'line' },
        data,
        scales,
        encodings,
        layout,
        encoding,
      );
      return depthEnhanceLinePathMarks(lineMarks, depthOptionsFor3DPlot(markSpec, layout)).map(
        (mark) => with3DMetadata(mark, markSpec.chart3d, 'back'),
      );
    }
    case 'area':
      return generateAreaMarks(markSpec, data, scales, encodings, layout, encoding, config);
    case 'area3d': {
      const areaMarks = generateAreaMarks(
        { ...markSpec, type: 'area' },
        data,
        scales,
        encodings,
        layout,
        encoding,
        config,
      );
      return depthEnhanceAreaPathMarks(areaMarks, depthOptionsFor3DPlot(markSpec, layout)).map(
        (mark) => with3DMetadata(mark, markSpec.chart3d, 'back'),
      );
    }
    case 'point':
    case 'circle':
    case 'square':
      return generatePointMarks(markSpec, data, scales, encodings, layout);
    case 'arc':
      return generateArcMarks(markSpec, data, scales, encodings, layout);
    case 'arc3d': {
      const arcMarks = generateArcMarks(
        { ...markSpec, type: 'arc' },
        data,
        scales,
        encodings,
        layout,
      );
      return depthEnhanceArcMarks(arcMarks, depthOptionsFor3DPlot(markSpec, layout)).map((mark) =>
        with3DMetadata(mark, markSpec.chart3d, 'outer'),
      );
    }
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
    case 'contour':
      return generateContourMarks(markSpec, data, layout);
    case 'radar':
      return generateRadarMarks(markSpec, data, scales, encodings, layout, encoding);
    case 'surface3d':
      return generateSurface3DMarks(markSpec, data, layout);
    default:
      return [];
  }
}

// Re-export individual generators for direct access
export { generateArcMarks } from './arc';
export { generateAreaMarks } from './area';
export { generateBar3DMarks } from './bar-3d';
export { generateBarMarks } from './bar';
export { generateBoxPlotMarks } from './boxplot';
export { generateContourMarks } from './contour';
export { generateHistogramMarks } from './histogram';
export { generateLineMarks } from './line';
export { generatePointMarks } from './point';
export { generateRadarMarks } from './radar';
export { generateRectMarks } from './rect';
export { generateRuleMarks } from './rule';
export { generateSurface3DMarks } from './surface-3d';
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
