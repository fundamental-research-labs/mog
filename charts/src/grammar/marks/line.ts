/**
 * Line Mark Generator
 *
 * Generates path marks for line charts with support for color/detail
 * grouping and various interpolation modes.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { resolveStrokeColor } from '../../algebra/color';
import type { PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import {
  centeredScalePosition,
  definedStyle,
  groupDataByEncoding,
  isBlankValueDatum,
  splitDataByLineSegment,
} from './helpers';
import { buildInterpolatedPath } from './path-interpolation';

/**
 * Generate line marks.
 */
export function generateLineMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  _layout: Layout,
  _encoding?: EncodingSpec,
): PathMark[] {
  if (data.length === 0) return [];

  const xScale = scales.x;
  const yScale = scales.y;

  if (!xScale || !yScale) return [];

  // Group by color/detail if specified
  const groups = groupDataByEncoding(data, encodings.color ?? encodings.detail);

  const marks: PathMark[] = [];
  const interpolate = markSpec.interpolate;

  for (const [_groupKey, groupData] of groups) {
    for (const segmentData of splitDataByLineSegment(groupData)) {
      // Collect valid coordinate points
      const pts: Array<{ x: number; y: number }> = [];
      const plottedData: DataRow[] = [];

      for (let i = 0; i < segmentData.length; i++) {
        const datum = segmentData[i];
        if (isBlankValueDatum(datum)) continue;
        const x = centeredScalePosition(xScale, encodings.x?.accessor(datum));
        const y = centeredScalePosition(yScale, encodings.y?.accessor(datum));

        if (isNaN(x) || isNaN(y)) continue;
        pts.push({ x, y });
        plottedData.push(datum);
      }

      // Skip empty groups, but allow single-point groups (degenerate path)
      if (pts.length === 0) continue;

      // Sort by x-coordinate to ensure monotonic left-to-right path
      pts.sort((a, b) => a.x - b.x);

      // Build SVG path string based on interpolation mode
      const pathStr = buildInterpolatedPath(pts, interpolate);

      // Get color
      const colorValue = encodings.color?.accessor(plottedData[0]);
      const color = resolveStrokeColor(
        scales.color,
        colorValue,
        markSpec.color,
        markSpec.stroke,
        marks.length,
      );

      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path: pathStr,
        datum: plottedData,
        style: {
          stroke: color,
          strokeWidth: markSpec.strokeWidth ?? 2,
          fill: undefined,
          opacity: markSpec.opacity ?? 1,
          ...definedStyle({
            strokePaint: markSpec.strokePaint,
            strokeDash: markSpec.strokeDash,
            line: markSpec.line,
            effects: markSpec.effects,
          }),
        },
      });
    }
  }

  return marks;
}
