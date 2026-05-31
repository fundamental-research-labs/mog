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
import { definedStyle, groupDataByEncoding } from './helpers';
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
    // Collect valid coordinate points
    const pts: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < groupData.length; i++) {
      const datum = groupData[i];
      const x = xScale(encodings.x?.accessor(datum)) as number;
      const y = yScale(encodings.y?.accessor(datum)) as number;

      if (isNaN(x) || isNaN(y)) continue;
      pts.push({ x, y });
    }

    // Skip empty groups, but allow single-point groups (degenerate path)
    if (pts.length === 0) continue;

    // Sort by x-coordinate to ensure monotonic left-to-right path
    pts.sort((a, b) => a.x - b.x);

    // Build SVG path string based on interpolation mode
    const pathStr = buildInterpolatedPath(pts, interpolate);

    // Get color
    const colorValue = encodings.color?.accessor(groupData[0]);
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
      datum: groupData,
      style: {
        stroke: color,
        strokeWidth: markSpec.strokeWidth ?? 2,
        fill: undefined,
        opacity: markSpec.opacity ?? 1,
        ...definedStyle({
          strokePaint: markSpec.strokePaint,
          line: markSpec.line,
          effects: markSpec.effects,
        }),
      },
    });
  }

  return marks;
}
