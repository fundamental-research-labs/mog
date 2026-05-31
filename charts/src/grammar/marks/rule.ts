/**
 * Rule Mark Generator
 *
 * Generates path marks for rule lines (horizontal or vertical lines
 * spanning the chart area).
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { PathMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { definedStyle } from './helpers';

/**
 * Generate rule marks (lines across the chart).
 */
export function generateRuleMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
): PathMark[] {
  const marks: PathMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  for (const datum of data) {
    let x1: number, y1: number, x2: number, y2: number;

    if (encodings.x && !encodings.y) {
      // Vertical rule
      const x = xScale ? (xScale(encodings.x.accessor(datum)) as number) : 0;
      x1 = x;
      x2 = x;
      y1 = layout.plotArea.y;
      y2 = layout.plotArea.y + layout.plotArea.height;
    } else if (encodings.y && !encodings.x) {
      // Horizontal rule
      const y = yScale ? (yScale(encodings.y.accessor(datum)) as number) : 0;
      x1 = layout.plotArea.x;
      x2 = layout.plotArea.x + layout.plotArea.width;
      y1 = y;
      y2 = y;
    } else {
      continue;
    }

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${x1},${y1} L${x2},${y2}`,
      datum,
      style: {
        stroke: markSpec.color ?? markSpec.stroke ?? '#888',
        strokeWidth: markSpec.strokeWidth ?? 1,
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
